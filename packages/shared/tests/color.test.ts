import { expect, test } from "bun:test";
import {
  ColorContractError, allHueChroma, convertRgb, deltaEOK, gamutMapOklch, hueDistance,
  isInGamut, linearRgbToOklab, linearToRgb, linearToSrgb, maxChroma, normalizeHue,
  oklabToLinearRgb, oklabToOklch, oklchToCss, oklchToOklab, oklchToRgb,
  parseColorGamut, parseHexColor, parseLinearRgb, parseOklab, parseOklch, parseRgb,
  relativeLuminance, rgbToCss, rgbToHex, rgbToLinear, rgbToOklch, selectedHueChroma,
  srgbToLinear, wcag2Contrast, type OklchColor,
} from "../src/color";

const GAMUTS = ["srgb", "display-p3"] as const;
const LEVELS = [0, 1e-120, 1e-12, 0.001, 0.23, 0.5, 0.79, 0.999, 1 - 1e-12, 1] as const;
const HUES = [0, 29.233885, 90, 142.495339, 180, 264.052021, 328.363417, 359.999999] as const;
// Frozen calibration rays; downward decimal truncations of the independent 90-digit
// lower brackets in a/independent-max-chroma-output.json, NOT production expectations.
const FIXED_RAYS = [
  { l: 0.7, h: 30, c: 0.4, srgb: 0.1915123012366331, "display-p3": 0.2431219182143016 },
  { l: 0.7, h: 260, c: 0.4, srgb: 0.1574169600797032, "display-p3": 0.1703799603026575 },
  { l: 0.98, h: 145, c: 0.1, srgb: 0.03368197890719693, "display-p3": 0.03726391669105388 },
  { l: 0.02, h: 260, c: 0.1, srgb: 0.00815807740476922, "display-p3": 0.01027016428303356 },
] as const;

test("Given malformed colour records When parsed Then invalid boundaries are rejected", () => {
  const invalid = [null, [], "red", {}, { l: 0.5, c: 0.1, h: 20, alpha: 1 }];
  for (const value of invalid) expect(() => parseOklch(value)).toThrow(ColorContractError);
  for (const value of [NaN, Infinity, -Infinity, "0.5", undefined]) {
    for (const field of ["l", "c", "h"]) {
      expect(() => parseOklch({ l: 0.5, c: 0.1, h: 20, [field]: value })).toThrow(ColorContractError);
    }
  }
  for (const value of [{ l: -0.01, c: 0, h: 0 }, { l: 1.01, c: 0, h: 0 },
    { l: 0.5, c: -0.01, h: 0 }, { l: 0.5, c: 4.01, h: 0 }]) {
    expect(() => parseOklch(value)).toThrow(ColorContractError);
  }
  expect(() => parseOklab({ l: 0.5, a: NaN, b: 0 })).toThrow(ColorContractError);
  expect(() => parseOklab({ l: 0.5, a: 0, b: 5 })).toThrow(ColorContractError);
  expect(() => parseRgb({ space: "srgb", r: -0.01, g: 0, b: 0 })).toThrow(ColorContractError);
  expect(() => parseRgb({ space: "srgb", r: 1.01, g: 0, b: 0 })).toThrow(ColorContractError);
  expect(() => parseLinearRgb({ space: "srgb", r: 0, g: 0, b: 0 })).toThrow(ColorContractError);
  expect(() => parseLinearRgb({ space: "srgb-linear", r: Infinity, g: 0, b: 0 })).toThrow(ColorContractError);
  expect(() => parseColorGamut("p3")).toThrow(ColorContractError);
});

test("Given invalid scalar boundaries When queried Then the engine rejects them", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    expect(() => normalizeHue(value)).toThrow(ColorContractError);
    expect(() => srgbToLinear(value)).toThrow(ColorContractError);
    expect(() => linearToSrgb(value)).toThrow(ColorContractError);
    expect(() => maxChroma(value, 30)).toThrow(ColorContractError);
    expect(() => allHueChroma(value)).toThrow(ColorContractError);
  }
  expect(() => maxChroma(0.5, NaN)).toThrow(ColorContractError);
  expect(() => allHueChroma(-0.1)).toThrow(ColorContractError);
  expect(() => selectedHueChroma(0.5, [])).toThrow(ColorContractError);
  expect(() => selectedHueChroma(0.5, Array(65).fill(0))).toThrow(ColorContractError);
});

