/**
 * Is a headless Chromium launch usable in this process?
 *
 * The probe matters because `chromium.launch()` blocks the Bun event loop
 * while it waits for the browser handshake. Measured on Windows + Bun 1.3.13
 * with playwright-core 1.59.1: the handshake never completes, and during the
 * wait no timer fires and no HTTP request progresses — one thumbnail render
 * freezes the whole backend, which is what left the project view stuck on its
 * loading state. A per-request timeout cannot help, because the timer that
 * would fire it is blocked too.
 *
 * So the launch is attempted once in a CHILD process, where a blocked loop
 * costs nothing, and every in-process render is gated on that answer.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromiumNodeCommand } from "./chromium-node-launch";
import { closeOwnedProcess, settleOwnedProcess, spawnOwnedProcess } from "../adapters/owned-process";

const PROBE_TIMEOUT_MS = 45_000;
/** Must match PROBE_INCONCLUSIVE_EXIT_CODE in chromium-node-bridge.mjs. */
const PROBE_INCONCLUSIVE_EXIT_CODE = 2;

/** Re-probe this long after a negative answer: the user may install a browser. */
const NEGATIVE_TTL_MS = 10 * 60_000;

/**
 * Re-probe this long after a probe that gave no answer (it ran out of time or could not run). That says
 * nothing about the browser: a cold first launch has taken 25 s on a Windows CI runner and more than 45 s once,
 * so it must not be held as a negative answer.
 */
const INCONCLUSIVE_TTL_MS = 60_000;

/** `true` and `false` are answers about the browser; "inconclusive" means the probe produced none. */
export type ChromiumProbeResult = boolean | "inconclusive";
export type ChromiumCapability = "usable" | "unusable" | "inconclusive";
type Capability = { readonly verdict: ChromiumCapability; readonly checkedAt: number };

let cached: Capability | null = null;
let inFlight: Promise<ChromiumCapability> | null = null;

function toVerdict(result: ChromiumProbeResult): ChromiumCapability { return result === true ? "usable" : result === false ? "unusable" : "inconclusive"; }

/** Test seam: forget the cached answer. */
export function resetChromiumCapability(): void {
  cached = null;
  inFlight = null;
}

/** Test seam: pretend the probe already ran. */
export function setChromiumCapabilityForTesting(result: ChromiumProbeResult, checkedAt = Date.now()): void {
  cached = { verdict: toVerdict(result), checkedAt };
  inFlight = null;
}

/** A completed launch is stronger evidence than any probe. */
export function recordChromiumLaunched(): void {
  cached = { verdict: "usable", checkedAt: Date.now() };
}

export function chromiumCapabilityTimeoutMs(): number {
  const override = Number(process.env.BG_CHROMIUM_PROBE_TIMEOUT_MS);
  return Number.isFinite(override) && override > 0 ? override : PROBE_TIMEOUT_MS;
}

/**
 * How long a caller waits on a probe that is still running. The probe answers
 * a slow question (a stuck launch takes its full timeout), and no request may
 * hold a connection open for that: an unfinished probe reads as "not right
 * now" and the next request gets the settled answer.
 */
const PROBE_WAIT_MS = 2_000;

/**
 * Whether a headless Chromium launch completed in a child process. "usable" is cached for the process
 * lifetime, "unusable" for {@link NEGATIVE_TTL_MS} and "inconclusive" for {@link INCONCLUSIVE_TTL_MS}.
 * Concurrent callers share one probe. Capability polling returns quickly; a render can wait for the bounded
 * probe without blocking the loop. A caller that stops waiting, or whose probe could not run, concludes nothing.
 */
