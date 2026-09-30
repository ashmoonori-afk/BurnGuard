import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  chromiumLaunchCapability,
  isChromiumLaunchable,
  resetChromiumCapability,
  setChromiumCapabilityForTesting,
  spawnLaunchProbe,
} from "../src/services/chromium-capability";

beforeEach(() => resetChromiumCapability());
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
      await Promise.resolve();
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
    let finish!: (usable: boolean) => void;
    const pending = new Promise<boolean>(resolve => { finish = resolve; });
    const probe = async (): Promise<boolean> => {
      const usable = await pending;
      settled = true;
      return usable;
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
    finish(true);
    expect(await isChromiumLaunchable(probe, { waitForResult: true })).toBe(true);
    expect(settled).toBe(true);
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

describe("chromium launch capability without an answer", () => {
  test("Given a probe that ends without an answer When asked Then the capability is inconclusive and polling reads it as not launchable", async () => {
    const probe = async (): Promise<"inconclusive"> => "inconclusive";

    expect(await chromiumLaunchCapability(probe)).toBe("inconclusive");
    expect(await isChromiumLaunchable(probe)).toBe(false);
  });

  test("Given a probe that throws When asked Then nothing is concluded about the browser", async () => {
    expect(await chromiumLaunchCapability(async () => { throw new TypeError("spawn failed"); })).toBe("inconclusive");
  });

  test("Given an unanswered probe from nine minutes ago When asked again Then the probe reruns, where a real negative answer of that age is kept", async () => {
    const age = Date.now() - 9 * 60_000;
    let probes = 0;
    const probe = async (): Promise<boolean> => { probes += 1; return true; };

    setChromiumCapabilityForTesting("inconclusive", age);
    expect(await chromiumLaunchCapability(probe)).toBe("usable");
    expect(probes).toBe(1);

    setChromiumCapabilityForTesting(false, age);
    expect(await chromiumLaunchCapability(probe)).toBe("unusable");
    expect(probes).toBe(1);
  });

  test("Given a fresh unanswered probe When asked again Then the probe is not repeated at once", async () => {
    setChromiumCapabilityForTesting("inconclusive");
    let probes = 0;

    expect(await chromiumLaunchCapability(async () => { probes += 1; return true; })).toBe("inconclusive");
    expect(probes).toBe(0);
  });

  test("Given a render whose wait is cancelled When the probe is still running Then that caller concludes nothing and the probe keeps its own answer", async () => {
    let finish!: (usable: boolean) => void;
    const probe = (): Promise<boolean> => new Promise((resolve) => { finish = resolve; });
    const controller = new AbortController();
    const cancelled = chromiumLaunchCapability(probe, { waitForResult: true, signal: controller.signal });
    controller.abort();

    expect(await cancelled).toBe("inconclusive");
    const waiting = chromiumLaunchCapability(probe, { waitForResult: true });
    finish(true);
    expect(await waiting).toBe("usable");
  });
});

describe("caller deadline", () => {
  test("Given a caller's timeout signal When the capability wait has listened on it and stopped Then the deadline still fires", async () => {
    const signal = AbortSignal.timeout(200);

    expect(await chromiumLaunchCapability(async () => true, { waitForResult: true, signal })).toBe("usable");

    expect(await firesWithin(signal, 5_000)).toBe(true);
  });
});

function firesWithin(signal: AbortSignal, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => { resolve(false); }, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(true); }, { once: true });
  });
}

describe("chromium launch probe child", () => {
  async function probeWith(body: string, timeoutMs: number): Promise<boolean | "inconclusive"> {
    const dir = await mkdtemp(path.join(tmpdir(), "bg-probe-child-"));
    try {
      const script = path.join(dir, "probe.mjs");
      await writeFile(script, body);
      return await spawnLaunchProbe({ node: process.execPath, script, cwd: dir }, timeoutMs);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }

  for (const [name, body, expected] of [
    ["reports a usable browser", 'process.stdout.write("usable", () => { process.exit(0); });', true],
    ["finds no browser", "process.exit(1);", false],
    ["ran out of time on a channel", "process.exit(2);", "inconclusive"],
  ] as const) {
    test(`Given a probe child that ${name} When the probe runs Then the result is ${String(expected)}`, async () => {
      expect(await probeWith(body, 20_000)).toBe(expected);
    });
  }

  test("Given a probe child that never answers When its deadline passes Then the result is inconclusive rather than a missing browser", async () => {
    expect(await probeWith("setInterval(() => undefined, 1_000);", 250)).toBe("inconclusive");
  });
});
