import { expect, test } from "bun:test";
import { getLocalFonts } from "../src/services/local-fonts";
import { classifyApiRoute } from "../src/server";

test("Given the local fonts endpoint When classified Then it keeps settings authority", () => {
  expect(classifyApiRoute("/api/settings/local-fonts", "GET")).toBe("settings");
});

test.skipIf(process.platform !== "win32")("Given Windows installed fonts When enumerated Then only family names are returned", async () => {
  const result = await getLocalFonts();
  expect(result.schema_version).toBe(1);
  expect(result.families.length).toBeGreaterThan(0);
  expect(result.families.every((family) => !/[\\/\x00-\x1f]/.test(family))).toBe(true);
});
