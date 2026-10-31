import { expect, test } from "bun:test";
import brands from "../../backend/tests/fixtures/theme-engine/baseline/brand-anchors.json";
import edges from "../../backend/tests/fixtures/theme-engine/baseline/boundary-colors.json";
import { gamutMapOklch, normalizeHue, oklchToRgb, parseHexColor, parseRgb, rgbToOklch,
  type RgbColor } from "../src/color";
import { UpgradeContractError } from "../src/contract-parser";
import { createDefaultPalette, type PaletteState } from "../src/palette";
import {
  THEME_CONTRAST_PAIRS, THEME_LIGHTNESS_STEPS, THEME_LIMITS, THEME_TOKEN_REGISTRY, SEMANTIC_THEME_MODES,
  createDefaultThemeSettings, emitAppThemeCss, emitArtifactThemeCss, getThemeSettings,
  CANONICAL_THEME_EMITTER, parseCanonicalTransferProof, parseSemanticTheme, serializeSemanticTheme, synthesizeTheme, updateThemePalette,
  type CanonicalTransferProof, type SemanticTheme, type SemanticThemeMode, type ThemeEasing, type ThemeSynthesisInput,
} from "../src/theme";

function transferProof() {
  const file = { size_bytes: 1, sha256: "1".repeat(64) };
  return { schema_version: 1, emitter_version: CANONICAL_THEME_EMITTER,
    json: { ...file }, css: { ...file }, skill: { ...file } } satisfies CanonicalTransferProof;
}

test("Given a canonical byte declaration When parsed Then exact members are retained without sharing mutable input", () => {
  const input = transferProof(), parsed = parseCanonicalTransferProof(input);
  expect(parsed).toEqual(input);
  input.json.sha256 = "2".repeat(64);
  expect(parsed.json.sha256).toBe("1".repeat(64));
});

test.each([
  ["unknown version", { ...transferProof(), schema_version: 2 }],
  ["unknown emitter", { ...transferProof(), emitter_version: "foreign" }],
  ["unknown key", { ...transferProof(), owner: "not-authority" }],
  ["missing guide", { schema_version: 1, emitter_version: CANONICAL_THEME_EMITTER, json: transferProof().json, css: transferProof().css }],
  ["null member", { ...transferProof(), css: null }],
  ["empty member", { ...transferProof(), css: { ...transferProof().css, size_bytes: 0 } }],
  ["fractional size", { ...transferProof(), css: { ...transferProof().css, size_bytes: 1.5 } }],
  ["nonfinite size", { ...transferProof(), css: { ...transferProof().css, size_bytes: Infinity } }],
  ["large JSON", { ...transferProof(), json: { ...transferProof().json, size_bytes: 262145 } }],
  ["large CSS", { ...transferProof(), css: { ...transferProof().css, size_bytes: 262145 } }],
  ["large guide", { ...transferProof(), skill: { ...transferProof().skill, size_bytes: 65537 } }],
  ["uppercase hash", { ...transferProof(), css: { ...transferProof().css, sha256: "A".repeat(64) } }],
  ["terminal LF hash", { ...transferProof(), css: { ...transferProof().css, sha256: `${"1".repeat(64)}\n` } }],
  ["unknown member key", { ...transferProof(), json: { ...transferProof().json, path: "elsewhere" } }],
] as const)("Given %s in canonical transfer input When parsed Then the closed byte declaration rejects it", (_name, input) => {
  expect(() => parseCanonicalTransferProof(input)).toThrow(UpgradeContractError);
});