test("Given finite hue values When normalized Then wraparound and signed zero are canonical", () => {
  for (const [h, expected] of [[-30, 330], [390, 30], [720, 0], [-0, 0], [-Number.MIN_VALUE, 0]]) {
    expect(normalizeHue(h)).toBe(expected);
  }
  for (const h of [Number.MAX_VALUE, -Number.MAX_VALUE]) {
    expect(normalizeHue(h)).toBeGreaterThanOrEqual(0);
    expect(normalizeHue(h)).toBeLessThan(360);
  }
  expect(parseOklch({ l: 0.5, c: 0, h: -30 })).toEqual({ l: 0.5, c: 0, h: 330 });
});

test("Given transfer-function breakpoints When converted Then signed standard branches apply", () => {
  const cases = [[0, 0], [0.04045, 0.04045 / 12.92], [0.5, 0.21404114048223255], [1, 1]];
  for (const [encoded, linear] of cases) {
    expect(srgbToLinear(encoded)).toBeCloseTo(linear, 14);
    expect(srgbToLinear(-encoded)).toBeCloseTo(-linear, 14);
  }
  expect(linearToSrgb(0.0031308)).toBe(0.0031308 * 12.92);
  expect(linearToSrgb(-0.0031308)).toBe(-0.0031308 * 12.92);
  expect(srgbToLinear(0.04045001)).toBeGreaterThan(srgbToLinear(0.04045));
  expect(linearToSrgb(0.00313081)).toBeGreaterThan(linearToSrgb(0.0031308));
  expect(srgbToLinear(1.2)).toBeGreaterThan(1);
  expect(linearToSrgb(-0.1)).toBeLessThan(0);
});

test("Given sRGB primaries When converted Then published OKLab coordinates agree", () => {
  // Published OKLab coordinate examples, not the independent browser oracle owned by root.
  const cases = [
    { hex: "#ff0000", lab: [0.62795536, 0.22486306, 0.12584630] },
    { hex: "#00ff00", lab: [0.86643961, -0.23388757, 0.17949848] },
    { hex: "#0000ff", lab: [0.45201372, -0.03245698, -0.31152815] },
  ];
  for (const { hex, lab } of cases) {
    const actual = linearRgbToOklab(rgbToLinear(parseHexColor(hex)));
    expect(actual.l).toBeCloseTo(lab[0], 7);
    expect(actual.a).toBeCloseTo(lab[1], 7);
    expect(actual.b).toBeCloseTo(lab[2], 7);
  }
});

