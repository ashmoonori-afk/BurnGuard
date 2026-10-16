import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser } from "playwright-core";
import { isChromiumLaunchable, resetChromiumCapability, setChromiumCapabilityForTesting, spawnLaunchProbe } from "../src/services/chromium-capability";
import { chromiumNodeCommand, launchChromiumViaNode } from "../src/services/chromium-node-launch";
import { launchChromium, RenderSessionError } from "../src/services/export-render-session";

// Regression suite for the 2026-09-30 launch failures (doc/os-matrix.md, "Hardening log"). Every case goes through
// an entry point that already existed before the fix (PR #195), so it fails by assertion on the code that shipped
// the defect instead of failing to load.

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
    // The endpoint names which of these variables reached the browser; Playwright's default env is process.env.
    const seen = ["DISPLAY", "WAYLAND_DISPLAY", "BG_TEST_SENTINEL"].filter((name) => (options.env ?? process.env)[name] !== undefined);
    if (behaviour === "launches") return Promise.resolve({ close: async () => undefined, wsEndpoint: () => "ws://127.0.0.1:9/fake?env=" + seen.join(",") + "&channel=" + (options.channel ?? "bundled") });
    if (behaviour === "missing") return Promise.reject(new Error("BG_TEST_MISSING_EXECUTABLE: Executable doesn't exist"));
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
  setSystemTime();
  resetChromiumCapability();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A copy of the real bridge that imports FAKE_PLAYWRIGHT. */
async function fakeBridge(prefix: string): Promise<{ readonly node: string; readonly script: string; readonly root: string }> {
  const node = chromiumNodeCommand()?.node;
  if (node === undefined) throw new Error("Node runtime unavailable");
  const root = await tempRoot(prefix);
  const fake = path.join(root, "node_modules", "playwright-core");
  await mkdir(fake, { recursive: true });
  await writeFile(path.join(fake, "package.json"), JSON.stringify({ name: "playwright-core", version: "1.59.1", type: "module", exports: "./index.mjs" }));
  await writeFile(path.join(fake, "index.mjs"), FAKE_PLAYWRIGHT);
  const script = path.join(root, "chromium-node-bridge.mjs");
  await copyFile(BRIDGE, script);
  return { node, script, root };
}

