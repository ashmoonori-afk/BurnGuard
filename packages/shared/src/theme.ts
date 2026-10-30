import { gamutMapOklch, normalizeHue, oklchToRgb, parseRgb, rgbToOklch, wcag2Contrast,
  type OklchColor, type RgbColor } from "./color";
import { decodeContract, isRecord, UpgradeContractError } from "./contract-parser";
import { parsePaletteState, samplePalette, serializePalette, type PaletteAnchor, type PaletteState } from "./palette";

export const THEME_SCHEMA_VERSION = 1;
export const THEME_LIMITS = { json: 262144, families: 8, shadowLayers: 4 } as const;
export const SEMANTIC_THEME_MODES = ["light", "dark"] as const;
export type SemanticThemeMode = typeof SEMANTIC_THEME_MODES[number];
export const CANONICAL_THEME_EMITTER = "burnguard-canonical-1";
export type CanonicalTransferProof = {
  readonly schema_version: 1;
  readonly emitter_version: typeof CANONICAL_THEME_EMITTER;
  readonly json: { readonly size_bytes: number; readonly sha256: string };
  readonly css: { readonly size_bytes: number; readonly sha256: string };
  readonly skill: { readonly size_bytes: number; readonly sha256: string };
};

/** Declares exact portable bytes; only a local receipt can grant ownership. */
export function parseCanonicalTransferProof(input: unknown): CanonicalTransferProof {
  const value = shape(input, ["schema_version", "emitter_version", "json", "css", "skill"]);
  if (value.schema_version !== 1 || value.emitter_version !== CANONICAL_THEME_EMITTER) return invalid("transfer");
  const member = (input: unknown, maximum: number) => {
    const file = shape(input, ["size_bytes", "sha256"]);
    if (typeof file.sha256 !== "string" || file.sha256.length !== 64 || !/^[0-9a-f]{64}$/.test(file.sha256)) {
      return invalid("transfer.sha256");
    }
    return { size_bytes: numeric(file.size_bytes, 1, maximum, true), sha256: file.sha256 };
  };
  return { schema_version: 1, emitter_version: CANONICAL_THEME_EMITTER,
    json: member(value.json, THEME_LIMITS.json), css: member(value.css, 262144), skill: member(value.skill, 65536) };
}

/** The sole closed vocabulary. Names are also the artifact custom-property names. */
export const THEME_TOKEN_REGISTRY = {
  background: "color", foreground: "color",
  card: "color", "card-foreground": "color", popover: "color", "popover-foreground": "color",
  primary: "color", "primary-foreground": "color",
  secondary: "color", "secondary-foreground": "color",
  muted: "color", "muted-foreground": "color",
  accent: "color", "accent-foreground": "color", "accent-soft": "color",
  success: "color", "success-foreground": "color", "success-text": "color",
  warning: "color", "warning-foreground": "color", "warning-text": "color",
  destructive: "color", "destructive-foreground": "color", "destructive-text": "color",
  info: "color", "info-foreground": "color", "info-text": "color",
  border: "color", input: "color", ring: "color",
  "font-sans": "font-family", "font-mono": "font-family",
  "font-size-body": "length", "font-size-heading": "length",
  "font-weight-body": "weight", "font-weight-heading": "weight",
  "line-height-body": "ratio", "line-height-heading": "ratio",
  "space-1": "length", "space-2": "length", "space-3": "length", "space-4": "length", "space-6": "length",
  radius: "length", "radius-control": "length", "radius-pill": "length",
  "shadow-sm": "shadow", "shadow-lg": "shadow",
  "motion-fast": "duration", "motion-normal": "duration", "motion-easing": "easing",
} as const;
export type ThemeTokenName = keyof typeof THEME_TOKEN_REGISTRY;
export type ThemeColorName = {
  [K in ThemeTokenName]: typeof THEME_TOKEN_REGISTRY[K] extends "color" ? K : never
}[ThemeTokenName];
export type ThemeColor = {
  readonly type: "color"; readonly space: "srgb"; readonly channels: readonly [number, number, number];
};
export type ThemeLength = { readonly type: "length"; readonly value: number; readonly unit: "px" | "rem" };
export type ThemeEasing = {
  readonly type: "easing";
  readonly value: "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out" | {
    readonly type: "cubic-bezier"; readonly points: readonly [number, number, number, number];
  };
};
export type ThemeShadowLayer = {
  readonly unit: "px";
  readonly x: number; readonly y: number; readonly blur: number; readonly spread: number;
  readonly color: ThemeColor; readonly alpha: number;
};
type ThemeValues = {
  readonly color: ThemeColor;
  readonly length: ThemeLength;
  readonly "font-family": { readonly type: "font-family"; readonly families: readonly string[] };
  readonly weight: { readonly type: "weight"; readonly value: number };
  readonly ratio: { readonly type: "ratio"; readonly value: number };
  readonly shadow: { readonly type: "shadow"; readonly layers: readonly ThemeShadowLayer[] };
  readonly duration: { readonly type: "duration"; readonly value: number; readonly unit: "ms" };
  readonly easing: ThemeEasing;
};
type ThemeKind = keyof ThemeValues;
type ThemeLiteral = ThemeValues[ThemeKind];
export type ThemeAlias = { readonly type: "alias"; readonly target: ThemeTokenName };
export type ThemeTokens = {
  readonly [K in ThemeTokenName]: ThemeValues[typeof THEME_TOKEN_REGISTRY[K]] | ThemeAlias
};
export type ThemeSettings = Omit<ThemeTokens, ThemeColorName>;
export type ThemeContrastPair = {
  readonly foreground: ThemeColorName; readonly background: ThemeColorName;
  readonly usage: "body" | "large" | "ui";
};

