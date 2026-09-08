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
import { closeOwnedProcessTree, ownedProcessSpawnOptions } from "../adapters/owned-process-tree";

const PROBE_TIMEOUT_MS = 45_000;

/** Re-probe this long after a negative answer: the user may install a browser. */
const NEGATIVE_TTL_MS = 10 * 60_000;

type Capability = { readonly usable: boolean; readonly checkedAt: number };

let cached: Capability | null = null;
let inFlight: Promise<boolean> | null = null;

/** Test seam: forget the cached answer. */
export function resetChromiumCapability(): void {
  cached = null;
  inFlight = null;
}

/** Test seam: pretend the probe already ran. */
export function setChromiumCapabilityForTesting(usable: boolean, checkedAt = Date.now()): void {
  cached = { usable, checkedAt };
  inFlight = null;
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
 * True when a headless Chromium launch completed in a child process. Cached
 * for the process lifetime on success, and for {@link NEGATIVE_TTL_MS} on
 * failure. Concurrent callers share one probe. Capability polling returns
 * quickly; a render can wait for the bounded probe without blocking the loop.
 */
export async function isChromiumLaunchable(
  runProbe: () => Promise<boolean> = spawnLaunchProbe,
  options: { readonly waitForResult?: boolean; readonly signal?: AbortSignal } = {},
): Promise<boolean> {
  if (options.signal?.aborted) return false;
  if (process.env.BG_CHROMIUM_ASSUME_USABLE === "1") return true;
  const now = Date.now();
  if (cached !== null && (cached.usable || now - cached.checkedAt < NEGATIVE_TTL_MS)) {
    return cached.usable;
  }
  if (inFlight === null) {
    const current = Promise.resolve().then(runProbe).catch(() => false).then((usable) => {
      if (inFlight === current) { cached = { usable, checkedAt: Date.now() }; inFlight = null; }
      return usable;
    });
    inFlight = current;
  }
  const probe = inFlight;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const gaveUp = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), options.waitForResult ? chromiumCapabilityTimeoutMs() : probeWaitMs());
    abort = () => resolve(false);
    options.signal?.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([probe, gaveUp]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort !== undefined) options.signal?.removeEventListener("abort", abort);
  }
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
export async function spawnLaunchProbe(node = chromiumNodeCommand(), timeoutMs = chromiumCapabilityTimeoutMs()): Promise<boolean> {
  const compiled = /\$bunfs|~BUN/i.test(import.meta.url);
  const fallback = compiled ? [process.execPath, "--bg-chromium-probe"] : [process.execPath, "-e", PROBE_SOURCE];
  const child = Bun.spawn(node === null ? fallback : [node.node, node.script, "--probe"], {
    ...ownedProcessSpawnOptions(),
    cwd: node?.cwd ?? (compiled ? path.dirname(process.execPath) : fileURLToPath(new URL("..", import.meta.url))),
    stdout: "pipe",
    stderr: "ignore",
    stdin: "ignore",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let forcedClose: Promise<void> | undefined;
  const expired = new Promise<false>((resolve, reject) => {
    timer = setTimeout(() => {
      forcedClose = closeOwnedProcessTree(child.pid);
      void forcedClose.then(() => resolve(false), reject);
    }, timeoutMs);
  });
  try {
    const exitCode = await Promise.race([child.exited, expired]);
    if (exitCode !== 0) return false;
    return (await new Response(child.stdout).text()).includes("usable");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await forcedClose;
  }
}

export async function runChromiumProbeProcess(): Promise<never> {
  const { chromium } = await import("playwright-core");
  for (const options of [{ headless: true }, { headless: true, channel: "chrome" }, { headless: true, channel: "msedge" }]) {
    try { const browser = await chromium.launch(options); await browser.close(); process.stdout.write("usable"); process.exit(0); } catch {}
  }
  process.exit(1);
}
