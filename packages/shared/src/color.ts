// Original algebra from CSS Color 4 / WCAG 2 and the published OKLab matrices.
// Continuous certificate and floating-point budget: .omo/evidence/bg-themes-1028/a-core/color-standard-alignment.md.
import { isRecord } from "./contract-parser";
import { INVERSE, LAB_ROOT, RGB_LMS, ROOT_LAB, certifiedChroma, certifiedMember,
  type ColorGamut, type ColorVector } from "./color-gamut";

export type { ColorGamut, ColorVector } from "./color-gamut";
export type RgbColor<G extends ColorGamut = ColorGamut> = {
  readonly space: G; readonly r: number; readonly g: number; readonly b: number;
};
export type LinearRgbColor = {
  readonly space: "srgb-linear" | "display-p3-linear";
  readonly r: number; readonly g: number; readonly b: number;
};
export type OklabColor = { readonly l: number; readonly a: number; readonly b: number };
export type OklchColor = { readonly l: number; readonly c: number; readonly h: number };
export class ColorContractError extends Error {
  readonly code = "invalid_color";
  constructor(readonly field: string) { super(`Invalid color field: ${field}`); }
}

function bounded(value: unknown, range: readonly [number, number], field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < range[0] || value > range[1]) {
    throw new ColorContractError(field);
  }
  return value === 0 ? 0 : value;
}
function record(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
  if (!isRecord(value) || Object.keys(value).length !== keys.length ||
      keys.some(key => !Object.hasOwn(value, key))) throw new ColorContractError("shape");
  return value;
}
export function parseColorGamut(value: unknown): ColorGamut {
  switch (value) {
    case "srgb": case "display-p3": return value;
    default: throw new ColorContractError("space");
  }
}
export function normalizeHue(value: number): number {
  bounded(value, [-Number.MAX_VALUE, Number.MAX_VALUE], "h");
  const reduced = value % 360;
  const positive = reduced < 0 ? reduced + 360 : reduced;
  return positive === 0 || positive === 360 ? 0 : positive;
}
export function parseOklch(value: unknown): OklchColor {
  const v = record(value, ["l", "c", "h"]);
  return { l: bounded(v.l, [0, 1], "l"), c: bounded(v.c, [0, 4], "c"),
    h: normalizeHue(bounded(v.h, [-Number.MAX_VALUE, Number.MAX_VALUE], "h")) };
}
export function parseOklab(value: unknown): OklabColor {
  const v = record(value, ["l", "a", "b"]);
  return { l: bounded(v.l, [0, 1], "l"), a: bounded(v.a, [-4, 4], "a"), b: bounded(v.b, [-4, 4], "b") };
}
/** Encoded input is a physical, opaque RGB colour. Extended conversion results are not clipped. */
export function parseRgb(value: unknown): RgbColor {
  const v = record(value, ["space", "r", "g", "b"]);
  return { space: parseColorGamut(v.space), r: bounded(v.r, [0, 1], "r"),
    g: bounded(v.g, [0, 1], "g"), b: bounded(v.b, [0, 1], "b") };
}
export function parseLinearRgb(value: unknown): LinearRgbColor {
  const v = record(value, ["space", "r", "g", "b"]);
  switch (v.space) {
    case "srgb-linear": case "display-p3-linear":
      return { space: v.space, r: bounded(v.r, [-65536, 65536], "r"),
        g: bounded(v.g, [-65536, 65536], "g"), b: bounded(v.b, [-65536, 65536], "b") };
    default: throw new ColorContractError("space");
  }
}
export function parseHexColor(value: unknown): RgbColor<"srgb"> {
  if (typeof value !== "string" || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) {
    throw new ColorContractError("hex");
  }
  const hex = value.length === 4 ? [...value.slice(1)].map(c => c + c).join("") : value.slice(1);
  const n = Number.parseInt(hex, 16);
  return { space: "srgb", r: (n >>> 16) / 255, g: ((n >>> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function srgbToLinear(value: number): number {
  bounded(value, [-65536, 65536], "channel");
  const a = Math.abs(value);
  return a <= 0.04045 ? value / 12.92 : Math.sign(value) * ((a + 0.055) / 1.055) ** 2.4;
}
export function linearToSrgb(value: number): number {
  bounded(value, [-65536, 65536], "channel");
  const a = Math.abs(value);
  if (a === 1) return value; // Exact transfer endpoints, not clipping.
  return a <= 0.0031308 ? value * 12.92 : Math.sign(value) * (1.055 * a ** (1 / 2.4) - 0.055);
}
const LINEAR_SPACES = { srgb: "srgb-linear", "display-p3": "display-p3-linear" } as const;
const ENCODED_SPACES = { "srgb-linear": "srgb", "display-p3-linear": "display-p3" } as const;
export function rgbToLinear(color: RgbColor): LinearRgbColor {
  return { space: LINEAR_SPACES[color.space], r: srgbToLinear(color.r),
    g: srgbToLinear(color.g), b: srgbToLinear(color.b) };
}
export function linearToRgb(color: LinearRgbColor): RgbColor {
  return { space: ENCODED_SPACES[color.space], r: linearToSrgb(color.r),
    g: linearToSrgb(color.g), b: linearToSrgb(color.b) };
}

function dot(a: ColorVector, b: ColorVector): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function linearRgbToOklab(color: LinearRgbColor): OklabColor {
  if (color.r === color.g && color.g === color.b) return { l: Math.cbrt(color.r), a: 0, b: 0 };
  const rgb: ColorVector = [color.r, color.g, color.b];
  const m = RGB_LMS[ENCODED_SPACES[color.space]];
  const roots: ColorVector = [Math.cbrt(dot(m[0], rgb)), Math.cbrt(dot(m[1], rgb)), Math.cbrt(dot(m[2], rgb))];
  return { l: dot(ROOT_LAB[0], roots), a: dot(ROOT_LAB[1], roots), b: dot(ROOT_LAB[2], roots) };
}
export function oklabToLinearRgb(color: OklabColor, gamut: ColorGamut = "srgb"): LinearRgbColor {
  const { l, a, b } = color;
  // Achromatic semantics deliberately differ from finite-matrix inversion at C=0.
  if (a === 0 && b === 0) return { space: LINEAR_SPACES[gamut], r: l * l * l, g: l * l * l, b: l * l * l };
  const cubes = LAB_ROOT.map(row => {
    const root = dot(row, [l, a, b]);
    return root * root * root;
  });
  const channel = (w: ColorVector) => w[0] * cubes[0] + w[1] * cubes[1] + w[2] * cubes[2];
  const m = INVERSE[gamut];
  return { space: LINEAR_SPACES[gamut], r: channel(m[0]), g: channel(m[1]), b: channel(m[2]) };
}
// Taylor on [0, pi/4], then exact quadrant symmetries: no host-libm accuracy assumption.
function hueDirection(hue: number): readonly [number, number] {
  const h = normalizeHue(hue);
  const quadrant = Math.floor(h / 90);
  const degrees = h - quadrant * 90;
  const x = Math.min(degrees, 90 - degrees) * (Math.PI / 180);
  let sin = x, cos = 1, s = x, c = 1;
  for (let n = 1; n <= 9; n++) {
    s *= -x * x / ((2 * n) * (2 * n + 1));
    c *= -x * x / ((2 * n - 1) * (2 * n));
    sin += s; cos += c;
  }
  const u = degrees <= 45 ? cos : sin;
  const v = degrees <= 45 ? sin : cos;
  switch (quadrant) {
    case 0: return [u, v];
    case 1: return [-v, u];
    case 2: return [-u, -v];
    default: return [v, -u]; // normalized hue makes the remaining quadrant exactly 3
  }
}
export function oklchToOklab(color: OklchColor): OklabColor {
  const [x, y] = hueDirection(color.h);
  return { l: color.l, a: color.c * x, b: color.c * y };
}
export function oklabToOklch(color: OklabColor): OklchColor {
  const c = Math.hypot(color.a, color.b);
  return { l: color.l, c, h: c === 0 ? 0 : normalizeHue(Math.atan2(color.b, color.a) * 180 / Math.PI) };
}
export function rgbToOklch(color: RgbColor): OklchColor { return oklabToOklch(linearRgbToOklab(rgbToLinear(color))); }
export function oklchToRgb(color: OklchColor, gamut: ColorGamut = "srgb"): RgbColor {
  return linearToRgb(oklabToLinearRgb(oklchToOklab(color), gamut));
}
export function convertRgb(color: RgbColor, gamut: ColorGamut): RgbColor {
  return color.space === gamut ? color : linearToRgb(oklabToLinearRgb(linearRgbToOklab(rgbToLinear(color)), gamut));
}
export function isInGamut(color: OklchColor, gamut: ColorGamut = "srgb"): boolean {
  return certifiedMember(color.l, { c: color.c, direction: hueDirection(color.h) }, gamut);
}

/** Largest certified neutral-connected radial prefix; numerical resolution <= 2e-9 C. */
export function maxChroma(l: number, h: number, gamut: ColorGamut = "srgb"): number {
  bounded(l, [0, 1], "l");
  return certifiedChroma(l, hueDirection(h), gamut);
}
/** Shared C for these exact hues, including every radial position from zero to the result. */
export function selectedHueChroma(l: number, hues: readonly number[], gamut: ColorGamut = "srgb"): number {
  if (hues.length === 0 || hues.length > 64) throw new ColorContractError("hues");
  return Math.min(...hues.map(h => maxChroma(l, h, gamut)));
}
/** Certified whole disk, not a hue-grid minimum. Quarter-circle parameter t covers [0,1]. */
export function allHueChroma(l: number, gamut: ColorGamut = "srgb"): number {
  bounded(l, [0, 1], "l");
  return certifiedChroma(l, null, gamut);
}
export function gamutMapOklch(color: OklchColor, gamut: ColorGamut = "srgb"): OklchColor {
  return isInGamut(color, gamut) ? color : { ...color, c: Math.min(color.c, maxChroma(color.l, color.h, gamut)) };
}
export function deltaEOK(a: OklabColor, b: OklabColor): number {
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);
}
export function hueDistance(a: number, b: number): number {
  const distance = Math.abs(normalizeHue(a) - normalizeHue(b));
  return Math.min(distance, 360 - distance);
}
/** WCAG 2 is defined for sRGB. P3 callers must explicitly select their sRGB fallback. */
export function relativeLuminance(color: RgbColor): number {
  if (color.space !== "srgb") throw new ColorContractError("wcag_srgb");
  const rgb = rgbToLinear(parseRgb(color));
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
}
export function wcag2Contrast(a: RgbColor, b: RgbColor): number {
  const x = relativeLuminance(a), y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Full decimal round-trip precision; no quantisation that could cross a certified boundary. */
export function rgbToCss(color: RgbColor): string {
  return `color(${color.space} ${color.r} ${color.g} ${color.b})`;
}
export function oklchToCss(color: OklchColor): string {
  return `oklch(${color.l} ${color.c} ${normalizeHue(color.h)})`;
}
export function rgbToHex(color: RgbColor): string {
  if (color.space !== "srgb") throw new ColorContractError("hex_srgb");
  const v = parseRgb(color);
  return "#" + [v.r, v.g, v.b].map(c => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
}
