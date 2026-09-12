import { describe, expect, test } from "bun:test";
import { normalizeSideDraft } from "../src/components/modes/tweaks-utils";

describe("box model numeric input", () => {
  test("padding and corner radii clamp negative values while margins preserve them", () => {
    expect(normalizeSideDraft("padding", "-8")).toBe("0");
    expect(normalizeSideDraft("border-radius", "-0.5")).toBe("0");
    expect(normalizeSideDraft("margin", "-8.5")).toBe("-8.5");
  });

  test("empty values clear overrides and finite decimal values normalize", () => {
    expect(normalizeSideDraft("padding", "  ")).toBe("");
    expect(normalizeSideDraft("padding", " 08.50 ")).toBe("8.5");
    expect(normalizeSideDraft("margin", "-0")).toBe("0");
  });

  test("malformed and nonfinite values are rejected without producing CSS", () => {
    for (const value of ["abc", "-", ".", "8px", "1e3", "9".repeat(400)]) {
      expect(normalizeSideDraft("padding", value)).toBeNull();
    }
  });
});
