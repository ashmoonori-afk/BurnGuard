import { describe, expect, test } from "bun:test";
import { LOGO_PAGE } from "@bg/shared";
import { designAuditCanvas } from "../src/services/design-audit";

describe("designAuditCanvas", () => {
  test("Given a logo project When the audit canvas is resolved Then the constant logo page is used, never website viewports", () => {
    expect(designAuditCanvas("logo", JSON.stringify({ graphic_canvas: null }))).toEqual(LOGO_PAGE);
    expect(designAuditCanvas("logo", "{}")).toEqual({ width: 1920, height: 1080 });
  });

  test("Given a graphic project When resolved Then its stored canvas is used", () => {
    const canvas = { schema_version: 1, width: 1080, height: 1350 };
    expect(designAuditCanvas("graphic", JSON.stringify({ graphic_canvas: canvas }))).toEqual(canvas);
  });

  test("Given a website or deck project When resolved Then there is no fixed canvas", () => {
    expect(designAuditCanvas("prototype", "{}")).toBeUndefined();
    expect(designAuditCanvas("slide_deck", "{}")).toBeUndefined();
  });
});
