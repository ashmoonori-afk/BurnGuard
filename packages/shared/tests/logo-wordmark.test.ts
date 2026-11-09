import { describe, expect, test } from "bun:test";
import { LogoWordmarkError, parseLogoWordmarkV1, reviewLogoWordmark, type LogoWordmarkCompiled } from "../src/index";

const VALID = { schema_version: 1, text: "Burn Guard", font: "Geist", cap_height: 16, stem: 2, tracking: 1 };

function refusal(input: unknown): string {
  try {
    parseLogoWordmarkV1(input);
  } catch (error) {
    if (error instanceof LogoWordmarkError) return `${error.code} ${error.path}`;
    throw error;
  }
  return "accepted";
}

describe("wordmark record", () => {
  test("Given a record on the grid When parsed Then it is kept as written and nothing is snapped", () => {
    expect(parseLogoWordmarkV1(JSON.stringify(VALID))).toEqual({ wordmark: VALID, snapped: [] });
  });

  test("Given metrics off the grid When parsed Then each is moved to the nearest half unit and named", () => {
    const result = parseLogoWordmarkV1({ ...VALID, cap_height: 16.3, stem: 1.9, tracking: -0.2 });
    expect(result.wordmark).toMatchObject({ cap_height: 16.5, stem: 2, tracking: 0 });
    expect(Object.is(result.wordmark.tracking, -0)).toBe(false);
    expect(result.snapped).toEqual(["$.cap_height", "$.stem", "$.tracking"]);
  });

  test("Given a malformed record When parsed Then it is refused with a stable code and path", () => {
    expect(refusal("{")).toBe("invalid_json $");
    expect(refusal([])).toBe("expected_object $");
    expect(refusal({ ...VALID, weight: 700 })).toBe("unknown_field $.weight");
    const { stem: _stem, ...missing } = VALID;
    expect(refusal(missing)).toBe("missing_field $.stem");
    expect(refusal({ ...VALID, schema_version: 2 })).toBe("invalid_field $.schema_version");
    expect(refusal({ ...VALID, text: "번가드" })).toBe("invalid_field $.text");
    expect(refusal({ ...VALID, text: " Burn" })).toBe("invalid_field $.text");
    expect(refusal({ ...VALID, text: "Burn  Guard" })).toBe("invalid_field $.text");
    expect(refusal({ ...VALID, text: "B".repeat(25) })).toBe("out_of_range $.text");
    expect(refusal({ ...VALID, font: "Geist/../x" })).toBe("invalid_field $.font");
    expect(refusal({ ...VALID, font: "Geist " })).toBe("invalid_field $.font");
    expect(refusal({ ...VALID, cap_height: 33 })).toBe("out_of_range $.cap_height");
    expect(refusal({ ...VALID, stem: 0 })).toBe("out_of_range $.stem");
    expect(refusal({ ...VALID, tracking: "1" })).toBe("invalid_field $.tracking");
    expect(refusal({ ...VALID, tracking: Number.NaN })).toBe("invalid_field $.tracking");
  });
});

describe("wordmark review", () => {
  const set = (asked: number, measured: number): LogoWordmarkCompiled => ({
    path: "",
    width: 0,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    metrics: { cap_height: 16, baseline: 16, x_height: 12, ascender: 22, descender: 6, stem: asked, tracking: 0 },
    font: { family: "Geist", file: "Geist.woff2", weight: 400 },
    stem_measured: measured,
    glyphs: [],
  });

  test("Given a stem within a quarter unit of the ask When reviewed Then it passes", () => {
    expect(reviewLogoWordmark(set(2, 1.938))).toEqual({ passed: true, findings: [] });
    expect(reviewLogoWordmark(set(2, 2.25))).toEqual({ passed: true, findings: [] });
  });

  test("Given a stem further off When reviewed Then the finding names both values", () => {
    expect(reviewLogoWordmark(set(3, 1.938))).toEqual({ passed: false, findings: [{ kind: "stem_off", asked: 3, measured: 1.938 }] });
  });
});