test("Given removed semantic palette sources When an authorized edit regenerates Then prior values detach explicitly without selecting replacements", () => {
  const original = synthesizeTheme(inputFor());
  const before = serializeSemanticTheme(original);
  const anchor = original.palette.anchors.find(value => value.id === "brand-anchor");
  if (anchor === undefined) throw new Error("Missing brand fixture");
  const palette = { ...original.palette, anchors: [], scales: original.palette.scales.map(scale => ({ ...scale, id: `new-${scale.id}` })) };
  expect(() => parseSemanticTheme({ ...original, palette, brand_anchors: [] })).toThrow(UpgradeContractError);
  const changed = updateThemePalette(original, palette);
  expect(changed.palette).toEqual(palette);
  expect(changed.sources.brand).toEqual({ kind: "color", color: anchor.color });
  expect(changed.sources.surface.kind).toBe("colors");
  for (const mode of SEMANTIC_THEME_MODES) for (const key of ["background", "card", "muted", "border", "primary", "accent"] as const) {
    expect(changed.modes[mode][key]).toEqual(original.modes[mode][key]);
  }
  const reintroduced = updateThemePalette(changed, { ...palette,
    anchors: [{ ...anchor, color: parseHexColor("#00ff00") }], scales: original.palette.scales });
  expect(reintroduced.sources).toEqual(changed.sources);
  expect(reintroduced.modes.light.primary).toEqual(changed.modes.light.primary);
  expect(serializeSemanticTheme(original)).toBe(before);
});

test("Given retained source references and aliases When the palette changes Then settings and aliases survive while the selected brand updates", () => {
  const original = synthesizeTheme(inputFor());
  const aliased = parseSemanticTheme({ ...original, modes: {
    ...original.modes, light: { ...original.modes.light, "space-2": { type: "alias", target: "space-1" } },
  } });
  const changed = updateThemePalette(aliased, { ...aliased.palette, anchors: aliased.palette.anchors.map(anchor =>
    anchor.id === "brand-anchor" ? { ...anchor, color: parseHexColor("#126ab0") } : anchor) });
  expect(changed.sources).toEqual(aliased.sources);
  expect(changed.modes.light["space-2"]).toEqual(aliased.modes.light["space-2"]);
  expect(getThemeSettings(changed)).toEqual(getThemeSettings(aliased));
  expect(changed.modes.light.primary).not.toEqual(aliased.modes.light.primary);
  expect(parseSemanticTheme(serializeSemanticTheme(changed))).toEqual(changed);
});

function inputFor(color: RgbColor = parseHexColor("#b64128"), system_id = "test-brand"): ThemeSynthesisInput {
  const palette: PaletteState = { ...createDefaultPalette(),
    anchors: [{ id: "brand-anchor", name: "Original brand", color }] };
  return { system_id, default_mode: "light", palette,
    sources: { brand: { kind: "anchor", id: "brand-anchor" }, surface: { kind: "scale", id: "neutral" },
      status: { success: parseHexColor("#19734a"), warning: parseHexColor("#a46b00"),
        destructive: parseHexColor("#b42318"), info: parseHexColor("#315f91") } },
    settings: { light: createDefaultThemeSettings(), dark: createDefaultThemeSettings() } };
}

