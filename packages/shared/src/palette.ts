import { allHueChroma, ColorContractError, isInGamut, oklchToRgb, parseColorGamut, parseRgb,
  selectedHueChroma, type ColorGamut, type OklchColor, type RgbColor } from "./color";
import { decodeContract, isRecord, UpgradeContractError } from "./contract-parser";

export const PALETTE_LIMITS = { stops: 64, scales: 64, anchors: 64, history: 64, json: 65536, share: 196620 } as const;
export const PALETTE_DISTRIBUTIONS = ["default", "even", "more-light", "more-dark", "ends", "custom"] as const;
export type PaletteDistribution = typeof PALETTE_DISTRIBUTIONS[number];
export type PaletteStop = { readonly id: string; readonly name: string; readonly position: number };
export type PaletteScale = { readonly id: string; readonly name: string } & (
  { readonly kind: "hue"; readonly hue: number } | { readonly kind: "neutral" });
export type PaletteAnchor = { readonly id: string; readonly name: string; readonly color: RgbColor };
export type PaletteCurve = {
  readonly kind: "even" | "bell"; readonly amount: number; readonly width: number; readonly softness: number;
  readonly light_end: number; readonly dark_end: number; readonly lightness: { readonly light: number; readonly dark: number };
};
export type PaletteDisplay = {
  readonly layout: "columns" | "rows"; readonly scale_gap: number; readonly step_gap: number;
  readonly appearance: "light" | "dark" | "system"; readonly information: "hover" | "always";
  readonly fields: readonly ("name" | "step" | "hex" | "rgb" | "oklch" | "contrast-white" | "contrast-black")[];
};
export type PaletteState = {
  readonly version: 1; readonly stops: readonly PaletteStop[]; readonly scales: readonly PaletteScale[];
  readonly anchors: readonly PaletteAnchor[]; readonly distribution: PaletteDistribution;
  readonly range: { readonly start: number; readonly end: number }; readonly curve: PaletteCurve;
  readonly gamut: ColorGamut; readonly envelope: "selected-hues" | "all-hues"; readonly display: PaletteDisplay;
};
export type PaletteHistory = {
  readonly past: readonly PaletteState[]; readonly present: PaletteState; readonly future: readonly PaletteState[];
};
export type PaletteSampleContext = Pick<PaletteState, "scales" | "gamut" | "envelope">;
export type PaletteSample = { readonly id: string; readonly color: OklchColor; readonly rgb: RgbColor; readonly outside_srgb: boolean };

