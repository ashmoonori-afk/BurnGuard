import { expect, test } from "bun:test";
import { parseLocalFonts } from "@bg/shared";
import { getLocalFonts, parseFcListFamilies } from "../src/services/local-fonts";
import { classifyApiRoute } from "../src/server";

test("Given the local fonts endpoint When classified Then it keeps settings authority", () => {
  expect(classifyApiRoute("/api/settings/local-fonts", "GET")).toBe("settings");
});

test("Given fc-list output with duplicates and blank lines When parsed Then unique family names are returned", () => {
  const families = parseFcListFamilies("Noto Sans CJK KR\n\n  DejaVu Sans \r\nNoto Sans CJK KR\nUnifont-JP\n");
  expect(families).toEqual(["Noto Sans CJK KR", "DejaVu Sans", "Unifont-JP"]);
  expect(parseLocalFonts({ schema_version: 1, families }).families).toEqual(["DejaVu Sans", "Noto Sans CJK KR", "Unifont-JP"]);
});

test.skipIf(process.platform !== "win32" && process.platform !== "darwin" && !(process.platform === "linux" && Bun.which("fc-list")))("Given host installed fonts When enumerated Then only family names are returned", async () => {
  const result = await getLocalFonts();
  expect(result.schema_version).toBe(1);
  expect(result.families.length).toBeGreaterThan(0);
  expect(result.families.every((family) => !/[\\/\x00-\x1f]/.test(family))).toBe(true);
});