function lightPatch(theme: SemanticTheme, patch: Readonly<Record<string, unknown>>): unknown {
  return { ...theme, modes: { ...theme.modes, light: { ...theme.modes.light, ...patch } } };
}
function block(css: string, mode: SemanticThemeMode, app: boolean): ReadonlyMap<string, string> {
  const attribute = app ? "data-theme" : "data-bg-mode";
  const start = css.indexOf(`[${attribute}="${mode}"] {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("}", start);
  const variables = new Map<string, string>();
  for (const match of css.slice(start, end).matchAll(/--([a-z0-9-]+): ([^;\n]+);/g)) {
    expect(variables.has(match[1])).toBe(false);
    variables.set(match[1], match[2]);
  }
  return variables;
}
function required(map: ReadonlyMap<string, string>, key: string): string {
  const value = map.get(key);
  expect(value).toBeDefined();
  if (value === undefined) throw new UpgradeContractError("missing_required_field", key);
  return value;
}
function emittedChannels(value: string, app: boolean): readonly number[] {
  if (app) {
    expect(value).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    return value.split(" ").map(Number);
  }
  expect(value).toMatch(/^#[0-9a-f]{6}$/);
  return [1, 3, 5].map(i => Number.parseInt(value.slice(i, i + 2), 16));
}
// Independent WCAG calculation over bytes recovered from the emitted CSS, not engine floats.
function contrast(a: readonly number[], b: readonly number[]): number {
  const luminance = (channels: readonly number[]) => channels.reduce((sum, channel, i) => {
    const encoded = channel / 255;
    const linear = encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][i];
  }, 0);
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function assertEmittedContrast(theme: SemanticTheme): void {
  for (const app of [false, true]) {
    const css = app ? emitAppThemeCss(theme) : emitArtifactThemeCss(theme);
    for (const mode of SEMANTIC_THEME_MODES) {
      const variables = block(css, mode, app);
      for (const pair of theme.contrast_pairs) {
        const fg = emittedChannels(required(variables, pair.foreground), app);
        const bg = emittedChannels(required(variables, pair.background), app);
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(pair.usage === "body" ? 4.5 : 3);
      }
      for (const [key, kind] of Object.entries(THEME_TOKEN_REGISTRY)) {
        const value = required(variables, key);
        if (kind === "color") for (const channel of emittedChannels(value, app)) {
          expect(Number.isInteger(channel)).toBe(true);
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
        }
      }
    }
  }
}

test("Given frozen test oracles When enumerated Then all registered brands and both edge gamuts are covered", () => {
  expect(brands.rows).toHaveLength(43);
  expect(new Set(brands.rows.map(row => row.system_id)).size).toBe(43);
  expect(new Set(edges.rows.map(row => row.gamut))).toEqual(new Set(["srgb", "display-p3"]));
  expect(edges.rows).toHaveLength(54);
});

// Frozen files are TEST ORACLES only. Production synthesis receives explicit inputs.
for (const row of [...brands.rows, ...edges.rows]) {
  test(`Given frozen ${row.id} When synthesized Then both emitted modes pass every declared pair and retain exact anchors`, () => {
    const color = parseRgb({ space: row.gamut, r: row.rgb[0], g: row.rgb[1], b: row.rgb[2] });
    const input = inputFor(color, "system_id" in row ? row.system_id : row.id);
    const before = JSON.stringify(input);
    const theme = synthesizeTheme(input);
    expect(theme.palette.anchors).toEqual(input.palette.anchors);
    expect(theme.brand_anchors).toEqual(input.palette.anchors);
    expect(theme.brand_anchors[0].color).toEqual(color);
    expect(theme.modes.light).not.toEqual(theme.modes.dark);
    expect(theme.contrast_pairs).toEqual(THEME_CONTRAST_PAIRS);
    expect(Object.keys(theme.modes.light)).toEqual(Object.keys(THEME_TOKEN_REGISTRY));
    expect(Object.keys(theme.modes.dark)).toEqual(Object.keys(THEME_TOKEN_REGISTRY));
    const serialized = serializeSemanticTheme(theme);
    expect(parseSemanticTheme(serialized)).toEqual(theme);
    expect(serialized).toBe(serializeSemanticTheme(synthesizeTheme(input)));
    expect(JSON.stringify(input)).toBe(before);
    assertEmittedContrast(theme);
  });
}

test("Given unordered records When parsed and serialized Then canonical order and terminal LF are stable", () => {
  const theme = synthesizeTheme(inputFor());
  const reordered = Object.fromEntries(Object.entries({ ...theme, modes: {
    dark: Object.fromEntries(Object.entries(theme.modes.dark).reverse()),
    light: Object.fromEntries(Object.entries(theme.modes.light).reverse()),
  } }).reverse());
  const parsed = parseSemanticTheme(reordered);
  const text = serializeSemanticTheme(theme);
  expect(serializeSemanticTheme(parsed)).toBe(text);
  expect(text.endsWith("\n")).toBe(true);
  expect(text.endsWith("\n\n")).toBe(false);
  expect(parsed).not.toBe(theme);
  expect(parsed.modes.light).not.toBe(theme.modes.light);
  expect(parsed.brand_anchors).not.toBe(theme.brand_anchors);
  expect(parsed.brand_anchors[0].color).not.toBe(theme.brand_anchors[0].color);
});

test("Given exact fractional input anchors When synthesized Then only derived semantic colours become integer bytes", () => {
  const color = parseRgb({ space: "display-p3", r: 0.12345678901234567, g: 0.9876543210987654, b: 0.3456789012345679 });
  const input = inputFor(color);
  const settings = { ...input.settings.light, radius: { type: "length", value: 0.12345678901234567, unit: "rem" } as const };
  const theme = synthesizeTheme({ ...input, settings: { light: settings, dark: input.settings.dark } });
  const roundtrip = parseSemanticTheme(serializeSemanticTheme(theme));
  expect(roundtrip.brand_anchors[0].color).toEqual(color);
  expect(roundtrip.palette.anchors[0].color).toEqual(color);
  expect(roundtrip.brand_anchors[0].color.r).not.toBe(Number(color.r.toFixed(8)));
  expect(roundtrip.modes.light.radius).toEqual(settings.radius);
  for (const mode of SEMANTIC_THEME_MODES) {
    for (const value of Object.values(roundtrip.modes[mode])) if (value.type === "color") {
      expect(value.channels.every(Number.isInteger)).toBe(true);
    }
  }
  assertEmittedContrast(roundtrip);
});

test("Given malformed boundaries When parsed Then root modes registry and obligations are closed", () => {
  const theme = synthesizeTheme(inputFor());
  const invalid: readonly unknown[] = [null, [], {}, "{", "null", { ...theme, schema_version: 2 },
    { ...theme, extra: true }, { ...theme, default_mode: "system" },
    { ...theme, modes: { light: theme.modes.light } },
    { ...theme, modes: { light: theme.modes.light, dark: theme.modes.dark, auto: theme.modes.dark } },
    { ...theme, contrast_pairs: [] }, { ...theme, contrast_pairs: [...theme.contrast_pairs].reverse() },
    { ...theme, contrast_pairs: theme.contrast_pairs.map((pair, i) => i ? pair : { ...pair, usage: "ui" }) },
    { ...theme, brand_anchors: [] }, { ...theme, palette: { ...theme.palette, extra: true } },
    { ...theme, sources: { ...theme.sources, brand: { kind: "anchor", id: "missing" } } },
    { ...theme, sources: { ...theme.sources, surface: { kind: "scale", id: "missing" } } },
    { ...theme, sources: { ...theme.sources, extra: true } },
    { ...theme, sources: { ...theme.sources, status: { ...theme.sources.status, extra: true } } },
    lightPatch(theme, { extra: { type: "length", value: 1, unit: "px" } })];
  for (const value of invalid) expect(() => parseSemanticTheme(value)).toThrow(UpgradeContractError);
  for (const key of Object.keys(THEME_TOKEN_REGISTRY)) {
    const missing = Object.fromEntries(Object.entries(theme.modes.light).filter(([name]) => name !== key));
    expect(() => parseSemanticTheme({ ...theme, modes: { ...theme.modes, light: missing } })).toThrow(UpgradeContractError);
    expect(() => parseSemanticTheme(lightPatch(theme, { [key]: null }))).toThrow(UpgradeContractError);
  }
  expect(() => parseSemanticTheme(" ".repeat(THEME_LIMITS.json + 1))).toThrow(UpgradeContractError);
  expect(() => parseSemanticTheme("\u00e9".repeat(THEME_LIMITS.json))).toThrow(UpgradeContractError);
});

test("Given aliases When resolved Then same-kind chains work but missing cross-type and cyclic references fail", () => {
  const theme = synthesizeTheme(inputFor());
  const aliased = parseSemanticTheme(lightPatch(theme, {
    popover: { type: "alias", target: "card" },
    "popover-foreground": { type: "alias", target: "card-foreground" },
    "space-2": { type: "alias", target: "space-3" },
    "space-3": { type: "alias", target: "space-4" },
  }));
  const values = block(emitArtifactThemeCss(aliased), "light", false);
  expect(required(values, "popover")).toBe(required(values, "card"));
  expect(required(values, "space-2")).toBe(required(values, "space-4"));
  expect(parseSemanticTheme(serializeSemanticTheme(aliased))).toEqual(aliased);
  const invalid = [
    { radius: { type: "alias", target: "radius" } },
    { "space-2": { type: "alias", target: "space-3" }, "space-3": { type: "alias", target: "space-2" } },
    { foreground: { type: "alias", target: "background" } }, // valid type, invalid contrast
    { foreground: { type: "alias", target: "radius" } },
    { "font-sans": { type: "alias", target: "missing" } },
    { "font-sans": { type: "alias", target: "toString" } },
    { radius: { type: "alias", target: "space-1", extra: 1 } },
  ];
  for (const patch of invalid) expect(() => parseSemanticTheme(lightPatch(theme, patch))).toThrow(UpgradeContractError);
});

test("Given unsupported values When parsed Then expressions units nonfinite data and malformed structured values fail", () => {
  const theme = synthesizeTheme(inputFor());
  const invalid = [
    { foreground: "#ffffff" }, { foreground: { type: "expression", value: "var(--foreground)" } },
    { foreground: { type: "color", space: "display-p3", channels: [1, 0, 0] } },
    { foreground: { type: "color", space: "srgb", channels: [256, 0, 0] } },
    { foreground: { type: "color", space: "srgb", channels: [0.5, 0, 0] } },
    { foreground: { type: "color", space: "srgb", channels: [0, 0] } },
    { foreground: { type: "color", space: "srgb", channels: [0, 0, 0], alpha: 1 } },
    { radius: { type: "length", value: -1, unit: "px" } },
    { radius: { type: "length", value: 1, unit: "vw" } },
    { radius: { type: "length", value: "calc(1px + 1rem)", unit: "px" } },
    { "font-size-body": { type: "length", value: 0, unit: "px" } },
    { "font-size-heading": { type: "length", value: 257, unit: "px" } },
    { "line-height-body": { type: "ratio", value: 1.44 } },
    { "font-weight-body": { type: "weight", value: 400.5 } },
    { "motion-normal": { type: "duration", value: 200, unit: "s" } },
    { "motion-normal": { type: "duration", value: 10001, unit: "ms" } },
    { "motion-easing": { type: "easing", value: "cubic-bezier(0,0,1,1)" } },
    { "font-sans": { type: "font-family", families: [] } },
    { "font-sans": { type: "font-family", families: ["system-ui", "system-ui"] } },
    { "font-sans": { type: "font-family", families: Array.from({ length: 9 }, (_, i) => `Family ${i}`) } },
    { "shadow-sm": { type: "shadow", layers: [{ unit: "px", x: 0, y: 1, blur: -1, spread: 0,
      color: { type: "color", space: "srgb", channels: [0, 0, 0] }, alpha: 0.5 }] } },
    { "shadow-sm": { type: "shadow", layers: Array.from({ length: 5 }, () => ({})) } },
  ];
  for (const patch of invalid) expect(() => parseSemanticTheme(lightPatch(theme, patch))).toThrow(UpgradeContractError);
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const key of ["radius", "font-size-body", "space-1"]) {
      expect(() => parseSemanticTheme(lightPatch(theme, { [key]: { type: "length", value, unit: "px" } }))).toThrow(UpgradeContractError);
    }
    expect(() => parseSemanticTheme(lightPatch(theme, {
      foreground: { type: "color", space: "srgb", channels: [value, 0, 0] },
    }))).toThrow(UpgradeContractError);
  }
});

test("Given authored cubic curves When parsed and emitted Then exact geometry survives both CSS contracts", () => {
  const theme = synthesizeTheme(inputFor());
  for (const points of [[0.2, 0, 0, 1], [0, -0.25, 1, 1.25], [0.12345678901234567, 0, 1, 1]] as const) {
    const curve = { type: "easing", value: { type: "cubic-bezier", points } } satisfies ThemeEasing;
    const parsed = parseSemanticTheme(lightPatch(theme, { "motion-easing": curve }));
    expect(parsed.modes.light["motion-easing"]).toEqual(curve);
    expect(parsed.modes.light["motion-easing"]).not.toBe(curve);
    expect(parseSemanticTheme(serializeSemanticTheme(parsed))).toEqual(parsed);
    for (const app of [false, true]) {
      const css = app ? emitAppThemeCss(parsed) : emitArtifactThemeCss(parsed);
      expect(required(block(css, "light", app), "motion-easing")).toBe(`cubic-bezier(${points.join(", ")})`);
    }
  }
});

test("Given malformed cubic curves When parsed Then arity finite coordinates and CSS horizontal limits are enforced", () => {
  const theme = synthesizeTheme(inputFor());
  const values: readonly unknown[] = [
    { type: "cubic-bezier", points: [0, 0, 1] },
    { type: "cubic-bezier", points: [0, 0, 1, 1, 0] },
    { type: "cubic-bezier", points: [-0.01, 0, 1, 1] },
    { type: "cubic-bezier", points: [0, 0, 1.01, 1] },
    { type: "cubic-bezier", points: [0, NaN, 1, 1] },
    { type: "cubic-bezier", points: [0, 0, 1, Infinity] },
    { type: "cubic-bezier", points: [0, "0);color:red", 1, 1] },
    { type: "cubic-bezier", points: [0, 0, 1, 1], extra: true },
    { type: "steps", points: [0, 0, 1, 1] },
  ];
  for (const value of values) {
    expect(() => parseSemanticTheme(lightPatch(theme, { "motion-easing": { type: "easing", value } }))).toThrow(UpgradeContractError);
  }
});

test("Given selector and value injection attempts When parsed or emitted Then no unchecked syntax reaches CSS", () => {
  const theme = synthesizeTheme(inputFor());
  for (const system_id of ['x"]{}body{color:red}/*', "x y", "../catalog", "", "x\n", "x".repeat(81), "</style>", "Upper"]) {
    const invalid = { ...theme, system_id };
    expect(() => parseSemanticTheme(invalid)).toThrow(UpgradeContractError);
    expect(() => emitAppThemeCss(invalid)).toThrow(UpgradeContractError);
    expect(() => emitArtifactThemeCss(invalid)).toThrow(UpgradeContractError);
  }
  for (const family of ['X";color:red;/*', "url(https://invalid)", "</style>", "var(--font)", "A\\B", "A\nB"]) {
    expect(() => parseSemanticTheme(lightPatch(theme, {
      "font-sans": { type: "font-family", families: [family] },
    }))).toThrow(UpgradeContractError);
  }
  const artifact = emitArtifactThemeCss(theme), app = emitAppThemeCss(theme);
  const selectors = (css: string) => [...css.matchAll(/(?:^|\n)([^@ \n][^{\n]*)(?: \{|,\n)/g)].map(match => match[1]);
  expect(selectors(artifact).length).toBeGreaterThanOrEqual(2);
  expect(selectors(app).length).toBeGreaterThanOrEqual(2);
  for (const selector of selectors(artifact)) {
    expect(selector).toContain('[data-bg-system="test-brand"]');
    expect(selector).toMatch(/\[data-bg-mode="(?:light|dark)"\]/);
    expect(selector).not.toContain("data-theme=");
  }
  for (const selector of selectors(app)) {
    expect(selector).toContain(':root[data-bg-app-system="test-brand"]');
    expect(selector).toMatch(/\[data-theme="(?:light|dark)"\]/);
    expect(selector).not.toContain("data-bg-mode=");
  }
});

test("Given one canonical theme When emitted Then Tailwind channels and complete artifact aliases never mix", () => {
  const theme = synthesizeTheme(inputFor());
  for (const mode of SEMANTIC_THEME_MODES) {
    const artifact = block(emitArtifactThemeCss(theme), mode, false);
    const app = block(emitAppThemeCss(theme), mode, true);
    for (const [key, kind] of Object.entries(THEME_TOKEN_REGISTRY)) {
      if (kind === "color") {
        expect(emittedChannels(required(app, key), true)).toEqual(emittedChannels(required(artifact, key), false));
        // A Tailwind alpha binding can supply its own alpha without nesting a colour function.
        expect(`rgb(${required(app, key)} / 0.1)`).toMatch(/^rgb\(\d+ \d+ \d+ \/ 0\.1\)$/);
      } else expect(required(app, key)).toBe(required(artifact, key));
    }
    expect(required(artifact, "primary-blue")).toBe(required(artifact, "primary"));
    expect(required(artifact, "bg")).toBe(required(artifact, "background"));
    expect(required(artifact, "fg-on-brand")).toBe(required(artifact, "primary-foreground"));
    for (const key of ["primary-blue", "action-blue", "bg", "fg-on-brand", "focus-ring"]) expect(app.has(key)).toBe(false);
  }
  for (const css of [emitArtifactThemeCss(theme), emitAppThemeCss(theme)]) {
    expect(css).toContain("color-scheme: light;");
    expect(css).toContain("color-scheme: dark;");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("--motion-fast: 0ms;");
    expect(css.endsWith("\n")).toBe(true);
  }
});

test("Given explicit P3 status sources and typed settings When regenerated Then unrelated per-mode settings survive", () => {
  const input = inputFor();
  const light = { ...input.settings.light,
    "font-sans": { type: "font-family", families: ["Local Brand Sans", "sans-serif"] } as const,
    radius: { type: "length", value: 0.75, unit: "rem" } as const,
    "motion-normal": { type: "duration", value: 0, unit: "ms" } as const };
  const dark = { ...input.settings.dark, "shadow-lg": { type: "shadow", layers: [] } as const };
  const source = synthesizeTheme({ ...input, settings: { light, dark },
    sources: { ...input.sources, status: {
      success: parseRgb({ space: "display-p3", r: 0, g: 1, b: 0 }),
      warning: parseRgb({ space: "display-p3", r: 1, g: 1, b: 0 }),
      destructive: parseRgb({ space: "display-p3", r: 1, g: 0, b: 0 }),
      info: parseRgb({ space: "display-p3", r: 0, g: 0, b: 1 }),
    } } });
  const changed = synthesizeTheme({ ...input, sources: source.sources,
    palette: { ...input.palette, anchors: [{ ...input.palette.anchors[0], color: parseHexColor("#665522") }] },
    settings: getThemeSettings(source) });
  expect(getThemeSettings(changed)).toEqual({ light, dark });
  expect(changed.sources).toEqual(source.sources);
  assertEmittedContrast(source);
  assertEmittedContrast(changed);
});

test("Given moved and renamed draggable stops When synthesized Then semantic maps still sample absolute positions", () => {
  const input = inputFor(), first = synthesizeTheme(input);
  const palette = { ...input.palette, stops: [{ id: "first", name: "First", position: 0.1 },
    { id: "last", name: "Last", position: 0.9 }], range: { start: 0.1, end: 0.9 } };
  const changed = synthesizeTheme({ ...input, palette });
  expect(changed.modes).toEqual(first.modes);
  expect(changed.brand_anchors).toEqual(first.brand_anchors);
  const custom: ThemeSynthesisInput = { ...input, palette: { ...input.palette, scales: [
    { id: "warm-surface", name: "Warm surface", kind: "hue", hue: 80 } as const,
  ] }, sources: { ...input.sources, surface: { kind: "scale", id: "warm-surface" } } };
  const warm = synthesizeTheme(custom);
  expect(warm.modes.light.background).not.toEqual(first.modes.light.background);
  assertEmittedContrast(warm);
});

test("Given a near-threshold quantized pair When imported Then the emitted byte contrast is the validation authority", () => {
  const theme = synthesizeTheme(inputFor());
  const color = (channel: number) => ({ type: "color", space: "srgb", channels: [channel, channel, channel] });
  const pair = (channel: number) => lightPatch(theme, { background: color(255), foreground: color(channel) });
  // #777 is 4.478... against white, despite its common use as an AA approximation.
  expect(() => parseSemanticTheme(pair(119))).toThrow(UpgradeContractError);
  const passing = parseSemanticTheme(pair(118));
  expect(contrast([118, 118, 118], [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
  assertEmittedContrast(passing);
});

test("Given an inaccessible brand When adjusted Then the nearest supported lightness with fixed hue is chosen", () => {
  const input = inputFor(parseHexColor("#f4c43b"));
  const theme = synthesizeTheme(input), raw = rgbToOklch(input.palette.anchors[0].color);
  const precision = (value: number) => Math.round(value * 100000000) / 100000000;
  const source = { l: precision(raw.l), c: precision(raw.c), h: normalizeHue(precision(raw.h)) };
  const values = block(emitArtifactThemeCss(theme), "light", false);
  const surfaces = ["background", "card", "muted"].map(key => emittedChannels(required(values, key), false));
  const quantized = (l: number) => {
    const value = oklchToRgb(gamutMapOklch({ ...source, l: precision(l) }, "srgb"), "srgb");
    return "#" + [value.r, value.g, value.b].map(channel =>
      Math.round(precision(channel) * 255).toString(16).padStart(2, "0")).join("");
  };
  const levels = [source.l, ...Array.from({ length: THEME_LIGHTNESS_STEPS + 1 }, (_, i) => i / THEME_LIGHTNESS_STEPS)]
    .sort((a, b) => Math.abs(a - source.l) - Math.abs(b - source.l) || a - b);
  const first = levels.find(l => surfaces.every(surface => contrast(emittedChannels(quantized(l), false), surface) >= 3));
  expect(first).toBeDefined();
  if (first === undefined) throw new UpgradeContractError("invalid_field", "test.lightness");
  expect(required(values, "primary")).toBe(quantized(first));
  expect(required(values, "primary")).not.toBe("#f4c43b");
  expect(theme.brand_anchors).toEqual(input.palette.anchors);
});

test("Given malformed synthesis inputs When constructed Then missing production seeds and incomplete settings fail closed", () => {
  const input = inputFor();
  const extra = { ...input, extra: true };
  expect(() => synthesizeTheme(extra)).toThrow(UpgradeContractError);
  expect(() => synthesizeTheme({ ...input, palette: { ...input.palette, anchors: [] } })).toThrow(UpgradeContractError);
  expect(() => synthesizeTheme({ ...input, sources: { ...input.sources, surface: { kind: "scale", id: "missing" } } })).toThrow(UpgradeContractError);
  const incomplete = { ...input.settings.light };
  Reflect.deleteProperty(incomplete, "space-1");
  expect(() => synthesizeTheme({ ...input, settings: { light: incomplete, dark: input.settings.dark } })).toThrow(UpgradeContractError);
  expect(() => synthesizeTheme({ ...input, settings: { light: { ...input.settings.light,
    radius: { type: "alias", target: "radius-control" },
    "radius-control": { type: "alias", target: "radius" } }, dark: input.settings.dark } })).toThrow(UpgradeContractError);
});