for (const gamut of GAMUTS) {
  test(`Given ${gamut} neutrals When converted Then black white and gray remain achromatic`, () => {
    for (const l of [0, 0.5, 1]) {
      const linear = oklabToLinearRgb({ l, a: 0, b: 0 }, gamut);
      expect([linear.r, linear.g, linear.b]).toEqual([l ** 3, l ** 3, l ** 3]);
      expect(isInGamut({ l, c: 0, h: 260 }, gamut)).toBe(true);
    }
    expect(oklchToRgb({ l: 1, c: 0, h: 260 }, gamut)).toEqual({ space: gamut, r: 1, g: 1, b: 1 });
    for (const value of [0, 1e-12, 0.004, 0.18, 0.5, 1]) {
      const color = parseRgb({ space: gamut, r: value, g: value, b: value });
      const lch = rgbToOklch(color);
      expect(lch.c).toBe(0);
      expect(lch.h).toBe(0);
      const actual = oklchToRgb(lch, gamut);
      expect(actual.r).toBeCloseTo(value, 13);
      expect(actual.g).toBeCloseTo(value, 13);
      expect(actual.b).toBeCloseTo(value, 13);
      expect(convertRgb(color, gamut)).toBe(color);
    }
  });

  test(`Given independent ${gamut} boundaries When mapping overshoots Then strict prefixes stay below them`, () => {
    for (const ray of FIXED_RAYS) for (const c of [ray.c, ray[gamut] + 1e-10]) {
      const result = gamutMapOklch({ l: ray.l, c, h: ray.h }, gamut);
      expect([result.l, result.h]).toEqual([ray.l, ray.h]);
      expect(result.c).toBeGreaterThan(0);
      expect(result.c).toBeLessThanOrEqual(ray[gamut]);
      expect(ray[gamut] - result.c).toBeLessThan(1e-7);
      // Brackets certify independent membership; also expose actual extended channels.
      for (const fraction of [0.13, 0.5, 1]) {
        const rgb = oklabToLinearRgb(oklchToOklab({ ...result, c: result.c * fraction }), gamut);
        for (const channel of [rgb.r, rgb.g, rgb.b]) {
          expect(channel).toBeGreaterThan(0);
          expect(channel).toBeLessThan(1);
        }
      }
    }
  });
  test(`Given points just outside independent ${gamut} boundaries When classified Then bypass is rejected`, () => {
    for (const ray of FIXED_RAYS) {
      expect(isInGamut({ l: ray.l, c: ray[gamut] + 1e-10, h: ray.h }, gamut)).toBe(false);
    }
  });
  test(`Given points just inside independent ${gamut} boundaries When mapped Then identity is preserved`, () => {
    for (const ray of FIXED_RAYS) {
      const source = { l: ray.l, c: ray[gamut] - 1e-10, h: ray.h };
      expect(gamutMapOklch(source, gamut)).toBe(source);
    }
  });

  test(`Given a fixed ${gamut} RGB lattice When roundtripped Then inverse consistency holds`, () => {
    // An internal consistency regression only; it is not independent conversion evidence.
    for (let r = 0; r <= 4; r++) for (let g = 0; g <= 4; g++) for (let b = 0; b <= 4; b++) {
      const source = parseRgb({ space: gamut, r: r / 4, g: g / 4, b: b / 4 });
      const result = oklchToRgb(rgbToOklch(source), gamut);
      expect(Math.max(Math.abs(source.r - result.r), Math.abs(source.g - result.g),
        Math.abs(source.b - result.b))).toBeLessThan(2e-8);
    }
  });

  test(`Given fixed ${gamut} rays When bounded Then every smaller chroma is safe and the bound is tight`, () => {
    for (const l of [0.001, 0.23, 0.5, 0.79, 0.999]) for (const h of HUES) {
      const bound = maxChroma(l, h, gamut);
      expect(bound).toBeGreaterThan(0);
      for (const fraction of [0, 0.13, 0.5, 0.91, 1]) {
        expect(isInGamut({ l, c: bound * fraction, h }, gamut)).toBe(true);
      }
      expect(isInGamut({ l, c: bound + 1e-7, h }, gamut)).toBe(false);
    }
  });

  test(`Given ${gamut} full-circle bounds When adversarial angles are sampled Then the whole disk stays safe`, () => {
    for (const l of LEVELS) {
      const bound = allHueChroma(l, gamut);
      expect(Number.isFinite(bound)).toBe(true);
      expect(bound).toBeGreaterThanOrEqual(0);
      if (l > 1e-100 && l < 1 - 1e-10) expect(bound).toBeGreaterThan(0);
      for (let i = 0; i < 257; i++) {
        const h = normalizeHue(i * 137.50776405003785 + 0.0000137);
        for (const fraction of [0, 0.371, 0.999999, 1]) {
          expect(isInGamut({ l, c: bound * fraction, h }, gamut)).toBe(true);
        }
      }
      for (const h of [90 - 1e-9, 90 + 1e-9, 180 - 1e-9, 270 + 1e-9, 360 - 1e-9]) {
        expect(isInGamut({ l, c: bound, h }, gamut)).toBe(true);
      }
    }
  });

  test(`Given selected ${gamut} hues When sharing chroma Then no per-hue clipping is needed`, () => {
    const l = 0.63, hues = [17.23, 143.79, 277.12];
    const common = selectedHueChroma(l, hues, gamut);
    const circle = allHueChroma(l, gamut);
    expect(common).toBe(Math.min(...hues.map(h => maxChroma(l, h, gamut))));
    expect(common).toBeGreaterThanOrEqual(circle);
    for (const h of hues) {
      const requested: OklchColor = { l, c: common, h };
      expect(gamutMapOklch(requested, gamut)).toBe(requested);
    }
  });

  test(`Given an excessive ${gamut} chroma When mapped Then only chroma changes`, () => {
    const source: OklchColor = { l: 0.62, c: 0.9, h: 273.123456 };
    const result = gamutMapOklch(source, gamut);
    expect(result.l).toBe(source.l);
    expect(result.h).toBe(source.h);
    expect(result.c).toBeLessThan(source.c);
    expect(isInGamut(result, gamut)).toBe(true);
    expect(isInGamut({ ...result, c: result.c + 1e-7 }, gamut)).toBe(false);
  });
}