/** Fixed obligations cannot be deleted or weakened by an imported theme. */
export const THEME_CONTRAST_PAIRS = [
  { foreground: "foreground", background: "background", usage: "body" },
  { foreground: "foreground", background: "card", usage: "body" },
  { foreground: "foreground", background: "popover", usage: "body" },
  { foreground: "foreground", background: "background", usage: "large" },
  { foreground: "foreground", background: "card", usage: "large" },
  { foreground: "card-foreground", background: "card", usage: "body" },
  { foreground: "popover-foreground", background: "popover", usage: "body" },
  { foreground: "primary-foreground", background: "primary", usage: "body" },
  { foreground: "secondary-foreground", background: "secondary", usage: "body" },
  { foreground: "muted-foreground", background: "muted", usage: "body" },
  { foreground: "muted-foreground", background: "background", usage: "body" },
  { foreground: "muted-foreground", background: "card", usage: "body" },
  { foreground: "accent-foreground", background: "accent", usage: "body" },
  { foreground: "accent", background: "accent-soft", usage: "body" },
  { foreground: "accent", background: "background", usage: "body" },
  { foreground: "accent", background: "card", usage: "body" },
  { foreground: "success-foreground", background: "success", usage: "body" },
  { foreground: "warning-foreground", background: "warning", usage: "body" },
  { foreground: "destructive-foreground", background: "destructive", usage: "body" },
  { foreground: "info-foreground", background: "info", usage: "body" },
  { foreground: "success-text", background: "background", usage: "body" },
  { foreground: "success-text", background: "card", usage: "body" },
  { foreground: "warning-text", background: "background", usage: "body" },
  { foreground: "warning-text", background: "card", usage: "body" },
  { foreground: "destructive-text", background: "background", usage: "body" },
  { foreground: "destructive-text", background: "card", usage: "body" },
  { foreground: "info-text", background: "background", usage: "body" },
  { foreground: "info-text", background: "card", usage: "body" },
  { foreground: "primary", background: "background", usage: "ui" },
  { foreground: "primary", background: "card", usage: "ui" },
  { foreground: "input", background: "background", usage: "ui" },
  { foreground: "input", background: "card", usage: "ui" },
  { foreground: "ring", background: "background", usage: "ui" },
  { foreground: "ring", background: "card", usage: "ui" },
] as const satisfies readonly ThemeContrastPair[];

export type ThemeSources = {
  readonly brand_anchor_id: string; readonly surface_scale_id: string;
  readonly status: {
    readonly success: RgbColor; readonly warning: RgbColor; readonly destructive: RgbColor; readonly info: RgbColor;
  };
};
export type SemanticTheme = {
  readonly schema_version: 1;
  /** Logical CSS identity, not a catalog ID, path, capability or authority lookup. */
  readonly system_id: string;
  readonly default_mode: SemanticThemeMode;
  readonly palette: PaletteState;
  readonly brand_anchors: readonly PaletteAnchor[];
  readonly sources: ThemeSources;
  readonly modes: { readonly light: ThemeTokens; readonly dark: ThemeTokens };
  readonly contrast_pairs: readonly ThemeContrastPair[];
};
export type ThemeSynthesisInput = Pick<SemanticTheme, "system_id" | "default_mode" | "palette" | "sources"> & {
  readonly settings: { readonly light: ThemeSettings; readonly dark: ThemeSettings };
};

