import { describe, expect, test } from "bun:test";
import { loadLocalFontFamilies } from "../src/components/modes/TweaksPanel";

const HOST_FONTS = { schema_version: 1, families: ["Malgun Gothic"] };

function countingHost(): { readonly reads: () => number; readonly read: () => Promise<unknown> } {
  let reads = 0;
  return { reads: () => reads, read: async () => { reads += 1; return HOST_FONTS; } };
}

describe("installed font loading", () => {
  test("Given queryLocalFonts resolves [] because the permission was denied When installed fonts are loaded Then the host family list is used", async () => {
    const host = countingHost();

    expect((await loadLocalFontFamilies(async () => [], host.read)).families).toEqual(["Malgun Gothic"]);
    expect(host.reads()).toBe(1);
  });

  test("Given queryLocalFonts rejects with NotAllowedError When installed fonts are loaded Then the host family list is used", async () => {
    const denied = async (): Promise<Array<{ family: string }>> => { throw new DOMException("Permission denied.", "NotAllowedError"); };

    expect((await loadLocalFontFamilies(denied, countingHost().read)).families).toEqual(["Malgun Gothic"]);
  });

  test("Given no Local Font Access API When installed fonts are loaded Then the host family list is used", async () => {
    expect((await loadLocalFontFamilies(undefined, countingHost().read)).families).toEqual(["Malgun Gothic"]);
  });

  test("Given queryLocalFonts returns families When installed fonts are loaded Then they are used and the host is not asked", async () => {
    const host = countingHost();
    const browser = async () => [{ family: "Noto Sans KR" }, { family: "Arial" }, { family: "Noto Sans KR" }];

    expect((await loadLocalFontFamilies(browser, host.read)).families).toEqual(["Arial", "Noto Sans KR"]);
    expect(host.reads()).toBe(0);
  });

  test("Given the browser list is denied and the host read fails When installed fonts are loaded Then loading rejects", async () => {
    const hostDown = async (): Promise<unknown> => { throw new Error("network_error"); };

    await expect(loadLocalFontFamilies(async () => [], hostDown)).rejects.toThrow("network_error");
  });
});
