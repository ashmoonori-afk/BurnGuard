import { describe, expect, test } from "bun:test";
import path from "node:path";
import { checkSources, checkTestSources, launchEntryPoints, readSources, readTestSources, SOURCE_ROOT, type SourceText } from "./check-flake-patterns";

const LAUNCH_MODULE: SourceText = {
  path: "packages/backend/src/services/launch-path.ts",
  text: `
    import { chromium } from "./playwright-runtime";
    import { keepAbortSignalArmed } from "../lib/abort-signal";
    export async function launchBrowser(signal: AbortSignal): Promise<void> {
      keepAbortSignalArmed(signal);
      const onAbort = (): void => undefined;
      signal.addEventListener("abort", onAbort, { once: true });
      signal.removeEventListener("abort", onAbort);
    }
    export const openSession = async (input: { readonly signal: AbortSignal }): Promise<void> => launchBrowser(input.signal);
  `,
};

const caller = (body: string, file = "packages/backend/src/services/caller.ts"): SourceText => ({ path: file, text: body });
const codes = (sources: readonly SourceText[]): string[] => checkSources(sources).map((problem) => `${problem.code} ${problem.path}:${problem.line}`);

describe("launch entry points", () => {
  test("Given a module that arms the caller's signal When entry points are collected Then its exported functions are the launch path and the helper is not", () => {
    const helper: SourceText = { path: "packages/backend/src/lib/abort-signal.ts", text: "export function keepAbortSignalArmed(signal: AbortSignal): void { if (signal.aborted) return; keepAbortSignalArmed(signal); }" };

    expect([...launchEntryPoints([LAUNCH_MODULE, helper, caller("export function unrelated(): void {}")])].sort()).toEqual(["launchBrowser", "openSession"]);
  });
});

describe("timeout signals handed to the launch path", () => {
  test.each([
    ["an inline timeout signal as an argument", "await launchBrowser(AbortSignal.timeout(20_000));", 1],
    ["an inline timeout signal as an option", "await openSession({\n  signal: AbortSignal.timeout(60_000),\n});", 2],
    ["a timeout signal held in a variable", "const deadline = AbortSignal.timeout(5_000);\nawait launchBrowser(deadline);", 2],
    ["a caller signal that falls back to a raw timeout", "const signal = options.signal ?? AbortSignal.timeout(120_000);\nawait openSession({ signal });", 2],
  ] as const)("Given %s When checked Then it is rejected", (_name, body, line) => {
    expect(codes([LAUNCH_MODULE, caller(body)])).toEqual([`raw_timeout_signal_in_launch_call packages/backend/src/services/caller.ts:${line}`]);
  });

  test.each([
    ["a timeout combined through AbortSignal.any", "await launchBrowser(AbortSignal.any([signal, AbortSignal.timeout(20_000)]));"],
    ["a variable holding an AbortSignal.any signal", "const deadline = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);\nawait openSession({ signal: deadline });"],
    ["a timeout variable armed with the helper", "const deadline = AbortSignal.timeout(5_000);\nkeepAbortSignalArmed(deadline);\nawait launchBrowser(deadline);"],
    ["a caller's signal passed through", "export async function render(signal: AbortSignal): Promise<void> { await openSession({ signal }); }"],
    ["a timeout signal used outside the launch path", "await fetch(url, { signal: AbortSignal.timeout(15_000) });"],
  ] as const)("Given %s When checked Then it is accepted", (_name, body) => {
    expect(codes([LAUNCH_MODULE, caller(body)])).toEqual([]);
  });
});

describe("modules that load Playwright", () => {
  const removal = "export function wait(signal: AbortSignal): void { const stop = (): void => undefined; signal.addEventListener(\"abort\", stop); signal.removeEventListener(\"abort\", stop); }";

  test.each([
    ["a static import", `import { chromium } from "./playwright-runtime";\n${removal}`, 2],
    ["a dynamic import", `${removal}\nexport async function probe(): Promise<void> { await import("playwright-core"); }`, 1],
  ] as const)("Given %s of Playwright and an abort listener removed without arming When checked Then it is rejected", (_name, body, line) => {
    expect(codes([caller(body)])).toEqual([`launch_module_signal_not_armed packages/backend/src/services/caller.ts:${line}`]);
  });

  test.each([
    ["the signal is armed first", `import { chromium } from "./playwright-runtime";\nimport { keepAbortSignalArmed } from "../lib/abort-signal";\n${removal}\nexport function arm(signal: AbortSignal): void { keepAbortSignalArmed(signal); }`],
    ["Playwright is imported for its types only", `import type { Page } from "playwright-core";\n${removal}`],
    ["the module does not load Playwright", removal],
  ] as const)("Given an abort listener removed where %s When checked Then it is accepted", (_name, body) => {
    expect(codes([caller(body)])).toEqual([]);
  });
});