function invalid(path: string): never { throw new UpgradeContractError("invalid_field", `theme.${path}`); }
function shape(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
  if (!isRecord(value) || Object.keys(value).length !== keys.length ||
    keys.some(key => !Object.hasOwn(value, key))) return invalid("shape");
  return value;
}
function numeric(value: unknown, min: number, max: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max ||
    (integer && !Number.isInteger(value))) return invalid("number");
  return value === 0 ? 0 : value;
}
function choice<const T extends string>(value: unknown, options: readonly T[]): T {
  for (const option of options) if (option === value) return option;
  return invalid("choice");
}
function identity(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(value)) return invalid("system_id");
  return value;
}
const TOKEN_NAMES = Object.keys(THEME_TOKEN_REGISTRY);
const SETTINGS_NAMES = TOKEN_NAMES.filter(key => !isColorName(key));
function isColorName(value: string): value is ThemeColorName {
  return Object.entries(THEME_TOKEN_REGISTRY).some(([key, kind]) => key === value && kind === "color");
}
function tokenName(value: unknown): ThemeTokenName {
  for (const key in THEME_TOKEN_REGISTRY) {
    if (key === value && isTokenName(key)) return key;
  }
  return invalid("token_name");
}
function isTokenName(value: string): value is ThemeTokenName { return Object.hasOwn(THEME_TOKEN_REGISTRY, value); }
function parseThemeColor(input: unknown): ThemeColor {
  const v = shape(input, ["type", "space", "channels"]);
  if (v.type !== "color" || v.space !== "srgb" || !Array.isArray(v.channels) || v.channels.length !== 3) {
    return invalid("color");
  }
  return { type: "color", space: "srgb", channels: [
    numeric(v.channels[0], 0, 255, true), numeric(v.channels[1], 0, 255, true), numeric(v.channels[2], 0, 255, true),
  ] };
}
function entry(input: unknown, kind: "color"): ThemeValues["color"] | ThemeAlias;
function entry(input: unknown, kind: "length"): ThemeValues["length"] | ThemeAlias;
function entry(input: unknown, kind: "font-family"): ThemeValues["font-family"] | ThemeAlias;
function entry(input: unknown, kind: "weight"): ThemeValues["weight"] | ThemeAlias;
function entry(input: unknown, kind: "ratio"): ThemeValues["ratio"] | ThemeAlias;
function entry(input: unknown, kind: "shadow"): ThemeValues["shadow"] | ThemeAlias;
function entry(input: unknown, kind: "duration"): ThemeValues["duration"] | ThemeAlias;
function entry(input: unknown, kind: "easing"): ThemeValues["easing"] | ThemeAlias;
function entry(input: unknown, kind: ThemeKind): ThemeLiteral | ThemeAlias {
  if (!isRecord(input)) return invalid("value");
  if (input.type === "alias") {
    const v = shape(input, ["type", "target"]);
    const target = tokenName(v.target);
    if (THEME_TOKEN_REGISTRY[target] !== kind) return invalid("alias_type");
    return { type: "alias", target };
  }
  if (input.type !== kind) return invalid("value_type");
  switch (kind) {
    case "color": return parseThemeColor(input);
    case "length": {
      const v = shape(input, ["type", "value", "unit"]);
      return { type: kind, value: numeric(v.value, 0, 4096), unit: choice(v.unit, ["px", "rem"]) };
    }
    case "font-family": {
      const v = shape(input, ["type", "families"]);
      if (!Array.isArray(v.families) || v.families.length < 1 || v.families.length > THEME_LIMITS.families) return invalid("families");
      const families = Array.from(v.families, (name: unknown) => {
        if (typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9 -]{0,79}$/.test(name) || name.trim() !== name) return invalid("family");
        return name;
      });
      if (new Set(families).size !== families.length) return invalid("families");
      return { type: kind, families };
    }
    case "weight": {
      const v = shape(input, ["type", "value"]);
      return { type: kind, value: numeric(v.value, 1, 1000, true) };
    }
    case "ratio": {
      const v = shape(input, ["type", "value"]);
      return { type: kind, value: numeric(v.value, 1, 3) };
    }
    case "duration": {
      const v = shape(input, ["type", "value", "unit"]);
      if (v.unit !== "ms") return invalid("duration_unit");
      return { type: kind, value: numeric(v.value, 0, 10000), unit: "ms" };
    }
    case "easing": {
      const v = shape(input, ["type", "value"]);
      if (typeof v.value === "string") {
        return { type: kind, value: choice(v.value, ["linear", "ease", "ease-in", "ease-out", "ease-in-out"]) };
      }
      const curve = shape(v.value, ["type", "points"]);
      if (curve.type !== "cubic-bezier" || !Array.isArray(curve.points) || curve.points.length !== 4) return invalid("easing_curve");
      return { type: kind, value: { type: "cubic-bezier", points: [
        numeric(curve.points[0], 0, 1), numeric(curve.points[1], -Number.MAX_VALUE, Number.MAX_VALUE),
        numeric(curve.points[2], 0, 1), numeric(curve.points[3], -Number.MAX_VALUE, Number.MAX_VALUE),
      ] } };
    }
    case "shadow": {
      const v = shape(input, ["type", "layers"]);
      if (!Array.isArray(v.layers) || v.layers.length > THEME_LIMITS.shadowLayers) return invalid("shadow");
      return { type: kind, layers: Array.from(v.layers, (item: unknown) => {
        const layer = shape(item, ["unit", "x", "y", "blur", "spread", "color", "alpha"]);
        if (layer.unit !== "px") return invalid("shadow_unit");
        return { unit: "px", x: numeric(layer.x, -256, 256), y: numeric(layer.y, -256, 256),
          blur: numeric(layer.blur, 0, 256), spread: numeric(layer.spread, -256, 256),
          color: parseThemeColor(layer.color), alpha: numeric(layer.alpha, 0, 1) };
      }) };
    }
    default: return invalid(kind satisfies never);
  }
}
function settingsFields(v: Readonly<Record<string, unknown>>): ThemeSettings {
  return {
    "font-sans": entry(v["font-sans"], "font-family"), "font-mono": entry(v["font-mono"], "font-family"),
    "font-size-body": entry(v["font-size-body"], "length"), "font-size-heading": entry(v["font-size-heading"], "length"),
    "font-weight-body": entry(v["font-weight-body"], "weight"), "font-weight-heading": entry(v["font-weight-heading"], "weight"),
    "line-height-body": entry(v["line-height-body"], "ratio"), "line-height-heading": entry(v["line-height-heading"], "ratio"),
    "space-1": entry(v["space-1"], "length"), "space-2": entry(v["space-2"], "length"),
    "space-3": entry(v["space-3"], "length"), "space-4": entry(v["space-4"], "length"), "space-6": entry(v["space-6"], "length"),
    radius: entry(v.radius, "length"), "radius-control": entry(v["radius-control"], "length"), "radius-pill": entry(v["radius-pill"], "length"),
    "shadow-sm": entry(v["shadow-sm"], "shadow"), "shadow-lg": entry(v["shadow-lg"], "shadow"),
    "motion-fast": entry(v["motion-fast"], "duration"), "motion-normal": entry(v["motion-normal"], "duration"),
    "motion-easing": entry(v["motion-easing"], "easing"),
  };
}
function parseTokens(input: unknown): ThemeTokens {
  const v = shape(input, TOKEN_NAMES);
  return {
    background: entry(v.background, "color"), foreground: entry(v.foreground, "color"),
    card: entry(v.card, "color"), "card-foreground": entry(v["card-foreground"], "color"),
    popover: entry(v.popover, "color"), "popover-foreground": entry(v["popover-foreground"], "color"),
    primary: entry(v.primary, "color"), "primary-foreground": entry(v["primary-foreground"], "color"),
    secondary: entry(v.secondary, "color"), "secondary-foreground": entry(v["secondary-foreground"], "color"),
    muted: entry(v.muted, "color"), "muted-foreground": entry(v["muted-foreground"], "color"),
    accent: entry(v.accent, "color"), "accent-foreground": entry(v["accent-foreground"], "color"), "accent-soft": entry(v["accent-soft"], "color"),
    success: entry(v.success, "color"), "success-foreground": entry(v["success-foreground"], "color"), "success-text": entry(v["success-text"], "color"),
    warning: entry(v.warning, "color"), "warning-foreground": entry(v["warning-foreground"], "color"), "warning-text": entry(v["warning-text"], "color"),
    destructive: entry(v.destructive, "color"), "destructive-foreground": entry(v["destructive-foreground"], "color"),
    "destructive-text": entry(v["destructive-text"], "color"),
    info: entry(v.info, "color"), "info-foreground": entry(v["info-foreground"], "color"), "info-text": entry(v["info-text"], "color"),
    border: entry(v.border, "color"), input: entry(v.input, "color"), ring: entry(v.ring, "color"),
    ...settingsFields(v),
  };
}
function resolve(tokens: ThemeTokens, key: ThemeTokenName, seen = new Set<ThemeTokenName>()): ThemeLiteral {
  if (seen.has(key)) return invalid("alias_cycle");
  const value = tokens[key];
  if (value.type !== "alias") return value;
  seen.add(key);
  return resolve(tokens, value.target, seen);
}
function colorAt(tokens: ThemeTokens, key: ThemeColorName): ThemeColor {
  const value = resolve(tokens, key);
  return value.type === "color" ? value : invalid("color_type");
}
function rgb(color: ThemeColor): RgbColor<"srgb"> {
  return { space: "srgb", r: color.channels[0] / 255, g: color.channels[1] / 255, b: color.channels[2] / 255 };
}
function validateTokens(tokens: ThemeTokens): void {
  for (const key of TOKEN_NAMES) if (isTokenName(key)) resolve(tokens, key);
  for (const key of ["font-size-body", "font-size-heading"] as const) {
    const value = resolve(tokens, key);
    if (value.type !== "length" || value.value === 0 || value.value * (value.unit === "rem" ? 16 : 1) > 256) return invalid(key);
  }
  const body = resolve(tokens, "line-height-body");
  if (body.type !== "ratio" || body.value < 1.45) return invalid("line-height-body");
  for (const pair of THEME_CONTRAST_PAIRS) {
    if (wcag2Contrast(rgb(colorAt(tokens, pair.foreground)), rgb(colorAt(tokens, pair.background))) <
      (pair.usage === "body" ? 4.5 : 3)) return invalid(`contrast.${pair.foreground}.${pair.background}`);
  }
}
function sources(input: unknown, palette: PaletteState): ThemeSources {
  const v = shape(input, ["brand_anchor_id", "surface_scale_id", "status"]);
  if (typeof v.brand_anchor_id !== "string" || !palette.anchors.some(a => a.id === v.brand_anchor_id)) return invalid("brand_anchor_id");
  if (typeof v.surface_scale_id !== "string" || !palette.scales.some(s => s.id === v.surface_scale_id)) return invalid("surface_scale_id");
  const status = shape(v.status, ["success", "warning", "destructive", "info"]);
  return { brand_anchor_id: v.brand_anchor_id, surface_scale_id: v.surface_scale_id,
    status: { success: parseRgb(status.success), warning: parseRgb(status.warning),
      destructive: parseRgb(status.destructive), info: parseRgb(status.info) } };
}
function jsonSize(json: string): string {
  if (json.length > THEME_LIMITS.json || new TextEncoder().encode(json).length > THEME_LIMITS.json) return invalid("json_size");
  return json;
}
/** Pure bounded JSON/object boundary; canonical reconstruction never retains input object aliases. */
export function parseSemanticTheme(input: unknown): SemanticTheme {
  if (typeof input === "string") jsonSize(input);
  const v = shape(decodeContract(input), ["schema_version", "system_id", "default_mode", "palette", "brand_anchors", "sources", "modes", "contrast_pairs"]);
  if (v.schema_version !== THEME_SCHEMA_VERSION) return invalid("schema_version");
  const palette = parsePaletteState(v.palette);
  serializePalette(palette);
  const anchors = parsePaletteState({ ...palette, anchors: v.brand_anchors }).anchors;
  if (JSON.stringify(anchors) !== JSON.stringify(palette.anchors)) return invalid("brand_anchors");
  const mode = shape(v.modes, SEMANTIC_THEME_MODES);
  const light = parseTokens(mode.light), dark = parseTokens(mode.dark);
  validateTokens(light); validateTokens(dark);
  if (!Array.isArray(v.contrast_pairs) || v.contrast_pairs.length !== THEME_CONTRAST_PAIRS.length) return invalid("contrast_pairs");
  const pairs = Array.from(v.contrast_pairs, (item: unknown, i) => {
    const pair = shape(item, ["foreground", "background", "usage"]), expected = THEME_CONTRAST_PAIRS[i];
    if (pair.foreground !== expected.foreground || pair.background !== expected.background || pair.usage !== expected.usage) return invalid("contrast_pair");
    return { ...expected };
  });
  const result: SemanticTheme = { schema_version: 1, system_id: identity(v.system_id),
    default_mode: choice(v.default_mode, SEMANTIC_THEME_MODES), palette, brand_anchors: anchors,
    sources: sources(v.sources, palette), modes: { light, dark }, contrast_pairs: pairs };
  jsonSize(JSON.stringify(result));
  return result;
}
/** Canonical JSON file bytes always contain exactly one terminal LF. */
export function serializeSemanticTheme(input: SemanticTheme): string {
  return jsonSize(JSON.stringify(parseSemanticTheme(input)) + "\n");
}

