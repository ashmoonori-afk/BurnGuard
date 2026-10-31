import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { bundledDesignSystems } from "../../packages/backend/src/data/bundled-design-systems";
import { parsePaletteState } from "../../packages/shared/src/palette";
import {
  emitAppThemeCss, emitArtifactThemeCss, SEMANTIC_THEME_MODES,
  THEME_CONTRAST_PAIRS, THEME_TOKEN_REGISTRY,
  type SemanticTheme, type ThemeTokenName,
} from "../../packages/shared/src/theme";
import {
  BundledCanonicalGenerationError, bundledCanonicalPaths, generateThemeCanonical,
  type BundledCanonicalTheme,
} from "../build-theme-canonical";
import { MeasurementError, requireMeasurement } from "./theme-engine-a-measurement";

const TOKEN_NAMES = Object.keys(THEME_TOKEN_REGISTRY);
const MEMBERS = ["SKILL.md", "theme.css", "theme.json"] as const;
const GAMUTS = ["srgb", "display-p3"] as const;
export const B_SOURCE_FILES = [
  "packages/shared/src/theme.ts", "packages/shared/src/palette.ts",
  "packages/shared/src/color.ts", "packages/shared/src/color-gamut.ts",
  "packages/shared/src/contract-parser.ts",
  "packages/backend/src/data/bundled-design-systems.ts",
  "packages/backend/src/services/bundled-theme-refresh.ts",
  "packages/backend/src/services/bundled-theme-identity.ts",
  "scripts/build-theme-canonical.ts", "scripts/build-theme-palettes.ts",
  "packages/frontend/tailwind.config.ts", "scripts/qa/theme-engine-fixtures.ts",
  "scripts/qa/theme-engine-measure.ts", "scripts/qa/theme-engine-a-measurement.ts",
  "scripts/qa/theme-engine-b-measurement.ts",
] as const;

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
function tokenName(name: string): name is ThemeTokenName {
  return Object.hasOwn(THEME_TOKEN_REGISTRY, name);
}
type Channels = readonly number[];

/** WCAG relative luminance, independently calculated from the emitted integer bytes.
 * No production conversion, contrast, or theme-validation function is used here.
 */
