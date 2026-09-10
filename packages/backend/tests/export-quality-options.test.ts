import { expect, test } from "bun:test";
import { parseExportOptions } from "@bg/shared";
test("Given quality-check choice When parsing Then only explicit HTML booleans are accepted", () => {
  expect(parseExportOptions("html_zip", {})).toEqual({});
  for (const value of [true, false]) expect(parseExportOptions("html_zip", { skip_quality_check: value })).toEqual({ skip_quality_check: value });
  for (const value of ["true", 1, null]) expect(() => parseExportOptions("html_zip", { skip_quality_check: value })).toThrow();
  for (const format of ["pdf", "png", "pptx", "handoff"] as const) expect(() => parseExportOptions(format, { skip_quality_check: true })).toThrow();
});
