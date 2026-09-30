import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser } from "playwright-core";
import { keepAbortSignalArmed } from "../src/lib/abort-signal";
import { isChromiumLaunchable, resetChromiumCapability, spawnLaunchProbe } from "../src/services/chromium-capability";
import { chromiumNodeCommand, launchChromiumViaNode } from "../src/services/chromium-node-launch";
import { launchChromium, RenderSessionError } from "../src/services/export-render-session";

// Regression suite for the 2026-09-30 launch failures (doc/os-matrix.md, HARDENING). Every case goes through an
// entry point that existed before the fix, so it fails by assertion on the code that shipped the defect.

const BRIDGE = path.join(import.meta.dir, "..", "src", "services", "chromium-node-bridge.mjs");
const CHANNELS = ["bundled", "chrome", "msedge"] as const;
type ChannelBehaviour = "missing" | "never-answers" | "launches";

/**
 * Stands in for playwright-core inside the bridge child. Like 1.59.1 it accepts launchServer's `timeout` option and
 * never applies it; a browser that "never answers" keeps a handle open, as a started browser process does.
 */
const FAKE_PLAYWRIGHT = `
const behaviours = (process.env.BG_TEST_BROWSER_CHANNELS ?? "").split(",");
const channels = ${JSON.stringify(CHANNELS)};
export const chromium = {
  launchServer(options) {
    const behaviour = behaviours[channels.indexOf(options.channel ?? "bundled")];
    if (behaviour === "launches") return Promise.resolve({ close: async () => undefined, wsEndpoint: () => "ws://127.0.0.1:9/fake" });
    if (behaviour === "missing") return Promise.reject(new Error("Executable doesn't exist"));
    setInterval(() => undefined, 1_000);
    return new Promise(() => undefined);
  },
};
`;

const roots: string[] = [];
async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

beforeEach(() => resetChromiumCapability());
afterEach(async () => {
  resetChromiumCapability();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function runBridgeProbe(behaviours: readonly [ChannelBehaviour, ChannelBehaviour, ChannelBehaviour], channelTimeoutMs: number, killAfterMs: number): Promise<{ readonly exit: number | "killed"; readonly stdout: string }> {
  const node = chromiumNodeCommand()?.node;
  if (node === undefined) throw new Error("Node runtime unavailable");
  const root = await tempRoot("bg-bridge-deadline-");
  const fake = path.join(root, "node_modules", "playwright-core");
  await mkdir(fake, { recursive: true });
  await writeFile(path.join(fake, "package.json"), JSON.stringify({ name: "playwright-core", version: "1.59.1", type: "module", exports: "./index.mjs" }));
  await writeFile(path.join(fake, "index.mjs"), FAKE_PLAYWRIGHT);
  const script = path.join(root, "chromium-node-bridge.mjs");
  await copyFile(BRIDGE, script);
  const child = Bun.spawn({
    cmd: [node, script, "--probe"],
    cwd: root,
    env: { ...process.env, BG_TEST_BROWSER_CHANNELS: behaviours.join(","), BG_CHROMIUM_PROBE_CHANNEL_TIMEOUT_MS: String(channelTimeoutMs) },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  let killed = false;
  const deadline = setTimeout(() => { killed = true; child.kill(); }, killAfterMs);
  try {
    const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    return { exit: killed ? "killed" : exitCode, stdout };
  } finally { clearTimeout(deadline); }
}

function fakeBrowser(): Browser { return { close: async (): Promise<void> => undefined } as unknown as Browser; }

function firesWithin(signal: AbortSignal, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) { resolve(true); return; }
    const timer = setTimeout(() => { resolve(false); }, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(true); }, { once: true });
  });
}

describe("bridge launch deadline in the real probe child", () => {
  test("Given a system Chrome that starts and never answers When the bridge probe runs Then it abandons that channel at its own deadline and answers from Edge", async () => {
    const result = await runBridgeProbe(["missing", "never-answers", "launches"], 300, 15_000);

    expect(result).toEqual({ exit: 0, stdout: "usable" });
  }, 25_000);

  test("Given every browser starting and never answering When the bridge probe runs Then it ends by itself with the no-answer exit code", async () => {
    const result = await runBridgeProbe(["never-answers", "never-answers", "never-answers"], 200, 15_000);

    expect(result).toEqual({ exit: 2, stdout: "" });
  }, 25_000);
});

describe("probe stopped at its deadline", () => {
  test("Given a probe child killed at its deadline When Chromium is launched afterwards Then the missing answer is not held as a missing browser and the launch is attempted", async () => {
    const root = await tempRoot("bg-probe-deadline-");
    const script = path.join(root, "probe.mjs");
    await writeFile(script, "setInterval(() => undefined, 1_000);");
    const command = { node: process.execPath, script, cwd: root };
    let launches = 0;

    const answered = await isChromiumLaunchable(() => spawnLaunchProbe(command, 250), { waitForResult: true });
    const outcome = await launchChromium(new AbortController().signal, async () => { launches += 1; return fakeBrowser(); }, async () => false, true)
      .then(() => "launched", (error: unknown) => error instanceof RenderSessionError ? error.code : "unexpected_error");

    expect(answered).toBe(false);
    expect({ outcome, launches }).toEqual({ outcome: "launched", launches: 1 });
    expect(await isChromiumLaunchable(async () => false)).toBe(true);
  }, 25_000);
});

describe("caller deadline across the launch path", () => {
  test("Given a caller's timeout signal When the bridge launch has listened on it and stopped Then the deadline still fires", async () => {
    const root = await tempRoot("bg-bridge-signal-");
    const script = path.join(root, "bridge.mjs");
    await writeFile(script, "process.exit(1);");
    const signal = AbortSignal.timeout(3_000);

    const launched = await launchChromiumViaNode({}, signal, { node: process.execPath, script, cwd: root }).then(() => true, () => false);

    expect(launched).toBe(false);
    expect(await firesWithin(signal, 15_000)).toBe(true);
  }, 25_000);

  test("Given a caller's timeout signal kept armed When its only other listener is added and removed Then the deadline still fires", async () => {
    const signal = AbortSignal.timeout(200);
    const listener = (): void => undefined;

    keepAbortSignalArmed(signal);
    keepAbortSignalArmed(signal);
    signal.addEventListener("abort", listener, { once: true });
    await Promise.resolve();
    signal.removeEventListener("abort", listener);

    expect(await firesWithin(signal, 5_000)).toBe(true);
  });
});