function invalid(path: string): never { throw new UpgradeContractError("invalid_field", path); }
function exhaustive(value: never): never { return invalid(String(value)); }
function shape(value: unknown, keys: string): Readonly<Record<string, unknown>> {
  const names = keys.split(" ");
  if (!isRecord(value) || Object.keys(value).length !== names.length ||
    names.some(key => !Object.hasOwn(value, key))) return invalid(keys);
  return value;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return invalid("number");
  return value === 0 ? 0 : value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 80 ||
    /[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(value)) return invalid("text");
  return value;
}
function choice<const T extends string>(value: unknown, choices: readonly T[]): T {
  for (const item of choices) if (item === value) return item;
  return invalid("choice");
}
function list<T>(value: unknown, max: number, parse: (entry: unknown) => T): readonly T[] {
  if (!Array.isArray(value) || value.length > max) return invalid("array");
  return Array.from(value, parse);
}
function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) invalid("duplicate_identity");
}
function parseCurve(value: unknown): PaletteCurve {
  const v = shape(value, "kind amount width softness light_end dark_end lightness");
  const ends = shape(v.lightness, "light dark");
  const light = number(ends.light, 0, 1), dark = number(ends.dark, 0, 1);
  if (light < dark) return invalid("lightness");
  return { kind: choice(v.kind, ["even", "bell"]), amount: number(v.amount, 0, 4),
    width: number(v.width, 0.01, 1), softness: number(v.softness, 0.1, 8),
    light_end: number(v.light_end, 0, 1), dark_end: number(v.dark_end, 0, 1), lightness: { light, dark } };
}
function parseScale(value: unknown): PaletteScale {
  if (!isRecord(value)) return invalid("scale");
  const kind = choice(value.kind, ["hue", "neutral"]);
  switch (kind) {
    case "hue": {
      const v = shape(value, "id name kind hue");
      return { id: text(v.id), name: text(v.name), kind, hue: number(v.hue, 0, 360) };
    }
    case "neutral": {
      const v = shape(value, "id name kind");
      return { id: text(v.id), name: text(v.name), kind };
    }
    default: return exhaustive(kind);
  }
}
function parseDisplay(value: unknown): PaletteDisplay {
  const v = shape(value, "layout scale_gap step_gap appearance information fields");
  const fields = list(v.fields, 7, item => choice(item, ["name", "step", "hex", "rgb", "oklch", "contrast-white", "contrast-black"]));
  unique(fields);
  return { layout: choice(v.layout, ["columns", "rows"]), scale_gap: number(v.scale_gap, 0, 128),
    step_gap: number(v.step_gap, 0, 128), appearance: choice(v.appearance, ["light", "dark", "system"]),
    information: choice(v.information, ["hover", "always"]), fields };
}
/** HTTP/object and JSON boundary. Rebuild in canonical key order; never retain input aliases. */
export function parsePaletteState(input: unknown): PaletteState {
  if (typeof input === "string" && input.length > PALETTE_LIMITS.json) return invalid("json_size");
  const v = shape(decodeContract(input), "version stops scales anchors distribution range curve gamut envelope display");
  if (v.version !== 1) throw new UpgradeContractError("unknown_discriminant", "version");
  const r = shape(v.range, "start end"), start = number(r.start, 0, 1), end = number(r.end, 0, 1);
  if (start >= end) return invalid("range");
  const stops = list(v.stops, PALETTE_LIMITS.stops, item => {
    const s = shape(item, "id name position");
    return { id: text(s.id), name: text(s.name), position: number(s.position, start, end) };
  });
  if (stops.length < 2 || stops.some((s, i) => i > 0 && s.position <= stops[i - 1].position)) return invalid("stops");
  const scales = list(v.scales, PALETTE_LIMITS.scales, parseScale);
  if (scales.length === 0) return invalid("scales");
  const anchors = list(v.anchors, PALETTE_LIMITS.anchors, item => {
    const a = shape(item, "id name color");
    try { return { id: text(a.id), name: text(a.name), color: parseRgb(a.color) }; }
    catch (error) {
      if (error instanceof ColorContractError) return invalid(`anchor.${error.field}`);
      throw error;
    }
  });
  unique([...stops, ...scales, ...anchors].map(item => item.id));
  unique(stops.map(item => item.name));
  try {
    return { version: 1, stops, scales, anchors, distribution: choice(v.distribution, PALETTE_DISTRIBUTIONS),
      range: { start, end }, curve: parseCurve(v.curve), gamut: parseColorGamut(v.gamut),
      envelope: choice(v.envelope, ["selected-hues", "all-hues"]), display: parseDisplay(v.display) };
  } catch (error) {
    if (error instanceof ColorContractError) return invalid(error.field);
    throw error;
  }
}