describe("Playwright launch calls", () => {
  const bridge = (body: string): SourceText => caller(`import { chromium } from "playwright-core";\n${body}`, "packages\\backend\\src\\services\\bridge.mjs");

  test("Given the bridge as it shipped before the fix When checked Then the library timeout and the unguarded launchServer are both rejected with a POSIX path", () => {
    const shipped = "const server = await chromium.launchServer({ headless: true, host: \"127.0.0.1\", timeout: 12000 });";

    expect(codes([bridge(shipped)])).toEqual([
      "playwright_timeout_option packages/backend/src/services/bridge.mjs:2",
      "launch_server_without_deadline packages/backend/src/services/bridge.mjs:2",
    ]);
  });

  test.each([
    ["launch", "const browser = await chromium.launch({ headless: true, timeout: 30_000 });"],
    ["connect", "const browser = await chromium.connect(endpoint, { timeout: 10_000 });"],
    ["connectOverCDP", "const timeout = 5_000;\nconst browser = await playwright.chromium.connectOverCDP(endpoint, { timeout });"],
  ] as const)("Given %s relying on the library timeout option When checked Then it is rejected", (_name, body) => {
    expect(checkSources([bridge(body)]).map((problem) => problem.code)).toEqual(["playwright_timeout_option"]);
  });

  test.each([
    ["launchServer raced inside launchWithin", "const outcome = await launchWithin((options) => chromium.launchServer(options), { headless: true }, 20_000);"],
    ["launchServer given to probeChannels", "const verdict = await probeChannels({ launch: (options) => chromium.launchServer({ ...options, headless: true }), timeoutMs: 30_000 });"],
    ["launch without a library timeout", "const browser = await chromium.launch({ headless: true, channel: \"chrome\" });"],
    ["a timeout option on something that is not Playwright", "const socket = net.connect({ port: 9, timeout: 1_000 });"],
  ] as const)("Given %s When checked Then it is accepted", (_name, body) => {
    expect(codes([bridge(body)])).toEqual([]);
  });
});

describe("platform early returns in tests", () => {
  const spec = (body: string): SourceText => ({ path: "packages\\backend\\tests\\sample.test.ts", text: body });
  const lines = (body: string): number[] => checkTestSources([spec(body)]).map((problem) => problem.line);

  test.each([
    ["a win32 bail-out", 'test("a", async () => {\n  if (process.platform === "win32") return;\n  await run();\n});'],
    ["a braced darwin bail-out in a describe", 'describe("d", () => {\n  test("a", () => {\n    if (process.platform !== "darwin") { return; }\n  });\n});'],
    ["a bail-out in a skipIf test", 'test.skipIf(ok)("a", async () => {\n  if (process.platform === "win32") return; // POSIX only\n});'],
    ["a bail-out in a test.each case", 'test.each([1])("a", (n) => {\n  if (process.platform === "win32") return;\n});'],
  ] as const)("Given %s When checked Then it is rejected with a path using forward slashes", (_name, body) => {
    const [problem] = checkTestSources([spec(body)]);
    expect(problem).toMatchObject({ code: "platform_early_return_in_test", path: "packages/backend/tests/sample.test.ts" });
  });

  test.each([
    ["a skipIf declaration", 'test.skipIf(process.platform === "win32")("a", async () => { await run(); });'],
    ["a platform branch that still asserts", 'test("a", () => {\n  if (process.platform !== "win32") expect(ps()).toBe(1);\n});'],
    ["a helper that returns on the platform", 'function helper() {\n  if (process.platform === "win32") return;\n}'],
    ["a nested helper inside a test", 'test("a", () => {\n  const probe = () => {\n    if (process.platform === "win32") return;\n  };\n});'],
    ["a return unrelated to the platform", 'test("a", () => {\n  if (flag) return;\n});'],
  ] as const)("Given %s When checked Then it is accepted", (_name, body) => {
    expect(lines(body)).toEqual([]);
  });

  test("Given the package tests on this host When checked Then no test returns early on the platform", async () => {
    const tests = await readTestSources(path.resolve(import.meta.dir, "..", ".."));

    expect(tests.length).toBeGreaterThan(100);
    expect(tests.every((source) => !source.path.includes("\\"))).toBe(true);
    expect(checkTestSources(tests)).toEqual([]);
  }, 120_000);
});

describe("this repository", () => {
  test("Given the backend source on this host When checked Then the launch path is found and no flake pattern is present", async () => {
    const sources = await readSources(path.resolve(import.meta.dir, "..", ".."));

    expect(sources.every((source) => source.path.startsWith(`${SOURCE_ROOT}/`) && !source.path.includes("\\"))).toBe(true);
    expect([...launchEntryPoints(sources)]).toEqual(expect.arrayContaining(["launchChromium", "launchChromiumViaNode", "openRenderSession", "chromiumLaunchCapability"]));
    expect(checkSources(sources)).toEqual([]);
  }, 120_000);
});
