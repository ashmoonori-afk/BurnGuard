import { afterEach, describe, expect, test } from "bun:test";
import type { Browser } from "playwright-core";
import { anyBrowserOnDisk, systemBrowserCandidates } from "../src/services/chromium-browser-paths";
import { resetChromiumCapability, setChromiumCapabilityForTesting } from "../src/services/chromium-capability";
import { browserOnDisk, launchChromium, RenderSessionError } from "../src/services/export-render-session";

afterEach(() => resetChromiumCapability());

const WINDOWS_ENV = { LOCALAPPDATA: "C:\\Users\\runneradmin\\AppData\\Local", PROGRAMFILES: "C:\\Program Files", "PROGRAMFILES(X86)": "C:\\Program Files (x86)" };

describe("system browser candidates", () => {
  test("Given Windows install roots When candidates are listed Then Chrome and Edge are looked up under each root with backslash paths", () => {
    expect(systemBrowserCandidates("win32", WINDOWS_ENV)).toEqual([
      "C:\\Users\\runneradmin\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Users\\runneradmin\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ]);
  });

  test("Given Windows without some install roots When candidates are listed Then missing and empty roots are left out", () => {
    expect(systemBrowserCandidates("win32", { PROGRAMFILES: "D:\\Apps", LOCALAPPDATA: "" })).toEqual([
      "D:\\Apps\\Google\\Chrome\\Application\\chrome.exe",
      "D:\\Apps\\Microsoft\\Edge\\Application\\msedge.exe",
    ]);
    expect(systemBrowserCandidates("win32", {})).toEqual([]);
  });

  test("Given macOS or Linux When candidates are listed Then the fixed POSIX locations are used and Windows roots are ignored", () => {
    expect(systemBrowserCandidates("darwin", WINDOWS_ENV)).toEqual(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]);
    expect(systemBrowserCandidates("linux", WINDOWS_ENV)).toEqual(["/opt/google/chrome/chrome", "/opt/microsoft/msedge/msedge"]);
  });
});

describe("browser presence", () => {
  for (const platform of ["win32", "darwin", "linux"] as const) {
    test(`Given ${platform} with only the second system browser on disk When presence is checked Then a browser is found without Playwright's own build`, async () => {
      const candidates = ["missing-playwright-build", ...systemBrowserCandidates(platform, WINDOWS_ENV)];
      const present = candidates[2]!;
      const asked: string[] = [];

      const found = await anyBrowserOnDisk(candidates, async (candidate) => { asked.push(candidate); return candidate === present; });

      expect(found).toBe(true);
      expect(asked).toEqual(candidates.slice(0, 3));
    });
  }

  const WINDOWS_BUILD = "C:\\Users\\runneradmin\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe";
  const MAC_BUILD = "/Users/runner/Library/Caches/ms-playwright/chromium-1217/chrome-mac/Chromium.app/Contents/MacOS/Chromium";
  const LINUX_BUILD = "/home/runner/.cache/ms-playwright/chromium-1217/chrome-linux/chrome";

  for (const [host, platform, env, bundled, onDisk, expected] of [
    ["Windows with Chrome under C:\\Program Files", "win32", WINDOWS_ENV, WINDOWS_BUILD, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", true],
    ["Windows with a per-user Chrome under LOCALAPPDATA", "win32", WINDOWS_ENV, WINDOWS_BUILD, "C:\\Users\\runneradmin\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe", true],
    ["Windows with Edge on drive D", "win32", { "PROGRAMFILES(X86)": "D:\\Program Files (x86)" }, WINDOWS_BUILD, "D:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", true],
    ["Windows with only Playwright's own build", "win32", WINDOWS_ENV, WINDOWS_BUILD, WINDOWS_BUILD, true],
    ["Windows with Chrome outside every install root of the environment", "win32", { PROGRAMFILES: "D:\\Apps" }, WINDOWS_BUILD, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", false],
    ["Windows with a Chrome path written with forward slashes, which no lookup produces", "win32", WINDOWS_ENV, WINDOWS_BUILD, "C:/Program Files/Google/Chrome/Application/chrome.exe", false],
    ["macOS with Chrome in /Applications", "darwin", {}, MAC_BUILD, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", true],
    ["macOS with Edge in /Applications", "darwin", {}, MAC_BUILD, "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", true],
    ["Linux with Chrome under /opt", "linux", {}, LINUX_BUILD, "/opt/google/chrome/chrome", true],
    ["Linux with only a distribution Chromium in /usr/bin, which no launch channel uses", "linux", {}, LINUX_BUILD, "/usr/bin/chromium", false],
    ["macOS with no browser at all", "darwin", {}, MAC_BUILD, null, false],
  ] as const) {
    test(`Given ${host} When the installed check runs Then a browser on disk is ${String(expected)}`, async () => {
      expect(await browserOnDisk(platform, env, async (candidate) => candidate === onDisk, bundled)).toBe(expected);
    });
  }

  for (const [host, platform, bundled, onDisk, code] of [
    ["Windows with only system Chrome", "win32", WINDOWS_BUILD, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "chromium_launch_timeout"],
    ["macOS with only system Chrome", "darwin", MAC_BUILD, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "chromium_launch_timeout"],
    ["Linux with only system Edge", "linux", LINUX_BUILD, "/opt/microsoft/msedge/msedge", "chromium_launch_timeout"],
    ["Windows with no browser", "win32", WINDOWS_BUILD, null, "chromium_not_installed"],
  ] as const) {
    test(`Given ${host} and a negative capability probe When Chromium is launched Then the failure is ${code}`, async () => {
      setChromiumCapabilityForTesting(false);
      let launches = 0;

      const error: unknown = await launchChromium(
        new AbortController().signal,
        async () => { launches += 1; return { close: async (): Promise<void> => undefined } as unknown as Browser; },
        () => browserOnDisk(platform, WINDOWS_ENV, async (candidate) => candidate === onDisk, bundled),
      ).then(() => null, (reason: unknown) => reason);

      expect(error).toBeInstanceOf(RenderSessionError);
      expect(error instanceof RenderSessionError ? error.code : null).toBe(code);
      expect(launches).toBe(0);
    });
  }

  test("Given candidates that are absent or unreadable When presence is checked Then no browser is found", async () => {
    expect(await anyBrowserOnDisk(["/opt/google/chrome/chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"], async (candidate) => { if (candidate.startsWith("C:")) throw new Error("EACCES"); return false; })).toBe(false);
    expect(await anyBrowserOnDisk([], async () => true)).toBe(false);
  });
});