export async function chromiumLaunchCapability(
  runProbe: () => Promise<ChromiumProbeResult> = spawnLaunchProbe,
  options: { readonly waitForResult?: boolean; readonly signal?: AbortSignal } = {},
): Promise<ChromiumCapability> {
  if (options.signal?.aborted) return "inconclusive";
  if (process.env.BG_CHROMIUM_ASSUME_USABLE === "1") return "usable";
  if (cached !== null) {
    const age = Date.now() - cached.checkedAt;
    if (cached.verdict === "usable" || age < (cached.verdict === "unusable" ? NEGATIVE_TTL_MS : INCONCLUSIVE_TTL_MS)) return cached.verdict;
  }
  if (inFlight === null) {
    const current = Promise.resolve().then(runProbe).catch((): ChromiumProbeResult => "inconclusive").then((result) => {
      const verdict = toVerdict(result);
      if (inFlight === current) { cached = { verdict, checkedAt: Date.now() }; inFlight = null; }
      return verdict;
    });
    inFlight = current;
  }
  const probe = inFlight;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const gaveUp = new Promise<"inconclusive">((resolve) => {
    timer = setTimeout(() => resolve("inconclusive"), options.waitForResult ? chromiumCapabilityTimeoutMs() : probeWaitMs());
    abort = () => resolve("inconclusive");
    options.signal?.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([probe, gaveUp]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort !== undefined) options.signal?.removeEventListener("abort", abort);
  }
}

/** True only when the capability is "usable"; see {@link chromiumLaunchCapability}. */
export async function isChromiumLaunchable(
  runProbe: () => Promise<ChromiumProbeResult> = spawnLaunchProbe,
  options: { readonly waitForResult?: boolean; readonly signal?: AbortSignal } = {},
): Promise<boolean> {
  return (await chromiumLaunchCapability(runProbe, options)) === "usable";
}

function probeWaitMs(): number {
  const override = Number(process.env.BG_CHROMIUM_PROBE_WAIT_MS);
  return Number.isFinite(override) && override > 0 ? override : PROBE_WAIT_MS;
}

const PROBE_SOURCE = `
const { chromium } = await import("playwright-core");
const attempts = [{ headless: true }, { headless: true, channel: "chrome" }, { headless: true, channel: "msedge" }];
for (const options of attempts) {
  try {
    const browser = await chromium.launch(options);
    await browser.close();
    process.stdout.write("usable");
    process.exit(0);
  } catch {}
}
process.exit(1);
`;

/**
 * Runs the launch in a child so a blocked event loop cannot reach the server.
 * The child inherits this package's cwd, so it resolves the same
 * playwright-core the renderer uses.
 */
export async function spawnLaunchProbe(node = chromiumNodeCommand(), timeoutMs = chromiumCapabilityTimeoutMs()): Promise<ChromiumProbeResult> {
  const compiled = /\$bunfs|~BUN/i.test(import.meta.url);
  const fallback = compiled ? [process.execPath, "--bg-chromium-probe"] : [process.execPath, "-e", PROBE_SOURCE];
  const owned = spawnOwnedProcess({
    cmd: node === null ? fallback : [node.node, node.script, "--probe"],
    cwd: node?.cwd ?? (compiled ? path.dirname(process.execPath) : fileURLToPath(new URL("..", import.meta.url))),
    stdout: "pipe",
    stderr: "ignore",
    stdin: "ignore",
  });
  const child = owned.proc;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let forcedClose: Promise<void> | undefined;
  let timedOut = false;
  const expired = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      forcedClose = closeOwnedProcess(owned, { timeoutMs: 3_000 });
      void forcedClose.then(resolve, reject);
    }, timeoutMs);
  });
  try {
    const exitCode = await Promise.race([child.exited, expired]);
    // A probe that ran out of time, here or in the child, saw no answer; only a finished probe can say "no browser".
    // The child killed at the deadline exits non-zero, so the deadline is checked before its exit code.
    if (timedOut || exitCode === PROBE_INCONCLUSIVE_EXIT_CODE) return "inconclusive";
    if (exitCode !== 0) return false;
    return (await new Response(child.stdout).text()).includes("usable");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await forcedClose;
    const exitCode = await child.exited;
    await settleOwnedProcess(owned, exitCode);
  }
}

export async function runChromiumProbeProcess(): Promise<never> {
  const { chromium } = await import("./playwright-runtime");
  for (const options of [{ headless: true }, { headless: true, channel: "chrome" }, { headless: true, channel: "msedge" }]) {
    try { const browser = await chromium.launch(options); await browser.close(); process.stdout.write("usable"); process.exit(0); } catch {}
  }
  process.exit(1);
}
