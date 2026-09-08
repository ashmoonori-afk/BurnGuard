import { afterEach, describe, expect, test } from "bun:test";
import {
  isChromiumLaunchable,
  resetChromiumCapability,
  setChromiumCapabilityForTesting,
} from "../src/services/chromium-capability";

afterEach(() => {
  resetChromiumCapability();
  delete process.env.BG_CHROMIUM_ASSUME_USABLE;
  delete process.env.BG_CHROMIUM_PROBE_WAIT_MS;
});

describe("chromium launch capability", () => {
  test("Given concurrent callers When the probe has not run Then it runs exactly once and both see the answer", async () => {
    // Given
    let probes = 0;
    const probe = async (): Promise<boolean> => {
      probes += 1;
      await Bun.sleep(5);
      return true;
    };

    // When
    const [first, second] = await Promise.all([
      isChromiumLaunchable(probe),
      isChromiumLaunchable(probe),
    ]);

    // Then
    expect([first, second]).toEqual([true, true]);
    expect(probes).toBe(1);
  });

  test("Given a usable browser When asked again Then the answer is cached and the probe does not rerun", async () => {
    // Given
    let probes = 0;
    const probe = async (): Promise<boolean> => { probes += 1; return true; };
    await isChromiumLaunchable(probe);

    // When
    const again = await isChromiumLaunchable(probe);

    // Then
    expect(again).toBe(true);
    expect(probes).toBe(1);
  });

  test("Given a probe that throws When asked Then the failure is reported as unusable, never propagated", async () => {
    // Given
    const probe = async (): Promise<boolean> => { throw new TypeError("spawn failed"); };

    // When
    const usable = await isChromiumLaunchable(probe);

    // Then
    expect(usable).toBe(false);
  });

  test("Given a stale negative answer When asked again Then the probe reruns so an installed browser is picked up", async () => {
    // Given: a negative answer older than the ten minute retry window.
    setChromiumCapabilityForTesting(false, Date.now() - 11 * 60_000);
    let probes = 0;
    const probe = async (): Promise<boolean> => { probes += 1; return true; };

    // When
    const usable = await isChromiumLaunchable(probe);

    // Then
    expect(usable).toBe(true);
    expect(probes).toBe(1);
  });

  test("Given a fresh negative answer When asked again Then the probe is not repeated", async () => {
    // Given
    setChromiumCapabilityForTesting(false);
    let probes = 0;
    const probe = async (): Promise<boolean> => { probes += 1; return true; };

    // When
    const usable = await isChromiumLaunchable(probe);

    // Then
    expect(usable).toBe(false);
    expect(probes).toBe(0);
  });

  test("Given a probe still running When asked Then the caller is not made to wait for it", async () => {
    // Given: a probe as slow as a stuck browser launch.
    process.env.BG_CHROMIUM_PROBE_WAIT_MS = "30";
    let settled = false;
    const probe = async (): Promise<boolean> => {
      await Bun.sleep(400);
      settled = true;
      return true;
    };

    // When
    const started = Date.now();
    const duringProbe = await isChromiumLaunchable(probe);
    const waited = Date.now() - started;

    // Then: the request gets an immediate "not right now"...
    expect(duringProbe).toBe(false);
    expect(waited).toBeLessThan(300);
    expect(settled).toBe(false);

    // ...and the probe keeps running, so a later request sees the real answer.
    await Bun.sleep(500);
    expect(settled).toBe(true);
    expect(await isChromiumLaunchable(probe)).toBe(true);
  });

  test("Given the assume-usable override When asked Then no probe runs", async () => {
    // Given
    process.env.BG_CHROMIUM_ASSUME_USABLE = "1";
    let probes = 0;
    const probe = async (): Promise<boolean> => { probes += 1; return false; };

    // When
    const usable = await isChromiumLaunchable(probe);

    // Then
    expect(usable).toBe(true);
    expect(probes).toBe(0);
  });

  test("Given a pending capability poll When a render awaits readiness Then it shares the probe and cancellation stops only its wait", async () => {
    process.env.BG_CHROMIUM_PROBE_WAIT_MS = "1";
    let finish!: (usable: boolean) => void;
    let probes = 0;
    const probe = (): Promise<boolean> => { probes++; return new Promise((resolve) => { finish = resolve; }); };
    expect(await isChromiumLaunchable(probe)).toBe(false);
    const controller = new AbortController();
    const cancelled = isChromiumLaunchable(probe, { waitForResult: true, signal: controller.signal });
    controller.abort();
    expect(await cancelled).toBe(false);
    const rendering = isChromiumLaunchable(probe, { waitForResult: true });
    finish(true);
    expect(await rendering).toBe(true);
    expect(probes).toBe(1);
  });

  test("Given a browser installation invalidates an old probe When the old failure completes Then it cannot overwrite the new usable result", async () => {
    let finish!: (usable: boolean) => void;
    const old = isChromiumLaunchable(() => new Promise((resolve) => { finish = resolve; }));
    await Promise.resolve();
    resetChromiumCapability();
    expect(await isChromiumLaunchable(async () => true)).toBe(true);
    finish(false);
    expect(await old).toBe(false);
    expect(await isChromiumLaunchable(async () => false)).toBe(true);
  });
});
