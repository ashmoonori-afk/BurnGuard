import { expect, test } from "bun:test";
import { parseBundledFontManifest, parseLocalFonts } from "@bg/shared";
import { bundledFontFiles } from "../src/data/bundled-fonts";
import { settingsRoutes } from "../src/routes/settings";
import { classifyApiRoute } from "../src/server";

test("Given assets/fonts/manifest.json When the bundled-fonts endpoint is read Then every manifest family is listed (CSS-10)", async () => {
  expect(classifyApiRoute("/api/settings/bundled-fonts", "GET")).toBe("settings");
  const manifest = JSON.parse((await bundledFontFiles()).get("manifest.json")!.bytes.toString("utf8")) as { readonly families: readonly { readonly family: string }[] };
  const expected = [...new Set(manifest.families.map((entry) => entry.family))].sort();
  expect(expected.length).toBeGreaterThan(7);
  const response = await settingsRoutes.request("http://local/api/settings/bundled-fonts");
  expect(response.status).toBe(200);
  const families = parseLocalFonts((await response.json()).data).families;
  expect(families).toEqual(expected);
  for (const family of ["Noto Sans KR", "SUIT", "Geist", "Newsreader"]) expect(families).toContain(family);
});

test("Given a manifest document When parsed Then families are unique and sorted, and malformed entries are rejected", () => {
  expect(parseBundledFontManifest({ families: [{ family: "SUIT", file: "SUIT.woff2" }, { family: "Geist" }, { family: "SUIT" }] })).toEqual({ schema_version: 1, families: ["Geist", "SUIT"] });
  for (const bad of [null, {}, { families: "SUIT" }, { families: [{ family: "" }] }, { families: [{ family: "C:\\fonts\\a.ttf" }] }, { families: [{}] }]) expect(() => parseBundledFontManifest(bad)).toThrow();
});
