import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Browser } from "playwright-core";
import { resetChromiumCapability, setChromiumCapabilityForTesting } from "../src/services/chromium-capability";
import { launchChromium, RenderSessionError, type ChromiumLauncher } from "../src/services/export-render-session";

const previousTimeout = process.env.BG_CHROMIUM_LAUNCH_TIMEOUT_MS;

// These cases drive an injected launcher, so the child-process capability
// probe is answered directly instead of spawning a browser on every run.
beforeEach(() => { process.env.BG_CHROMIUM_LAUNCH_TIMEOUT_MS = "200"; setChromiumCapabilityForTesting(true); });
afterEach(() => { resetChromiumCapability(); if (previousTimeout === undefined) delete process.env.BG_CHROMIUM_LAUNCH_TIMEOUT_MS; else process.env.BG_CHROMIUM_LAUNCH_TIMEOUT_MS = previousTimeout; });

function fakeBrowser(onClose: () => void = () => undefined): Browser { return { close: async (): Promise<void> => { onClose(); } } as unknown as Browser; }

async function launchFailure(signal: AbortSignal, launch: ChromiumLauncher, installed?: () => Promise<boolean>): Promise<RenderSessionError> {
  const error: unknown = await launchChromium(signal, launch, installed).then(() => null, (reason: unknown) => reason);
  if (!(error instanceof RenderSessionError)) throw new TypeError(`expected a RenderSessionError, got ${String(error)}`);
  return error;
}

describe("chromium launch", () => {
  test("Given a launch that never connects When Chromium is launched Then every channel times out and the failure is typed", async () => {
    const channels: Array<string | undefined> = [];
    const started = Date.now();

    const error = await launchFailure(new AbortController().signal, (options) => { channels.push(options.channel); return new Promise<Browser>(() => undefined); });

    expect(error.code).toBe("chromium_launch_timeout");
    expect(channels).toEqual([undefined, "chrome", "msedge"]);
    expect(error.message).toContain("tried channels: bundled, chrome, msedge");
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  test("Given a launch that connects after the timeout When it settles Then the abandoned browser is closed", async () => {
    process.env.BG_CHROMIUM_LAUNCH_TIMEOUT_MS = "50";
    let closed = 0;

    const error = await launchFailure(new AbortController().signal, () => new Promise<Browser>((resolve) => { setTimeout(() => { resolve(fakeBrowser(() => { closed += 1; })); }, 150); }));
    await new Promise<void>((resolve) => { setTimeout(resolve, 400); });

    expect(error.code).toBe("chromium_launch_timeout");
    expect(closed).toBe(3);
  });

  test("Given the bundled build failing fast When a channel launch succeeds Then that browser is returned", async () => {
    const channels: Array<string | undefined> = [];

    const browser = await launchChromium(new AbortController().signal, async (options) => {
      channels.push(options.channel);
      if (options.channel === undefined) throw new Error("Executable doesn't exist at chrome.exe");
      return fakeBrowser();
    });

    expect(channels).toEqual([undefined, "chrome"]);
    expect(browser).not.toBeNull();
  });

  test("Given every launch failing fast When no attempt timed out Then the missing browser code is kept", async () => {
    const error = await launchFailure(new AbortController().signal, async () => { throw new Error("Executable doesn't exist at chrome.exe"); });

    expect(error.code).toBe("chromium_not_installed");
    expect(error.message).toContain("Executable doesn't exist");
  });

  for (const [installed, code] of [[false, "chromium_not_installed"], [true, "chromium_launch_timeout"]] as const) {
    test(`Given the capability probe is negative and the bundled browser installed=${installed} When Chromium is launched Then the failure is ${code} and no launch is attempted`, async () => {
      setChromiumCapabilityForTesting(false);
      let launches = 0;

      const error = await launchFailure(new AbortController().signal, async () => { launches += 1; return fakeBrowser(); }, async () => installed);

      expect(error.code).toBe(code);
      expect(launches).toBe(0);
    });
  }

  test("Given a render cancelled while a launch is pending When the signal aborts Then the wait ends as a cancelled render", async () => {
    const controller = new AbortController();
    setTimeout(() => { controller.abort(); }, 20);

    const error = await launchFailure(controller.signal, () => new Promise<Browser>(() => undefined));

    expect(error.code).toBe("render_aborted");
  });
});