const LABELS = [50, 100, 150, 200, 250, 300, 400, 500, 600, 650, 700, 750] as const;
export function createDefaultPalette(): PaletteState {
  return { version: 1, stops: LABELS.map(label => ({ id: `stop-${label}`, name: String(label), position: label / 800 })),
    scales: [{ id: "violet", name: "Violet", kind: "hue", hue: 300 }, { id: "blue", name: "Blue", kind: "hue", hue: 260 },
      { id: "green", name: "Green", kind: "hue", hue: 145 }, { id: "amber", name: "Amber", kind: "hue", hue: 85 },
      { id: "red", name: "Red", kind: "hue", hue: 25 }, { id: "neutral", name: "Neutral", kind: "neutral" }],
    anchors: [], distribution: "default", range: { start: 0.0625, end: 0.9375 },
    curve: { kind: "bell", amount: 0.2, width: 0.5, softness: 2, light_end: 0, dark_end: 0,
      lightness: { light: 1, dark: 0 } }, gamut: "srgb", envelope: "selected-hues",
    display: { layout: "columns", scale_gap: 16, step_gap: 0, appearance: "system",
      information: "hover", fields: ["name", "step", "hex"] } };
}
/** Presets move existing stops, retaining IDs/names. Custom records explicit positions unchanged. */
export function distributePalette(state: PaletteState, distribution: PaletteDistribution): PaletteState {
  const { start, end } = state.range;
  const stops = state.stops.map((stop, i) => {
    const t = i / (state.stops.length - 1);
    let p: number;
    switch (distribution) {
      case "custom": return stop;
      case "default": p = state.stops.length === 12 ? (LABELS[i] - 50) / 700 : t; break;
      case "even": p = t; break;
      case "more-light": p = t * t; break;
      case "more-dark": p = 1 - (1 - t) ** 2; break;
      case "ends": p = (1 - Math.cos(Math.PI * t)) / 2; break;
      default: return exhaustive(distribution);
    }
    return { ...stop, position: start + (end - start) * p };
  });
  return { ...state, distribution, stops };
}
/** Absolute position only. Endpoints and sampling density never enter this function. */
export function sampleScale(position: number, curve: PaletteCurve, context: PaletteSampleContext): Pick<OklchColor, "l" | "c"> {
  const p = number(position, 0, 1);
  const l = (1 - p) * curve.lightness.light + p * curve.lightness.dark;
  const distance = Math.abs(2 * p - 1);
  let profile: number;
  switch (curve.kind) {
    case "even": profile = Math.exp(-((Math.max(0, distance - curve.width) / curve.width) ** curve.softness)); break;
    case "bell": profile = Math.exp(-((distance / curve.width) ** curve.softness)); break;
    default: return exhaustive(curve.kind);
  }
  const ends = p <= 0.5 ? curve.light_end : curve.dark_end;
  const requested = curve.amount * (ends + (1 - ends) * profile);
  const hues = context.scales.flatMap(scale => {
    switch (scale.kind) {
      case "hue": return [scale.hue];
      case "neutral": return [];
      default: return exhaustive(scale);
    }
  });
  if (hues.length === 0) return { l, c: 0 };
  let bound: number;
  switch (context.envelope) {
    case "selected-hues": bound = selectedHueChroma(l, hues, context.gamut); break;
    case "all-hues": bound = allHueChroma(l, context.gamut); break;
    default: return exhaustive(context.envelope);
  }
  return { l, c: Math.min(requested, bound) };
}
export function samplePalette(state: PaletteState, position: number): readonly PaletteSample[] {
  const common = sampleScale(position, state.curve, state);
  return state.scales.map(scale => {
    let color: OklchColor;
    switch (scale.kind) {
      case "hue": color = { ...common, h: scale.hue }; break;
      case "neutral": color = { l: common.l, c: 0, h: 0 }; break;
      default: return exhaustive(scale);
    }
    return { id: scale.id, color, rgb: oklchToRgb(color, state.gamut), outside_srgb: !isInGamut(color, "srgb") };
  });
}
export function serializePalette(state: PaletteState): string {
  const json = JSON.stringify(parsePaletteState(state));
  if (json.length > PALETTE_LIMITS.json) return invalid("json_size");
  return json;
}
export function paletteShareFragment(state: PaletteState): string {
  const fragment = "#bg-palette=" + encodeURIComponent(serializePalette(state));
  if (fragment.length > PALETTE_LIMITS.share) return invalid("share_size");
  return fragment;
}
export function parsePaletteShareFragment(fragment: string): PaletteState {
  if (fragment.length > PALETTE_LIMITS.share || !fragment.startsWith("#bg-palette=")) return invalid("share");
  try { return parsePaletteState(decodeURIComponent(fragment.slice(12))); }
  catch (error) {
    if (error instanceof URIError) return invalid("share_encoding");
    throw error;
  }
}
/** Commit one complete gesture as one immutable snapshot. Reset/import use the same transition. */
export function transitionPalette(history: PaletteHistory, next: PaletteState): PaletteHistory {
  const present = parsePaletteState(next);
  if (serializePalette(present) === serializePalette(history.present)) return history;
  return { past: [...history.past, history.present].slice(-PALETTE_LIMITS.history), present, future: [] };
}
export function undoPalette(history: PaletteHistory): PaletteHistory {
  const present = history.past.at(-1);
  return present ? { past: history.past.slice(0, -1), present,
    future: [history.present, ...history.future].slice(0, PALETTE_LIMITS.history) } : history;
}
export function redoPalette(history: PaletteHistory): PaletteHistory {
  const present = history.future[0];
  return present ? { past: [...history.past, history.present].slice(-PALETTE_LIMITS.history),
    present, future: history.future.slice(1) } : history;
}
