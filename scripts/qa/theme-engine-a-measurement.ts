import { gamutMapOklch, hueDistance, isInGamut, rgbToOklch,
  type ColorGamut, type OklchColor } from "../../packages/shared/src/color";
import { createDefaultPalette, samplePalette, type PaletteScale } from "../../packages/shared/src/palette";
import { isRecord } from "../../packages/shared/src/contract-parser";
import type { OracleCase, OracleReceipt } from "./theme-engine-oracle";

export class MeasurementError extends Error {
  constructor(readonly code: string) { super(code); this.name = "MeasurementError"; }
}
export function requireMeasurement(condition: boolean, code = "EVIDENCE_INVALID"): asserts condition {
  if (!condition) throw new MeasurementError(code);
}
export function record(value: unknown): Readonly<Record<string, unknown>> {
  requireMeasurement(isRecord(value));
  return value;
}
export function number(value: unknown): number {
  requireMeasurement(typeof value === "number" && Number.isFinite(value));
  return value;
}
export function text(value: unknown): string {
  requireMeasurement(typeof value === "string" && value.length > 0 && value.length < 200);
  return value;
}
export function gamut(value: unknown): ColorGamut {
  requireMeasurement(value === "srgb" || value === "display-p3");
  return value;
}
export function collection(value: unknown, count: number): readonly unknown[] {
  requireMeasurement(Array.isArray(value) && value.length === count);
  return value;
}
export function color(value: unknown): OklchColor {
  const v = record(value), l = number(v.l), c = number(v.c), h = number(v.h);
  requireMeasurement(l >= 0 && l <= 1 && c >= 0 && c <= 4 && h >= 0 && h <= 360);
  return { l, c, h };
}
export type RgbInput = { readonly id: string; readonly gamut: ColorGamut; readonly rgb: readonly [number, number, number] };
export function parseRgbRows(value: unknown, count: number, space?: ColorGamut): readonly RgbInput[] {
  const ids = new Set<string>();
  return collection(record(value).rows, count).map(item => {
    const row = record(item), id = text(row.id), [r, g, b] = collection(row.rgb, 3).map(number);
    requireMeasurement(!ids.has(id) && r >= 0 && r <= 1 && g >= 0 && g <= 1 && b >= 0 && b <= 1);
    ids.add(id);
    return { id, gamut: space ?? gamut(row.gamut), rgb: [r, g, b] };
  });
}
export type Captured = {
  readonly id: string; readonly gamut: ColorGamut; readonly scale: string;
  readonly hue: number; readonly position: number; readonly color: OklchColor;
};
export function parseCaptured(value: unknown): readonly Captured[] {
  const rows = collection(record(value).rows, 144).map(item => {
    const r = record(item), position = number(r.position);
    requireMeasurement(position >= 0 && position <= 1);
    return { id: text(r.id), gamut: gamut(r.gamut), scale: text(r.scale),
      hue: number(r.scale_hue), position, color: color(r) };
  });
  requireMeasurement(new Set(rows.map(r => r.id)).size === 144);
  for (const g of ["srgb", "display-p3"] as const) {
    const group = rows.filter(r => r.gamut === g);
    requireMeasurement(group.length === 72 && new Set(group.map(r => r.scale)).size === 6);
    requireMeasurement(new Set(group.map(r => r.position)).size === 12);
  }
  return rows;
}
export const TOLERANCE = { lightness: 1e-9, chroma: 1e-7, retention_ratio: 1e-6, hue_degrees: 1e-5 } as const;
export type Calibration = {
  readonly id: string; readonly gamut: ColorGamut; readonly comparison: boolean;
  readonly requested: OklchColor; readonly delivered: OklchColor;
};
export function parseCalibration(value: unknown): readonly Calibration[] {
  const data = record(value), tolerance = record(data.tolerance);
  requireMeasurement(Object.keys(tolerance).length === 4
    && Object.entries(TOLERANCE).every(([key, expected]) => tolerance[key] === expected));
  const cases = collection(data.cases, 13).map(item => {
    const r = record(item);
    requireMeasurement(typeof r.comparison === "boolean");
    return { id: text(r.id), gamut: gamut(r.gamut), comparison: r.comparison,
      requested: color(r.requested), delivered: color(r.delivered) };
  });
  requireMeasurement(new Set(cases.map(r => r.id)).size === 13 && cases.filter(r => r.comparison).length === 12);
  requireMeasurement(cases.every(r => r.comparison === (r.id !== "brand-gamut-switch-p3-to-srgb")));
  return cases;
}