function length(value: number): ThemeLength { return { type: "length", value, unit: "px" }; }
function gray(channel: number): ThemeColor { return { type: "color", space: "srgb", channels: [channel, channel, channel] }; }
/** Shared defaults, not product-specific extraction: local fonts, 4px spacing, 1.5 body leading.
 * Callers pass both mode settings explicitly; palette saves can use getThemeSettings to retain them.
 */
export function createDefaultThemeSettings(): ThemeSettings {
  return {
    "font-sans": { type: "font-family", families: ["system-ui", "sans-serif"] },
    "font-mono": { type: "font-family", families: ["ui-monospace", "monospace"] },
    "font-size-body": length(16), "font-size-heading": length(32),
    "font-weight-body": { type: "weight", value: 400 }, "font-weight-heading": { type: "weight", value: 600 },
    "line-height-body": { type: "ratio", value: 1.5 }, "line-height-heading": { type: "ratio", value: 1.2 },
    "space-1": length(4), "space-2": length(8), "space-3": length(12), "space-4": length(16), "space-6": length(24),
    radius: length(12), "radius-control": length(8), "radius-pill": length(999),
    "shadow-sm": { type: "shadow", layers: [{ unit: "px", x: 0, y: 1, blur: 3, spread: 0, color: gray(0), alpha: 0.12 }] },
    "shadow-lg": { type: "shadow", layers: [{ unit: "px", x: 0, y: 8, blur: 24, spread: 0, color: gray(0), alpha: 0.2 }] },
    "motion-fast": { type: "duration", value: 120, unit: "ms" },
    "motion-normal": { type: "duration", value: 200, unit: "ms" }, "motion-easing": { type: "easing", value: "ease-out" },
  };
}
export function getThemeSettings(input: SemanticTheme): ThemeSynthesisInput["settings"] {
  const theme = parseSemanticTheme(input);
  return { light: settingsFields(theme.modes.light), dark: settingsFields(theme.modes.dark) };
}