async function runBridgeProbe(behaviours: readonly [ChannelBehaviour, ChannelBehaviour, ChannelBehaviour], channelTimeoutMs: number, killAfterMs: number): Promise<{ readonly exit: number | "killed"; readonly stdout: string }> {
  const { node, script, root } = await fakeBridge("bg-bridge-deadline-");
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

async function neverAnsweringProbe(): Promise<{ readonly node: string; readonly script: string; readonly cwd: string }> {
  const root = await tempRoot("bg-probe-deadline-");
  const script = path.join(root, "probe.mjs");
  await writeFile(script, "setInterval(() => undefined, 1_000);");
  return { node: process.execPath, script, cwd: root };
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

describe("headless browser environment", () => {
  test("Given a host display server When the bridge launches Chromium Then the browser inherits no display variable and keeps the rest", async () => {
    // A headless GPU process that inherits DISPLAY connects to that X server first; a busy or restarting server
    // (WSLg's has a listen backlog of 1) blocks it, so no frame and no requestAnimationFrame ever arrives.
    const { node, script, root } = await fakeBridge("bg-bridge-display-");
    const child = Bun.spawn({
      cmd: [node, script, "{}"],
      cwd: root,
      env: { ...process.env, BG_TEST_BROWSER_CHANNELS: "launches,missing,missing", DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", BG_TEST_SENTINEL: "1" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });

    const reader = child.stdout.getReader();
    let line = "";
    while (!line.includes("\n")) {
      const next = await reader.read();
      if (next.done) break;
      line += new TextDecoder().decode(next.value);
    }
    reader.releaseLock();
    child.stdin.end();

    expect(await child.exited).toBe(0);
    expect(new URL((JSON.parse(line) as { readonly endpoint: string }).endpoint).searchParams.get("env")).toBe("BG_TEST_SENTINEL");
  });
});

describe("bridge serve channel fallback", () => {
  for (const { available, channel, behaviours } of [
    { available: "chrome", channel: undefined, behaviours: "missing,launches,missing" },
    { available: "msedge", channel: undefined, behaviours: "missing,missing,launches" },
    { available: "chrome", channel: "chrome", behaviours: "launches,launches,missing" },
  ] as const) {
    test(`Given ${available} installed When the bridge serves ${channel === undefined ? "without a channel" : "with an explicit channel"} Then it connects through that system browser`, async () => {
      const { node, script, root } = await fakeBridge("bg-bridge-fallback-");
      const child = Bun.spawn({
        cmd: [node, script, JSON.stringify(channel === undefined ? {} : { channel })],
        cwd: root,
        env: { ...process.env, BG_TEST_BROWSER_CHANNELS: behaviours },
        stdin: "pipe", stdout: "pipe", stderr: "pipe",
      });
      const deadline = setTimeout(() => child.kill(), 15_000);
      const reader = child.stdout.getReader();
      let line = "";
      try {
        while (!line.includes("\n")) {
          const next = await reader.read();
          if (next.done) break;
          line += new TextDecoder().decode(next.value);
        }
      } finally {
        reader.releaseLock();
        child.stdin.end();
        await child.exited;
        clearTimeout(deadline);
      }
      expect(child.exitCode).toBe(0);
      const message: unknown = JSON.parse(line);
      if (typeof message !== "object" || message === null || !("endpoint" in message) || typeof message.endpoint !== "string") throw new Error("Missing fake browser endpoint");
      expect(new URL(message.endpoint).searchParams.get("channel")).toBe(available);
    });
  }
});

describe("bridge launch diagnostics", () => {
  test("Given every browser executable missing When the real bridge serves Then stderr preserves the launch failure", async () => {
    const { node, script, root } = await fakeBridge("bg-bridge-all-missing-");
    const child = Bun.spawn({
      cmd: [node, script, "{}"], cwd: root,
      env: { ...process.env, BG_TEST_BROWSER_CHANNELS: "missing,missing,missing" },
      stdin: "pipe", stdout: "ignore", stderr: "pipe",
    });
    const deadline = setTimeout(() => child.kill(), 15_000);
    try {
      const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(exit).toBe(1);
      expect(stderr).toContain("BG_TEST_MISSING_EXECUTABLE");
    } finally {
      child.stdin.end();
      clearTimeout(deadline);
    }
  });

  for (const privatePath of ["/Users/private-person/Library/Caches/browser/chrome", "C:\\Users\\private-person\\App Data\\browser\\chrome.exe", "\\\\private-server\\private-share\\browser.exe"]) {
    test(`Given a failed child with ${privatePath[0] === "/" ? "POSIX" : privatePath.startsWith("\\\\") ? "UNC" : "Windows"} diagnostics When launched Then the bounded error retains the cause without the private path`, async () => {
      const root = await tempRoot("bg-bridge-diagnostic-");
      const script = path.join(root, "bridge.mjs");
      const diagnostic = `BG_TEST_LAUNCH_FAILURE: Executable doesn't exist at ${privatePath}\n` + "x".repeat(20_000);
      await writeFile(script, `process.stderr.write(${JSON.stringify(diagnostic)}, () => process.exit(1));`);

      const error = await launchChromiumViaNode({}, new AbortController().signal, { node: process.execPath, script, cwd: root }).then(() => null, (cause: unknown) => cause);

      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) throw new Error("Expected launch failure");
      expect(error.message).toContain("BG_TEST_LAUNCH_FAILURE");
      expect(error.message).not.toContain(privatePath);
      expect(error.message).not.toContain("private-person");
      expect(error.message).not.toContain("private-server");
      expect(error.message.length).toBeLessThanOrEqual(4_200);
    });
  }
});

describe("probe stopped at its deadline", () => {
  test("Given a probe child killed at its deadline When Chromium is launched afterwards Then the missing answer is not held as a missing browser and the launch is attempted", async () => {
    const command = await neverAnsweringProbe();
    let launches = 0;

    const answered = await isChromiumLaunchable(() => spawnLaunchProbe(command, 250), { waitForResult: true });
    const outcome = await launchChromium(new AbortController().signal, async () => { launches += 1; return fakeBrowser(); }, async () => false, true)
      .then(() => "launched", (error: unknown) => error instanceof RenderSessionError ? error.code : "unexpected_error");

    expect(answered).toBe(false);
    expect({ outcome, launches }).toEqual({ outcome: "launched", launches: 1 });
    expect(await isChromiumLaunchable(async () => false)).toBe(true);
  }, 25_000);

  test("Given a probe child killed at its deadline When two minutes have passed Then the next caller probes again instead of reading a ten-minute negative answer", async () => {
    const command = await neverAnsweringProbe();
    let probes = 0;

    const answered = await isChromiumLaunchable(() => spawnLaunchProbe(command, 250), { waitForResult: true });
    setSystemTime(new Date(Date.now() + 2 * 60_000));
    const usable = await isChromiumLaunchable(async () => { probes += 1; return true; }, { waitForResult: true });

    expect(answered).toBe(false);
    expect({ usable, probes }).toEqual({ usable: true, probes: 1 });
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

  test("Given a caller's timeout signal When the capability wait has listened on it and stopped Then the deadline still fires", async () => {
    const signal = AbortSignal.timeout(200);

    const usable = await isChromiumLaunchable(async () => true, { waitForResult: true, signal });

    expect(usable).toBe(true);
    expect(await firesWithin(signal, 5_000)).toBe(true);
  });

  test("Given a caller's timeout signal When a launch attempt has listened on it and stopped Then the deadline still fires", async () => {
    setChromiumCapabilityForTesting(true);
    const signal = AbortSignal.timeout(200);

    const browser = await launchChromium(signal, async () => fakeBrowser());

    expect(browser).not.toBeNull();
    expect(await firesWithin(signal, 5_000)).toBe(true);
  });
});
