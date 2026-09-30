import { describe, expect, test } from "bun:test";
import { anyBrowserOnDisk, systemBrowserCandidates } from "../src/services/chromium-browser-paths";

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

  test("Given candidates that are absent or unreadable When presence is checked Then no browser is found", async () => {
    expect(await anyBrowserOnDisk(["/opt/google/chrome/chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"], async (candidate) => { if (candidate.startsWith("C:")) throw new Error("EACCES"); return false; })).toBe(false);
    expect(await anyBrowserOnDisk([], async () => true)).toBe(false);
  });
});
