import { describe, expect, test } from "bun:test";
import { launchWithin, probeChannels, PROBE_INCONCLUSIVE_EXIT_CODE, type BridgeLaunchOptions, type BridgeServer } from "../src/services/chromium-node-bridge.mjs";

const never = <Value>(): Promise<Value> => new Promise<Value>(() => undefined);
const expiresAtOnce = (): Promise<void> => Promise.resolve();
function server(onClose: () => void = () => undefined, close: () => Promise<void> = async () => undefined): BridgeServer { return { close: () => { onClose(); return close(); } }; }
const channelOf = (options: BridgeLaunchOptions): string => options.channel ?? "bundled";

describe("chromium bridge launch deadline", () => {
  test("Given a browser that starts but never answers When the deadline passes Then the launch is reported as timed out and a late browser is closed", async () => {
    let finish!: (late: BridgeServer) => void;
    let closed = 0;
    const pending = new Promise<BridgeServer>((resolve) => { finish = resolve; });

    const outcome = await launchWithin(() => pending, {}, 20_000, expiresAtOnce);
    finish(server(() => { closed += 1; }));
    await pending;
    await Promise.resolve();

    expect(outcome.kind).toBe("timeout");
    expect(closed).toBe(1);
  });

  test("Given a launch that settles before its deadline When raced Then the launch result wins", async () => {
    expect((await launchWithin(async () => server(), {}, 20_000, never)).kind).toBe("launched");
    expect((await launchWithin(async () => { throw new Error("Executable doesn't exist"); }, {}, 20_000, never)).kind).toBe("failed");
  });
});

describe("chromium bridge probe", () => {
  test("Given no bundled build and a system Chrome that never answers When Edge launches Then the probe falls through to it and is usable", async () => {
    const tried: string[] = [];
    const reported: string[] = [];
    let closed = 0;

    const verdict = await probeChannels({
      launch: (options) => {
        tried.push(channelOf(options));
        if (options.channel === undefined) return Promise.reject(new Error("Executable doesn't exist"));
        return options.channel === "chrome" ? never<BridgeServer>() : Promise.resolve(server(() => { closed += 1; }));
      },
      deadline: expiresAtOnce,
      report: (channel, kind) => { reported.push(`${channel}:${kind}`); },
    });

    expect(verdict).toBe("usable");
    expect(tried).toEqual(["bundled", "chrome", "msedge"]);
    expect(reported).toEqual(["bundled:failed", "chrome:timeout", "msedge:launched"]);
    expect(closed).toBe(1);
  });

  test("Given every channel failing at once When probed Then no browser is usable", async () => {
    expect(await probeChannels({ launch: () => Promise.reject(new Error("Executable doesn't exist")), deadline: never })).toBe("unusable");
  });

  test("Given a channel that ran out of time and none that launched When probed Then the probe is inconclusive and exits with its own code", async () => {
    const verdict = await probeChannels({ launch: (options) => options.channel === "chrome" ? never<BridgeServer>() : Promise.reject(new Error("Executable doesn't exist")), deadline: expiresAtOnce });

    expect(verdict).toBe("inconclusive");
    expect(PROBE_INCONCLUSIVE_EXIT_CODE).toBe(2);
  });

  test("Given a launched browser that never finishes closing When probed Then the answer does not wait for it", async () => {
    expect(await probeChannels({ launch: async () => server(undefined, () => never<void>()), deadline: expiresAtOnce })).toBe("usable");
  });
});