/** Only this lattice plus the canonical working source lightness is supported by synthesis.
 * Candidates are visited by increasing |delta L|, ties toward lower L. Hue stays fixed,
 * chroma only decreases through A's certified mapper. No monotonic-contrast assumption.
 */
export const THEME_LIGHTNESS_STEPS = 64;
// Working semantic values only, never editable palette/state/anchor/settings numbers.
// Integer bytes are the persisted/output authority. Eight-decimal working precision
// is explicit rather than persisting or emitting raw derived floating-point numbers.
function derived(value: number): number { return Math.round(value * 100000000) / 100000000; }
function semanticColor(color: OklchColor): OklchColor {
  return { l: derived(color.l), c: derived(color.c), h: normalizeHue(derived(color.h)) };
}
function quantize(color: OklchColor): ThemeColor {
  const value = oklchToRgb(gamutMapOklch(semanticColor(color), "srgb"), "srgb");
  // A certifies gamut membership; rounding absorbs only conversion endpoint roundoff.
  const channel = (n: number) => numeric(Math.round(derived(n) * 255), 0, 255, true);
  return { type: "color", space: "srgb", channels: [channel(value.r), channel(value.g), channel(value.b)] };
}
function readable(source: OklchColor, surfaces: readonly ThemeColor[], floor: number): ThemeColor {
  const base = semanticColor(source);
  const passes = (value: ThemeColor) => surfaces.every(surface => wcag2Contrast(rgb(value), rgb(surface)) >= floor);
  const original = quantize(base);
  if (passes(original)) return original;
  const candidates = Array.from({ length: THEME_LIGHTNESS_STEPS + 1 }, (_, i) => i / THEME_LIGHTNESS_STEPS)
    .sort((a, b) => Math.abs(a - base.l) - Math.abs(b - base.l) || a - b);
  for (const l of candidates) {
    const value = quantize({ ...base, l });
    if (passes(value)) return value;
  }
  return invalid("contrast_unachievable");
}
function onFill(fill: ThemeColor): ThemeColor {
  const black = gray(0), white = gray(255);
  return wcag2Contrast(rgb(black), rgb(fill)) >= wcag2Contrast(rgb(white), rgb(fill)) ? black : white;
}
/** No fixture imports, I/O, clock, randomness, stop-index semantics or implicit brand fallback. */
export function synthesizeTheme(input: ThemeSynthesisInput): SemanticTheme {
  const v = shape(input, ["system_id", "default_mode", "palette", "sources", "settings"]);
  const palette = parsePaletteState(v.palette);
  serializePalette(palette);
  const seeds = sources(v.sources, palette);
  const settings = shape(v.settings, SEMANTIC_THEME_MODES);
  const brand = palette.anchors.find(anchor => anchor.id === seeds.brand_anchor_id);
  if (!brand) return invalid("brand_anchor_id");
  const brandColor = rgbToOklch(brand.color);
  const mode = (appearance: SemanticThemeMode): ThemeTokens => {
    const light = appearance === "light";
    const surface = (position: number, l: number) => {
      const sample = samplePalette(palette, position).find(item => item.id === seeds.surface_scale_id);
      if (!sample) return invalid("surface_scale_id");
      return quantize({ ...sample.color, l, c: Math.min(sample.color.c, 0.025) });
    };
    const background = surface(light ? 0.02 : 0.98, light ? 0.98 : 0.14);
    const card = surface(light ? 0.01 : 0.94, light ? 1 : 0.19);
    const muted = surface(light ? 0.08 : 0.88, light ? 0.94 : 0.24);
    const surfaces = [background, card, muted];
    const ink = readable({ l: light ? 0.2 : 0.94, c: 0, h: 0 }, surfaces, 4.5);
    const supporting = readable({ l: light ? 0.5 : 0.7, c: 0, h: 0 }, surfaces, 4.5);
    const primary = readable(brandColor, surfaces, 3);
    const accent = readable(brandColor, surfaces, 4.5);
    const status = (source: RgbColor) => {
      const color = rgbToOklch(source);
      const fill = quantize(color);
      return { fill, foreground: onFill(fill), text: readable(color, [background, card], 4.5) };
    };
    const success = status(seeds.status.success), warning = status(seeds.status.warning);
    const destructive = status(seeds.status.destructive), info = status(seeds.status.info);
    return { background, foreground: ink, card, "card-foreground": ink, popover: card, "popover-foreground": ink,
      primary, "primary-foreground": onFill(primary), secondary: muted, "secondary-foreground": ink,
      muted, "muted-foreground": supporting, accent, "accent-foreground": onFill(accent), "accent-soft": muted,
      success: success.fill, "success-foreground": success.foreground, "success-text": success.text,
      warning: warning.fill, "warning-foreground": warning.foreground, "warning-text": warning.text,
      destructive: destructive.fill, "destructive-foreground": destructive.foreground, "destructive-text": destructive.text,
      info: info.fill, "info-foreground": info.foreground, "info-text": info.text,
      border: surface(light ? 0.15 : 0.8, light ? 0.86 : 0.34),
      input: readable({ l: light ? 0.65 : 0.55, c: 0, h: 0 }, [background, card], 3), ring: primary,
      ...settingsFields(shape(settings[appearance], SETTINGS_NAMES)) };
  };
  return parseSemanticTheme({ schema_version: 1, system_id: identity(v.system_id),
    default_mode: choice(v.default_mode, SEMANTIC_THEME_MODES), palette, brand_anchors: palette.anchors,
    sources: seeds, modes: { light: mode("light"), dark: mode("dark") }, contrast_pairs: THEME_CONTRAST_PAIRS });
}