export function emittedContrast(a: Channels, b: Channels): number {
  const luminance = (rgb: Channels) => {
    requireMeasurement(rgb.length === 3 && rgb.every(n => Number.isInteger(n) && n >= 0 && n <= 255),
      "B_CHANNEL_FORMAT");
    return rgb.reduce((sum, byte, i) => {
      const c = byte / 255;
      return sum + (i === 0 ? 0.2126 : i === 1 ? 0.7152 : 0.0722)
        * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    }, 0);
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function blocks(css: string, theme: SemanticTheme, app: boolean) {
  // Reduced-motion overrides contain no role colours and are not contrast samples.
  const base = css.split("@media")[0] ?? "";
  const found = [...base.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  requireMeasurement(found.length === 2 && base.replace(/[^{}]+\{[^{}]*\}/g, "").trim() === "",
    "B_CSS_SCOPE");
  return SEMANTIC_THEME_MODES.map((mode, i) => {
    const block = found[i];
    const selector = app
      ? `:root[data-bg-app-system="${theme.system_id}"][data-theme="${mode}"]`
      : `[data-bg-system="${theme.system_id}"][data-bg-mode="${mode}"]`;
    requireMeasurement(block?.[1]?.trim() === selector, "B_CSS_SCOPE");
    const fields = new Map<string, string>();
    const declarations = (block?.[2] ?? "").split(";");
    requireMeasurement(declarations.pop()?.trim() === "", "B_CSS_DECLARATION");
    for (const declaration of declarations) {
      const match = declaration.trim().match(/^(--[a-z][a-z0-9-]*|color-scheme)\s*:\s*([^{};]+)$/);
      const name = match?.[1], value = match?.[2]?.trim();
      requireMeasurement(name !== undefined && value !== undefined && !fields.has(name), "B_CSS_DECLARATION");
      fields.set(name, value);
    }
    requireMeasurement(fields.get("color-scheme") === mode, "B_CSS_MODE");
    return fields;
  });
}
function channels(value: string | undefined, app: boolean): Channels {
  requireMeasurement(value !== undefined, "B_MISSING_ROLE");
  if (!app) {
    requireMeasurement(/^#[0-9a-f]{6}$/i.test(value), "B_CHANNEL_FORMAT");
    return [1, 3, 5].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16));
  }
  requireMeasurement(/^\d{1,3} \d{1,3} \d{1,3}$/.test(value), "B_CHANNEL_FORMAT");
  const rgb = value.split(" ").map(Number);
  requireMeasurement(rgb.every(n => n <= 255), "B_CHANNEL_FORMAT");
  return rgb;
}

export function measureThemeCss(theme: SemanticTheme, artifactCss: string, appCss: string) {
  const artifact = blocks(artifactCss, theme, false), app = blocks(appCss, theme, true);
  return SEMANTIC_THEME_MODES.map((mode, i) => {
    const tokens = theme.modes[mode], art = artifact[i], application = app[i];
    requireMeasurement(art !== undefined && application !== undefined, "B_MISSING_MODE");
    requireMeasurement(isDeepStrictEqual(Object.keys(tokens).sort(), [...TOKEN_NAMES].sort()), "B_TYPED_REGISTRY");
    const colors = new Map<string, { readonly artifact: Channels; readonly app: Channels }>();
    for (const name of TOKEN_NAMES) {
      requireMeasurement(tokenName(name), "B_TYPED_REGISTRY");
      let value = tokens[name];
      const visited = new Set<string>([name]);
      while (value.type === "alias") {
        requireMeasurement(tokenName(value.target) && !visited.has(value.target), "B_TYPED_REGISTRY");
        visited.add(value.target);
        value = tokens[value.target];
      }
      requireMeasurement(value.type === THEME_TOKEN_REGISTRY[name], "B_TYPED_REGISTRY");
      const a = art.get(`--${name}`), b = application.get(`--${name}`);
      requireMeasurement(a !== undefined && b !== undefined, "B_MISSING_ROLE");
      if (value.type === "color") {
        const ac = channels(a, false), bc = channels(b, true);
        requireMeasurement(isDeepStrictEqual(ac, bc) && isDeepStrictEqual(ac, value.channels), "B_COLOR_READBACK");
        colors.set(name, { artifact: ac, app: bc });
      } else requireMeasurement(a === b && a.length > 0, "B_TYPED_READBACK");
    }
    const pairs = THEME_CONTRAST_PAIRS.map(pair => {
      const foreground = colors.get(pair.foreground), background = colors.get(pair.background);
      requireMeasurement(foreground !== undefined && background !== undefined, "B_MISSING_ROLE");
      const minimum = pair.usage === "body" ? 4.5 : 3;
      const artifact_ratio = emittedContrast(foreground.artifact, background.artifact);
      const app_ratio = emittedContrast(foreground.app, background.app);
      return { ...pair, minimum, artifact_ratio, app_ratio,
        status: artifact_ratio >= minimum && app_ratio >= minimum ? "PASS" : "FAIL" };
    });
    return { mode, typed_roles: TOKEN_NAMES.length, color_roles: colors.size,
      declared_pairs: pairs.length, passed_pairs: pairs.filter(p => p.status === "PASS").length,
      coverage: pairs.filter(p => p.status === "PASS").length / THEME_CONTRAST_PAIRS.length,
      status: pairs.every(p => p.status === "PASS") ? "PASS" : "FAIL", pairs };
  });
}

/** Inspect the real configuration without executing its plugins or loading a browser. */
export function measureTailwindBindings(config: string) {
  const source = config.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  const bound = new Set<string>();
  for (const match of source.matchAll(/["']([^"'\n]*var\(--([a-z0-9-]+)\)[^"'\n]*)["']/g)) {
    const value = match[1], name = match[2];
    if (name !== undefined && tokenName(name) && THEME_TOKEN_REGISTRY[name] === "color") {
      requireMeasurement(value === `rgb(var(--${name}) / <alpha-value>)`, "B_TAILWIND_BINDING");
      bound.add(name);
    }
  }
  requireMeasurement(["background", "foreground", "primary", "primary-foreground", "border", "input", "ring"]
    .every(name => bound.has(name)), "B_TAILWIND_BINDING");
  return { status: "PASS", bound_roles: [...bound].sort(),
    unbound_roles: TOKEN_NAMES.filter(name => tokenName(name) && THEME_TOKEN_REGISTRY[name] === "color"
      && !bound.has(name)).sort() };
}

export type InstalledCanonical = {
  readonly json: string | null; readonly css: string | null; readonly skill: string | null;
};
export function measureInstalledCanonical(expected: BundledCanonicalTheme, installed: InstalledCanonical) {
  const members = (["json", "css", "skill"] as const).map(member => {
    const actual = installed[member];
    return { member, expected_sha256: digest(expected[member]),
      installed_sha256: actual === null ? null : digest(actual),
      status: actual !== null && actual === expected[member] ? "PASS" : "FAIL" };
  });
  return { status: members.every(member => member.status === "PASS") ? "PASS" : "FAIL", members };
}

async function readText(file: string): Promise<string | null> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 * 1024) return null;
    return await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}
async function snapshot(repository: string): Promise<Readonly<Record<string, string | null>>> {
  const entries: [string, string | null][] = [];
  for (const { slug } of bundledDesignSystems) {
    const p = bundledCanonicalPaths(repository, slug);
    let members: readonly string[] | null;
    try {
      const info = await lstat(p.canonical);
      members = info.isDirectory() && !info.isSymbolicLink() ? (await readdir(p.canonical)).sort() : null;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      members = null;
    }
    entries.push([`${p.relative}/canonical/`, members === null ? null : JSON.stringify(members)]);
    for (const file of [p.source, p.palette, p.json, p.css, p.skill]) {
      entries.push([path.relative(repository, file).split(path.sep).join("/"), await readText(file)]);
    }
  }
  return Object.fromEntries(entries);
}

export async function measureBundledThemes(repository: string) {
  requireMeasurement(bundledDesignSystems.length === 43
    && new Set(bundledDesignSystems.map(t => t.slug)).size === 43, "B_REGISTERED_THEMES");
  const before = await snapshot(repository);
  const rows: {
    readonly slug: string; readonly status: string; readonly code?: string;
    readonly installed?: ReturnType<typeof measureInstalledCanonical> & {
      readonly complete: boolean; readonly modes: ReturnType<typeof measureThemeCss> | null;
    };
    readonly variants?: readonly {
      readonly gamut: typeof GAMUTS[number]; readonly input_sha256: string; readonly json_sha256: string;
      readonly artifact_sha256: string; readonly app_sha256: string;
      readonly modes: ReturnType<typeof measureThemeCss>;
    }[];
  }[] = [];
  for (const { slug } of bundledDesignSystems) {
    const p = bundledCanonicalPaths(repository, slug), base = p.relative;
    const source = before[`${base}/colors_and_type.css`], palette = before[`${base}/palette/state.json`];
    try {
      requireMeasurement(typeof source === "string" && typeof palette === "string", "B_PRODUCTION_INPUT_MISSING");
      const expected = generateThemeCanonical(slug, palette, source);
      const readback = measureInstalledCanonical(expected, {
        json: before[`${base}/canonical/theme.json`] ?? null,
        css: before[`${base}/canonical/theme.css`] ?? null,
        skill: before[`${base}/canonical/SKILL.md`] ?? null,
      });
      const complete = before[`${base}/canonical/`] === JSON.stringify(MEMBERS);
      const installedCss = before[`${base}/canonical/theme.css`];
      const installedModes = readback.status === "PASS" && typeof installedCss === "string"
        ? measureThemeCss(expected.theme, installedCss, emitAppThemeCss(expected.theme)) : null;
      const installed = { ...readback, complete, modes: installedModes,
        status: complete && readback.status === "PASS" ? "PASS" : "FAIL" };
      const state = parsePaletteState(palette);
      const variants = GAMUTS.map(gamut => {
        // Keep production anchors/settings intact. Only the selected sampling gamut changes.
        // Each producer result contains both modes; do not contradict the source's default mode.
        const input = { ...state, gamut };
        const generated = generateThemeCanonical(slug, input, source);
        const artifact = emitArtifactThemeCss(generated.theme), app = emitAppThemeCss(generated.theme);
        return { gamut, input_sha256: digest(JSON.stringify(input)),
          json_sha256: digest(generated.json), artifact_sha256: digest(artifact), app_sha256: digest(app),
          modes: measureThemeCss(generated.theme, artifact, app) };
      });
      rows.push({ slug, installed, variants,
        status: installed.status === "PASS" && variants.every(v => v.modes.every(m => m.status === "PASS"))
          ? "PASS" : "FAIL" });
    } catch (error) {
      if (!(error instanceof MeasurementError) && !(error instanceof BundledCanonicalGenerationError)) throw error;
      rows.push({ slug, status: "FAIL", code: error instanceof MeasurementError ? error.code : "B_PRODUCTION_SYNTHESIS" });
    }
  }
  requireMeasurement(isDeepStrictEqual(before, await snapshot(repository)), "INPUT_CHANGED_DURING_MEASUREMENT");
  const tailwind = measureTailwindBindings(await readFile(path.join(repository, "packages/frontend/tailwind.config.ts"), "utf8"));
  const variants = rows.flatMap(row => row.variants ?? []);
  const modes = variants.flatMap(variant => variant.modes);
  const requiredPairs = 43 * GAMUTS.length * SEMANTIC_THEME_MODES.length * THEME_CONTRAST_PAIRS.length;
  const passedPairs = modes.reduce((sum, mode) => sum + mode.passed_pairs, 0);
  return { status: rows.every(row => row.status === "PASS") && passedPairs === requiredPairs ? "PASS" : "FAIL",
    method: "independent-wcag2-from-emitted-integer-srgb",
    input_sha256: Object.fromEntries(Object.entries(before).map(([name, text]) =>
      [name, text === null ? null : digest(text)])),
    coverage: { registered_themes: 43, measured_themes: rows.filter(row => row.variants !== undefined).length,
      required_variants: 86, measured_variants: variants.length, required_modes: 172, measured_modes: modes.length,
      typed_roles_per_mode: TOKEN_NAMES.length, required_pairs: requiredPairs, passed_pairs: passedPairs,
      declared_pair_pass_rate: passedPairs / requiredPairs,
      installed_passes: rows.filter(row => row.installed?.status === "PASS").length },
    tailwind, rows };
}