/** Exact decimal ordering: never round a 90-digit safe bracket through Number. */
function decimal(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  requireMeasurement(match !== null && value.length <= 180, "MAXIMUM_RECEIPT");
  const fraction = match[3] ?? "", power = 120 + Number(match[4] ?? 0) - fraction.length;
  requireMeasurement(Number.isInteger(power) && power >= 0 && power <= 240, "MAXIMUM_RECEIPT");
  return BigInt(`${match[1]}${match[2]}${fraction}`) * 10n ** BigInt(power);
}
export function compareBound(production: number, bracket: { readonly lo: string; readonly hi: string }) {
  const c = decimal(String(production)), lo = decimal(bracket.lo), hi = decimal(bracket.hi);
  requireMeasurement(lo >= 0n && hi > lo && hi - lo <= decimal("1e-20"), "MAXIMUM_RECEIPT");
  const difference = c - lo;
  return { strict_safe_bound: c <= lo, within_chroma_tolerance: difference <= decimal("1e-7")
    && difference >= -decimal("1e-7"), delta_from_safe_lower_c: production - Number(bracket.lo) };
}
export type MaximumRow = {
  readonly id: string; readonly gamut: ColorGamut; readonly captured_c: string;
  readonly independent_max_c: string; readonly production_c: string; readonly delta_c: string;
  readonly bracket: { readonly lo: string; readonly hi: string };
  readonly captured_member: boolean; readonly production_member: boolean;
};
export type MaximumBinding = {
  readonly input_sha256: string; readonly production_sha256: string;
  readonly cases: readonly Calibration[]; readonly production: readonly { readonly id: string; readonly color: OklchColor }[];
};
export function parseMaximum(value: unknown, binding: MaximumBinding): readonly MaximumRow[] {
  const v = record(value), checks = record(v.controls);
  requireMeasurement(Object.keys(v).length === 6 && v.schema_version === 1 && v.method === "decimal-outward-90-six-face-v1"
    && v.input_sha256 === binding.input_sha256 && v.production_sha256 === binding.production_sha256
    && checks.srgb === 9 && checks["display-p3"] === 9 && Object.keys(checks).length === 2, "MAXIMUM_RECEIPT");
  const rows = collection(v.rows, binding.cases.length).map((item, index): MaximumRow => {
    const r = record(item), c = binding.cases[index], p = binding.production[index], b = record(r.bracket);
    requireMeasurement(Object.keys(r).length === 9 && Object.keys(b).length === 2
      && c !== undefined && p !== undefined && r.id === c.id && r.id === p.id
      && r.gamut === c.gamut && typeof r.captured_member === "boolean" && typeof r.production_member === "boolean",
    "MAXIMUM_RECEIPT");
    const bracket = { lo: text(b.lo), hi: text(b.hi) };
    compareBound(p.color.c, bracket);
    requireMeasurement(decimal(text(r.captured_c)) === decimal(String(c.delivered.c))
      && decimal(text(r.production_c)) === decimal(String(p.color.c))
      && decimal(text(r.independent_max_c)) === decimal(bracket.lo)
      && decimal(text(r.delta_c)) === decimal(text(r.production_c)) - decimal(bracket.lo), "MAXIMUM_RECEIPT");
    return { id: c.id, gamut: c.gamut, captured_c: text(r.captured_c), independent_max_c: text(r.independent_max_c),
      production_c: text(r.production_c), delta_c: text(r.delta_c), bracket,
      captured_member: r.captured_member, production_member: r.production_member };
  });
  requireMeasurement(new Set(rows.map(r => r.id)).size === rows.length, "MAXIMUM_RECEIPT");
  return rows;
}
export function measureCalibration(binding: MaximumBinding, maxima: readonly MaximumRow[]) {
  return binding.cases.map((c, index) => {
    const maximum = maxima[index], produced = binding.production[index];
    requireMeasurement(maximum !== undefined && produced !== undefined && c.id === maximum.id && c.id === produced.id);
    const ours = produced.color, gray = c.requested.c === 0, bound = compareBound(ours.c, maximum.bracket);
    const referenceRetention = gray ? null : c.delivered.c / c.requested.c;
    const retention = gray ? null : ours.c / c.requested.c;
    const referenceDrift = gray || c.delivered.c === 0 ? null : hueDistance(c.delivered.h, c.requested.h);
    const drift = gray || ours.c === 0 ? null : hueDistance(ours.h, c.requested.h);
    const rawParity = maximum.captured_member
      && Math.abs(ours.l - c.delivered.l) <= TOLERANCE.lightness
      && Math.abs(ours.c - c.delivered.c) <= TOLERANCE.chroma
      && (gray || retention !== null && referenceRetention !== null && retention + TOLERANCE.retention_ratio >= referenceRetention)
      && (gray || drift !== null && referenceDrift !== null && drift <= referenceDrift + TOLERANCE.hue_degrees);
    const strict = maximum.production_member && bound.strict_safe_bound;
    const accepted = maximum.captured_member ? rawParity && strict : strict && bound.within_chroma_tolerance
      && Math.abs(ours.l - c.requested.l) <= TOLERANCE.lightness
      && drift !== null && drift <= TOLERANCE.hue_degrees;
    return { id: c.id, gamut: c.gamut, requested: c.requested, captured: c.delivered, production: ours,
      captured_c: maximum.captured_c, independent_max_c: maximum.independent_max_c, bracket: maximum.bracket,
      production_c: maximum.production_c, delta_c: maximum.delta_c, ...bound,
      captured_strict_membership: maximum.captured_member, production_strict_membership: maximum.production_member,
      rawParity: rawParity ? "PASS" : "FAILED", comparison: maximum.captured_member ? "ordinary-parity" : "independent-maximum",
      reference_retention: referenceRetention, production_retention: retention, reference_hue_drift: referenceDrift,
      production_hue_drift: drift, gray, status: accepted ? "PASS" : "FAIL" };
  });
}
export function measureScales(reference: readonly Captured[]) {
  return (["srgb", "display-p3"] as const).map(g => {
    const rows = reference.filter(r => r.gamut === g), initial = createDefaultPalette();
    const scales: readonly PaletteScale[] = [...new Map(rows.map(r => [r.scale, r])).values()].map(r =>
      r.scale === "Neutral" ? { id: r.scale, name: r.scale, kind: "neutral" }
        : { id: r.scale, name: r.scale, kind: "hue", hue: r.hue });
    const state = { ...initial, scales, gamut: g };
    const samples = new Map([...new Set(rows.map(r => r.position))].map(p => [p, samplePalette(state, p)]));
    const paired = rows.map(r => {
      const ours = samples.get(r.position)?.find(s => s.id === r.scale);
      requireMeasurement(ours !== undefined);
      return { ...r, production: ours.color, strict_membership: isInGamut(ours.color, g),
        reference_absolute_hue_delta: r.color.c === 0 ? null : hueDistance(r.color.h, r.hue),
        production_absolute_hue_delta: ours.color.c === 0 ? null : hueDistance(ours.color.h, r.hue) };
    });
    function summary(production: boolean) {
      const chromatic = paired.filter(r => r.scale !== "Neutral");
      const spreads = [...new Set(rows.map(r => r.position))].map(p => {
        const step = chromatic.filter(r => r.position === p).map(r => production ? r.production : r.color);
        return { l: Math.max(...step.map(c => c.l)) - Math.min(...step.map(c => c.l)),
          c: Math.max(...step.map(c => c.c)) - Math.min(...step.map(c => c.c)) };
      });
      const failed = scales.filter(s => {
        const series = paired.filter(r => r.scale === s.id).sort((a, b) => a.position - b.position)
          .map(r => production ? r.production.l : r.color.l);
        return series.some((l, i) => i > 0 && l > series[i - 1]);
      }).map(s => s.id);
      return { lightness_spread: Math.max(...spreads.map(s => s.l)), chroma_spread: Math.max(...spreads.map(s => s.c)),
        monotonic_failures: failed, scale_count: scales.length };
    }
    const baseline = summary(false), ours = summary(true);
    return { gamut: g, reference: baseline, production: ours, rows: paired,
      status: ours.lightness_spread <= baseline.lightness_spread
        && ours.chroma_spread <= baseline.chroma_spread + TOLERANCE.chroma
        && ours.monotonic_failures.length === 0 && paired.every(r => r.strict_membership) ? "PASS" : "FAIL" };
  });
}
export function oracleInputs(rows: readonly RgbInput[]): readonly OracleCase[] {
  return rows.map(row => {
    const [r, g, b] = row.rgb, lch = rgbToOklch({ space: row.gamut, r, g, b });
    return { id: row.id, gamut: row.gamut, ...lch, h: lch.c === 0 ? null : lch.h, expectedRgb: row.rgb };
  });
}
export function measureConversion(cases: readonly OracleCase[], receipt: OracleReceipt) {
  requireMeasurement(receipt.schema_version === 1 && receipt.code === "OK" && receipt.channel_denominator === 255
    && receipt.rows.length === cases.length && new Set(receipt.rows.map(r => r.id)).size === cases.length, "ORACLE_RECEIPT");
  return (["srgb", "display-p3"] as const).map(gamut => {
    let channel = 0, control = 0, count = 0;
    for (const [i, input] of cases.entries()) {
      const row = receipt.rows[i];
      requireMeasurement(row !== undefined && row.id === input.id && row.gamut === input.gamut, "ORACLE_RECEIPT");
      for (const rgba of [row.oklchRgba, row.controlRgba]) requireMeasurement(rgba.length === 4
        && rgba[3] === 255 && rgba.every(n => Number.isInteger(n) && n >= 0 && n <= 255), "ORACLE_RECEIPT");
      if (input.gamut !== gamut) continue;
      count++;
      for (const [j, value] of input.expectedRgb.entries()) {
        const expected = Math.round(value * 255);
        channel = Math.max(channel, Math.abs(row.oklchRgba[j] - expected) / 255);
        control = Math.max(control, Math.abs(row.controlRgba[j] - expected) / 255);
      }
    }
    requireMeasurement(count === 4096, "ORACLE_RECEIPT");
    return { gamut, samples: count, max_channel_error: channel, max_control_error: control,
      status: channel <= 1 / 255 && control <= 1 / 255 ? "PASS" : "FAIL" };
  });
}
export function measureRgbInputs(rows: readonly RgbInput[]) {
  return rows.flatMap(row => (["srgb", "display-p3"] as const).map(target => {
    const [r, g, b] = row.rgb, requested = rgbToOklch({ space: row.gamut, r, g, b });
    const produced = gamutMapOklch(requested, target);
    return { id: row.id, input_gamut: row.gamut, gamut: target, requested, production: produced,
      retention: requested.c === 0 ? null : produced.c / requested.c,
      hue_drift: requested.c === 0 || produced.c === 0 ? null : hueDistance(produced.h, requested.h),
      status: isInGamut(produced, target) && produced.l === requested.l
        && produced.h === requested.h && produced.c <= requested.c ? "PASS" : "FAIL" };
  }));
}