/** These are complete-colour artifact slots, never Tailwind channel bindings.
 * This is an explicit semantic subset, not a reconstruction of a frozen legacy palette.
 */
const ARTIFACT_COLOR_ALIASES = {
  bg: "background", "bg-subtle": "card", "bg-muted": "muted", surface: "card",
  "fg-1": "foreground", "fg-2": "muted-foreground", "fg-3": "muted-foreground", "fg-4": "muted-foreground",
  "primary-blue": "primary", "action-blue": "primary", "fg-on-brand": "primary-foreground",
  "fg-on-secondary": "secondary-foreground", "fg-on-accent": "accent-foreground",
  "fg-on-success": "success-foreground", "fg-on-warning": "warning-foreground",
  "fg-on-error": "destructive-foreground", "fg-on-info": "info-foreground",
  "warning-yellow": "warning", error: "destructive", "border-strong": "input", "focus-ring": "ring",
} as const satisfies Readonly<Record<string, ThemeColorName>>;
function hex(value: ThemeColor): string {
  return "#" + value.channels.map(channel => channel.toString(16).padStart(2, "0")).join("");
}
function cssValue(value: ThemeLiteral): string {
  switch (value.type) {
    case "color": return hex(value);
    case "length": case "duration": return `${value.value}${value.unit}`;
    case "weight": case "ratio": return String(value.value);
    case "easing": return typeof value.value === "string"
      ? value.value : `cubic-bezier(${value.value.points.join(", ")})`;
    case "font-family": return value.families.map(name =>
      ["serif", "sans-serif", "monospace", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded"]
        .includes(name) ? name : `"${name}"`).join(", ");
    case "shadow": return value.layers.length === 0 ? "none" : value.layers.map(layer =>
      `${layer.x}${layer.unit} ${layer.y}${layer.unit} ${layer.blur}${layer.unit} ${layer.spread}${layer.unit} rgb(${layer.color.channels.join(" ")} / ${layer.alpha})`).join(", ");
    default: return invalid(value satisfies never);
  }
}
function emitCss(input: SemanticTheme, app: boolean): string {
  const theme = parseSemanticTheme(input);
  const selectors: string[] = [];
  const blocks = SEMANTIC_THEME_MODES.map(mode => {
    // system_id is validated ASCII before interpolation; neither selector accepts CSS text.
    const selector = app
      ? `:root[data-bg-app-system="${theme.system_id}"][data-theme="${mode}"]`
      : `[data-bg-system="${theme.system_id}"][data-bg-mode="${mode}"]`;
    selectors.push(selector);
    const tokens = theme.modes[mode];
    const lines = TOKEN_NAMES.map(key => {
      if (!isTokenName(key)) return invalid("token_name");
      const value = resolve(tokens, key);
      return `  --${key}: ${app && value.type === "color" ? value.channels.join(" ") : cssValue(value)};`;
    });
    if (!app) for (const [alias, target] of Object.entries(ARTIFACT_COLOR_ALIASES)) {
      lines.push(`  --${alias}: ${hex(colorAt(tokens, target))};`);
    }
    return `${selector} {\n  color-scheme: ${mode};\n${lines.join("\n")}\n}`;
  });
  // Reduced motion affects only opted-in roots. No global selectors or mode defaults.
  return blocks.join("\n") + `\n@media (prefers-reduced-motion: reduce) {\n${selectors.join(",\n")} {\n` +
    "  --motion-fast: 0ms;\n  --motion-normal: 0ms;\n}\n}\n";
}
/** No attributes means no new styling; both attributes must live on the same scope root. */
export function emitArtifactThemeCss(input: SemanticTheme): string { return emitCss(input, false); }
/** Existing data-theme is unchanged. Colour slots contain integer channels for rgb(var(--token) / alpha).
 * Raw palette/tint utilities and font loading remain the application's separate contracts.
 */
export function emitAppThemeCss(input: SemanticTheme): string { return emitCss(input, true); }

export function emitCanonicalThemeGuide(input: SemanticTheme): string {
  const theme = parseSemanticTheme(input);
  return `---
name: canonical-${theme.system_id}
description: Opt-in canonical semantic authoring for this bundled theme.
---

# Canonical authoring

Use validated canonical/theme.json as machine data, not archived prompt prose.
Use the project's pinned copy of canonical/theme.css, never a mutable live catalog
URL. Resolve its local asset path from the project pin, not from this logical ID.
Only a validated <selected_theme_v1> block supplied by the application selects
canonical authoring. Its absence means legacy. Malformed canonical metadata is
corruption: report it rather than falling back or inventing catalog authority.
Do not construct a selected_theme_v1 payload from this document.

Set both data-bg-system="${theme.system_id}" and data-bg-mode="light" or "dark"
on the same artifact scope. Use the active pinned mode; default_mode is
"${theme.default_mode}" only when an explicit new canonical selection needs a
default. App appearance is independent and must not switch artifact mode.
No matching system/mode attributes means no canonical styling.
The logical CSS identity is not the catalog row ID, revision, digest or capability.

Use var(--background), var(--foreground), card, popover, muted and their foreground roles.
Use primary, secondary, and accent roles with their foreground variants.
Use the success, warning, destructive, and info families. Use each *-text variant on background
or card, each *-foreground on its matching fill, and input/ring for visible
boundaries/focus. Respect the immutable contrast_pairs in theme.json; arbitrary
alpha overlays, gradients and undeclared combinations have no contrast claim.
Artifact colours are complete colours, not Tailwind RGB-channel bindings.
Canonical colour aliases are synthesized roles, not a reconstruction of all old
colours or chart ramps. Exact production brand anchors remain in theme.json.

Use canonical font-sans and font-mono, font-size-body and font-size-heading,
font-weight-body and font-weight-heading, line-height-body and line-height-heading,
space-1, space-2, space-3, space-4, space-6, radius, radius-control, radius-pill,
shadow-sm, shadow-lg, motion-fast, motion-normal and motion-easing for their roles.
Keep the original local font loading and independent body/display family,
responsive typography, family/layout and surface contracts. Do not replace them
with these scalar roles or generic fonts. Preserve reduced-motion behaviour.
Do not modify original source files or adopt/style existing artwork implicitly.
`;
}