test("Given a P3-only primary When converted Then extended sRGB channels survive without clipping", () => {
  const p3 = parseRgb({ space: "display-p3", r: 1, g: 0, b: 0 });
  const srgb = convertRgb(p3, "srgb");
  expect(srgb.r).toBeGreaterThan(1);
  expect(srgb.g).toBeLessThan(0);
  expect(srgb.b).toBeLessThan(0);
  const linear = rgbToLinear(srgb);
  // Derived from the two standard primary matrices, independently of the OKLab path.
  expect(linear.r).toBeCloseTo(1.2249401762805598, 8);
  expect(linear.g).toBeCloseTo(-0.0420569547096882, 8);
  expect(linear.b).toBeCloseTo(-0.0196375545903344, 8);
  expect(() => wcag2Contrast(p3, parseHexColor("#fff"))).toThrow(ColorContractError);
  expect(() => rgbToHex(p3)).toThrow(ColorContractError);
});

test("Given extended linear channels When encoded Then sign and overshoot remain observable", () => {
  const color = parseLinearRgb({ space: "display-p3-linear", r: -0.03, g: 1.2, b: 0.4 });
  const encoded = linearToRgb(color);
  expect(encoded.r).toBeLessThan(0);
  expect(encoded.g).toBeGreaterThan(1);
  expect(rgbToLinear(encoded).b).toBeCloseTo(color.b, 14);
});

test("Given known sRGB pairs When contrasted Then WCAG ratios and luminance agree", () => {
  const black = parseHexColor("#000"), white = parseHexColor("#fff");
  expect(wcag2Contrast(black, white)).toBe(21);
  expect(wcag2Contrast(white, black)).toBe(21);
  expect(wcag2Contrast(white, white)).toBe(1);
  expect(relativeLuminance(parseHexColor("#ff0000"))).toBe(0.2126);
  expect(wcag2Contrast(parseHexColor("#777"), white)).toBeCloseTo(4.478089453577214, 12);
});

test("Given colour distances When measured Then circular hue and Cartesian OKLab units apply", () => {
  expect(hueDistance(359, 1)).toBe(2);
  expect(hueDistance(-10, 350)).toBe(0);
  expect(deltaEOK({ l: 0.5, a: 0.1, b: 0.2 }, { l: 0.5, a: 0.4, b: 0.6 })).toBeCloseTo(0.5, 15);
  expect(oklabToOklch({ l: 0.5, a: 0, b: 0 }).h).toBe(0);
  for (const h of HUES) {
    const lch: OklchColor = { l: 0.5, c: 0.2, h };
    expect(hueDistance(oklabToOklch(oklchToOklab(lch)).h, h)).toBeLessThan(1e-10);
  }
});

test("Given valid colour values When serialized Then CSS numeric precision is preserved", () => {
  const lch = parseOklch({ l: 0.6345678901234567, c: 0.1456789012345678, h: 231.1234567890123 });
  const css = oklchToCss(lch);
  expect(css.slice(6, -1).split(" ").map(Number)).toEqual([lch.l, lch.c, lch.h]);
  const p3 = parseRgb({ space: "display-p3", r: 0.12345678901234567, g: 0.5, b: 1 });
  expect(rgbToCss(p3).slice(6, -1).split(" ")).toEqual(["display-p3", String(p3.r), "0.5", "1"]);
  expect(rgbToHex(parseHexColor("#aBc"))).toBe("#aabbcc");
  for (const hex of ["red", "#12", "#1234", "#12345678", "#gggggg", " #fff"]) {
    expect(() => parseHexColor(hex)).toThrow(ColorContractError);
  }
});
