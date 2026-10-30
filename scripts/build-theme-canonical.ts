#!/usr/bin/env bun
/**
 * Read-only production producer. --check reports drift; --patch prints complete-file hunks.
 * Neither mode applies patches or writes files. Materialize only after the lead merges stable A.
 */
import { execFile } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ColorContractError, parseHexColor } from "../packages/shared/src/color";
import { decodeContract, isRecord, UpgradeContractError } from "../packages/shared/src/contract-parser";
import { parsePaletteState } from "../packages/shared/src/palette";
import {
  emitArtifactThemeCss, emitCanonicalThemeGuide, serializeSemanticTheme, synthesizeTheme,
  type ThemeEasing, type ThemeLength, type ThemeSettings, type ThemeShadowLayer,
} from "../packages/shared/src/theme";
import { bundledDesignSystems } from "../packages/backend/src/data/bundled-design-systems";
import {
  themeAdditiveDigest, themeFileHash, type BundledThemeHistory,
} from "../packages/backend/src/services/bundled-theme-refresh";
import { emitBundledPalettePatch, type PaletteFileChange } from "./build-theme-palettes";

const REPOSITORY = path.resolve(import.meta.dir, "..");
const HISTORY_PATH = "packages/backend/src/data/bundled-theme-history.json";
const MEMBERS = ["theme.json", "theme.css", "SKILL.md"] as const;
const NUMBER = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const exec = promisify(execFile);

export class BundledCanonicalGenerationError extends Error {
  readonly code = "bundled_canonical_generation";
  constructor(readonly slug: string, readonly field: string) {
    super(`${slug}: unresolved, unsupported or unowned ${field}`);
  }
}

function registered(slug: string): void {
  if (!bundledDesignSystems.some(theme => theme.slug === slug)) {
    throw new BundledCanonicalGenerationError(slug, "registered slug");
  }
}

/** Native IO paths and portable patch/hash identities are deliberately separate. */
export function bundledCanonicalPaths(repository: string, slug: string, flavor: typeof path = path) {
  registered(slug);
  const directory = flavor.join(repository, "design system themes", slug);
  return {
    relative: `design system themes/${slug}`, directory,
    source: flavor.join(directory, "colors_and_type.css"),
    palette: flavor.join(directory, "palette", "state.json"),
    canonical: flavor.join(directory, "canonical"),
    json: flavor.join(directory, "canonical", "theme.json"),
    css: flavor.join(directory, "canonical", "theme.css"),
    skill: flavor.join(directory, "canonical", "SKILL.md"),
  };
}

/**
 * Closed production grammar: font import plus unconditional :root declarations only.
 * Independent layout/family tokens are retained as uninterpreted values, not evaluated.
 * Reject cascades, duplicate declarations and conditional overrides rather than guessing.
 */
function sourceFields(slug: string, input: string): ReadonlyMap<string, string> {
  if (Buffer.byteLength(input) > 1024 * 1024) throw new BundledCanonicalGenerationError(slug, "CSS size");
  let rest = input.replace(/\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,
    text => text.startsWith("/*") ? " " : text).trim();
  const fields = new Map<string, string>();
  const fontImport = /^@import\s+url\((?:"\.\/fonts\/fonts\.css"|'\.\/fonts\/fonts\.css')\)\s*;/;
  const imported = rest.match(fontImport);
  if (imported) rest = rest.slice(imported[0].length).trim();
  while (rest !== "") {
    const block = rest.match(/^:root\s*\{([^{}]*)\}/);
    if (!block || block[1] === undefined) throw new BundledCanonicalGenerationError(slug, "unconditional :root CSS");
    const declarations = block[1].split(";");
    if (declarations.pop()?.trim() !== "") throw new BundledCanonicalGenerationError(slug, "terminated CSS declaration");
    for (const declaration of declarations) {
      const match = declaration.trim().match(/^(--[a-z][a-z0-9-]*|color-scheme)\s*:\s*([^;{}]+)$/);
      const name = match?.[1], value = match?.[2]?.trim();
      if (!name || !value || fields.has(name)) {
        throw new BundledCanonicalGenerationError(slug, name ?? "CSS declaration");
      }
      fields.set(name, value);
    }
    rest = rest.slice(block[0].length).trim();
  }
  return fields;
}

/** No generic settings fallback: every chosen semantic role has a real production source. */
export function generateThemeCanonical(slug: string, paletteInput: unknown, source: string) {
  registered(slug);
  const fields = sourceFields(slug, source);
  const fail = (field: string): never => { throw new BundledCanonicalGenerationError(slug, field); };
  const field = (name: string): string => fields.get(name) ?? fail(name);
  const number = (value: string, name: string, min: number, max: number, integer = false): number => {
    if (!new RegExp(`^${NUMBER}$`).test(value)) return fail(name);
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) return fail(name);
    return n === 0 ? 0 : n;
  };
  const length = (name: string): ThemeLength => {
    const match = field(name).match(new RegExp(`^(${NUMBER})(px|rem)$`));
    const value = match?.[1], unit = match?.[2];
    if (value === undefined || (unit !== "px" && unit !== "rem")) return fail(name);
    return { type: "length", value: number(value, name, 0, 4096), unit };
  };
  const families = (name: string) => ({
    type: "font-family" as const,
    families: field(name).split(",").map(part => {
      const match = part.trim().match(/^(?:"([A-Za-z][A-Za-z0-9 -]*)"|'([A-Za-z][A-Za-z0-9 -]*)'|([A-Za-z][A-Za-z0-9 -]*))$/);
      return match?.[1] ?? match?.[2] ?? match?.[3] ?? fail(name);
    }),
  });
  const duration = (name: string) => {
    const value = field(name);
    if (!value.endsWith("ms")) return fail(name);
    return { type: "duration" as const, value: number(value.slice(0, -2), name, 0, 10000), unit: "ms" as const };
  };
  const easing = (): ThemeEasing => {
    const name = "--ease-standard", value = field(name);
    switch (value) {
      case "linear": case "ease": case "ease-in": case "ease-out": case "ease-in-out":
        return { type: "easing", value };
      default: {
        const match = value.match(/^cubic-bezier\(([^()]*)\)$/);
        const parts = match?.[1]?.split(",").map(part => part.trim());
        const [x1, y1, x2, y2] = parts ?? [];
        if (parts?.length !== 4 || x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return fail(name);
        return { type: "easing", value: { type: "cubic-bezier", points: [
          number(x1, name, 0, 1), number(y1, name, -Number.MAX_VALUE, Number.MAX_VALUE),
          number(x2, name, 0, 1), number(y2, name, -Number.MAX_VALUE, Number.MAX_VALUE),
        ] } };
      }
    }
  };
  const shadow = (name: string): { readonly type: "shadow"; readonly layers: readonly ThemeShadowLayer[] } => {
    const value = field(name);
    if (value === "none") return { type: "shadow", layers: [] };
    const match = value.match(/^([^(),]+)\s+rgba\(([^()]*)\)$/);
    const geometry = match?.[1]?.trim().split(/\s+/), rgba = match?.[2]?.split(",").map(part => part.trim());
    const [x, y, blur = "0", spread = "0"] = geometry ?? [];
    const [r, g, b, alpha] = rgba ?? [];
    if (!geometry || geometry.length < 2 || geometry.length > 4 || !x || !y ||
      rgba?.length !== 4 || r === undefined || g === undefined || b === undefined || alpha === undefined) return fail(name);
    const px = (v: string, min: number) => {
      if (v === "0") return 0;
      if (!v.endsWith("px")) return fail(name);
      return number(v.slice(0, -2), name, min, 256);
    };
    return { type: "shadow", layers: [{
      unit: "px", x: px(x, -256), y: px(y, -256), blur: px(blur, 0), spread: px(spread, -256),
      color: { type: "color", space: "srgb", channels: [
        number(r, name, 0, 255, true), number(g, name, 0, 255, true), number(b, name, 0, 255, true),
      ] }, alpha: number(alpha, name, 0, 1),
    }] };
  };
  const color = (name: string) => {
    const value = field(name);
    if (!/^#[0-9a-f]{6}$/i.test(value)) return fail(name);
    return parseHexColor(value);
  };
  try {
    const palette = parsePaletteState(paletteInput);
    const mode = palette.display.appearance;
    if (mode !== "light" && mode !== "dark") return fail("palette.display.appearance");
    const declaredMode = fields.get("color-scheme");
    if (declaredMode !== undefined && declaredMode !== mode) return fail("color-scheme / palette.display.appearance");
    const settings: ThemeSettings = {
      "font-sans": families("--font-sans"), "font-mono": families("--font-mono"),
      "font-size-body": length("--fs-16"), "font-size-heading": length("--fs-32"),
      "font-weight-body": { type: "weight", value: number(field("--fw-regular"), "--fw-regular", 1, 1000, true) },
      "font-weight-heading": { type: "weight", value: number(field("--fw-semibold"), "--fw-semibold", 1, 1000, true) },
      "line-height-body": { type: "ratio", value: number(field("--lh-normal"), "--lh-normal", 1.45, 3) },
      "line-height-heading": { type: "ratio", value: number(field("--lh-snug"), "--lh-snug", 1, 3) },
      "space-1": length("--sp-1"), "space-2": length("--sp-2"), "space-3": length("--sp-3"),
      "space-4": length("--sp-4"), "space-6": length("--sp-6"),
      radius: length("--r-8"), "radius-control": length("--r-4"), "radius-pill": length("--r-pill"),
      "shadow-sm": shadow("--shadow-1"), "shadow-lg": shadow("--shadow-3"),
      "motion-fast": duration("--dur-fast"), "motion-normal": duration("--dur-base"), "motion-easing": easing(),
    };
    const theme = synthesizeTheme({
      system_id: `builtin-theme-${slug}`, default_mode: mode, palette,
      sources: { brand_anchor_id: "anchor-primary-blue", surface_scale_id: "scale-gray-50",
        status: { success: color("--success"), warning: color("--warning-yellow"),
          destructive: color("--error"), info: color("--info") } },
      settings: { light: settings, dark: settings },
    });
    const json = serializeSemanticTheme(theme), css = emitArtifactThemeCss(theme), skill = emitCanonicalThemeGuide(theme);
    const digest = canonicalDigest({ json, css, skill });
    return { slug, theme, json, css, skill, digest };
  } catch (error) {
    if (error instanceof UpgradeContractError) return fail(error.path);
    if (error instanceof ColorContractError) return fail(error.field);
    throw error;
  }
}

export type BundledCanonicalTheme = ReturnType<typeof generateThemeCanonical>;

function canonicalDigest(files: { readonly json: string; readonly css: string; readonly skill: string }): string {
  const hashes = new Map<string, string>();
  for (const [name, text] of [["theme.json", files.json], ["theme.css", files.css], ["SKILL.md", files.skill]] as const) {
    if (text.length < 2 || !text.endsWith("\n") || text.endsWith("\n\n")) {
      throw new BundledCanonicalGenerationError("canonical", name);
    }
    hashes.set(`canonical/${name}`, themeFileHash(Buffer.from(text)));
  }
  return themeAdditiveDigest(hashes, "canonical");
}

/** Append generated nonempty triples only; preserve prior authority values and ordering. */
export function extendBundledCanonicalHistory(history: BundledThemeHistory, themes: readonly BundledCanonicalTheme[]): BundledThemeHistory {
  const additive = { ...history.additive };
  const seen = new Set<string>();
  for (const theme of themes) {
    registered(theme.slug);
    if (seen.has(theme.slug) || theme.json !== serializeSemanticTheme(theme.theme) ||
      theme.css !== emitArtifactThemeCss(theme.theme) || theme.skill !== emitCanonicalThemeGuide(theme.theme) ||
      canonicalDigest(theme) !== theme.digest) {
      throw new BundledCanonicalGenerationError(theme.slug, "complete canonical digest");
    }
    seen.add(theme.slug);
    const prior = additive[theme.slug], hashes = prior?.canonical ?? [];
    additive[theme.slug] = { ...prior, canonical: hashes.includes(theme.digest) ? hashes : [...hashes, theme.digest] };
  }
  return { ...history, additive };
}

function parseHistory(input: unknown): BundledThemeHistory {
  const fail = (): never => { throw new BundledCanonicalGenerationError("history", "closed history schema"); };
  const v = decodeContract(input);
  if (!Object.hasOwn(v, "themes") || !Object.hasOwn(v, "retired") ||
    Object.keys(v).some(key => key !== "themes" && key !== "retired" && key !== "additive")) return fail();
  const hashes = (value: unknown): readonly string[] => {
    if (!Array.isArray(value) || value.length === 0) return fail();
    return Array.from(value, (hash: unknown) => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash) ? hash : fail());
  };
  const record = (value: unknown): Readonly<Record<string, readonly string[]>> => {
    if (!isRecord(value)) return fail();
    return Object.fromEntries(Object.entries(value).map(([key, entries]) => [key, hashes(entries)]));
  };
  const themes = record(v.themes), retired = record(v.retired);
  if (!Object.hasOwn(v, "additive")) return { themes, retired };
  if (!isRecord(v.additive)) return fail();
  const additive = Object.fromEntries(Object.entries(v.additive).map(([slug, entries]) => {
    if (!isRecord(entries) || Object.keys(entries).some(key => key !== "palette" && key !== "canonical")) return fail();
    return [slug, {
      ...(Object.hasOwn(entries, "palette") ? { palette: hashes(entries.palette) } : {}),
      ...(Object.hasOwn(entries, "canonical") ? { canonical: hashes(entries.canonical) } : {}),
    }];
  }));
  return { themes, retired, additive };
}

/** HEAD, not a working file or imported JSON, is the historical authority baseline. */
export async function readCommittedCanonicalHistory(repository = REPOSITORY): Promise<BundledThemeHistory> {
  const result = await exec("git", ["show", `HEAD:${HISTORY_PATH}`], {
    cwd: repository, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 10000,
    env: { ...process.env, GIT_MASTER: "1" },
  });
  return parseHistory(result.stdout);
}

function historyIdentity(history: BundledThemeHistory): string {
  const entries: [string, readonly string[]][] = [];
  for (const [key, hashes] of Object.entries(history.themes)) entries.push([`themes/${key}`, hashes]);
  for (const [key, hashes] of Object.entries(history.retired)) entries.push([`retired/${key}`, hashes]);
  for (const [slug, directories] of Object.entries(history.additive ?? {})) {
    for (const directory of ["palette", "canonical"] as const) {
      const hashes = directories[directory];
      if (hashes !== undefined) entries.push([`additive/${slug}/${directory}`, hashes]);
    }
  }
  return JSON.stringify(entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

async function readText(file: string, slug: string, field: string): Promise<string> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.nlink !== 1 || info.size > 1024 * 1024) throw new BundledCanonicalGenerationError(slug, field);
    return await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new BundledCanonicalGenerationError(slug, field);
    }
    throw error;
  }
}

async function existingCanonical(directory: string, slug: string): Promise<ReadonlyMap<string, string>> {
  try {
    if (!(await lstat(directory)).isDirectory()) throw new BundledCanonicalGenerationError(slug, "canonical directory");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return new Map();
    throw error;
  }
  const names = await readdir(directory);
  if (names.some(name => !MEMBERS.some(member => member === name)) || (names.length !== 0 && names.length !== MEMBERS.length)) {
    throw new BundledCanonicalGenerationError(slug, "canonical directory members");
  }
  const files = new Map<string, string>();
  for (const name of names.sort()) {
    const text = await readText(path.join(directory, name), slug, `canonical/${name}`);
    if (text.length === 0) throw new BundledCanonicalGenerationError(slug, `canonical/${name}`);
    files.set(name, text);
  }
  return files;
}

export async function generateBundledCanonicalPlan(
  repository = REPOSITORY,
  committed: BundledThemeHistory | undefined = undefined,
) {
  const baseline = parseHistory(committed ?? await readCommittedCanonicalHistory(repository));
  const historyFile = path.join(repository, ...HISTORY_PATH.split("/"));
  const workingText = await readText(historyFile, "history", HISTORY_PATH);
  const working = parseHistory(workingText);
  const themes: BundledCanonicalTheme[] = [], changes: PaletteFileChange[] = [];
  for (const { slug } of bundledDesignSystems) {
    const paths = bundledCanonicalPaths(repository, slug);
    const existing = await existingCanonical(paths.canonical, slug);
    const palette = await readText(paths.palette, slug, "palette/state.json");
    const source = await readText(paths.source, slug, "colors_and_type.css");
    const theme = generateThemeCanonical(slug, palette, source);
    themes.push(theme);
    if (existing.size > 0) {
      const hashes = new Map([...existing].map(([name, text]) => [`canonical/${name}`, themeFileHash(Buffer.from(text))]));
      const digest = themeAdditiveDigest(hashes, "canonical");
      const isHistorical = baseline.additive?.[slug]?.canonical?.includes(digest) ?? false;
      const isExactCandidate = digest === theme.digest && (working.additive?.[slug]?.canonical?.includes(digest) ?? false);
      if (!isHistorical && !isExactCandidate) throw new BundledCanonicalGenerationError(slug, "unowned canonical subtree");
    }
    for (const [name, after] of [["theme.json", theme.json], ["theme.css", theme.css], ["SKILL.md", theme.skill]] as const) {
      const before = existing.get(name) ?? null;
      if (before !== after) changes.push({ relative: `${paths.relative}/canonical/${name}`, before, after });
    }
  }
  const history = extendBundledCanonicalHistory(baseline, themes);
  const currentIdentity = historyIdentity(working);
  if (currentIdentity !== historyIdentity(baseline) && currentIdentity !== historyIdentity(history)) {
    throw new BundledCanonicalGenerationError("history", "uncommitted authority changes");
  }
  const after = `${JSON.stringify(history, null, 2)}\n`;
  if (workingText !== after) changes.push({ relative: HISTORY_PATH, before: workingText, after });
  return { themes, changes, history };
}

/** Reuse A's complete-file hunk/EOF encoding; never execute or apply the result. */
export function emitBundledCanonicalPatch(changes: readonly PaletteFileChange[]): string {
  return emitBundledPalettePatch(changes);
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2), mode = args[0];
    if (args.length !== 1 || (mode !== "--check" && mode !== "--patch")) {
      throw new BundledCanonicalGenerationError("CLI", "usage: bun scripts/build-theme-canonical.ts --check | --patch");
    }
    const plan = await generateBundledCanonicalPlan();
    if (mode === "--patch") process.stdout.write(emitBundledCanonicalPatch(plan.changes));
    else {
      for (const change of plan.changes) console.error(`Canonical drift: ${change.relative}`);
      console.log(`${plan.themes.length} themes; ${plan.changes.length} differences`);
      if (plan.changes.length > 0) process.exitCode = 1;
    }
  } catch (error) {
    // CLI boundary: do not print native IO/git diagnostics containing private paths.
    console.error(error instanceof BundledCanonicalGenerationError ? error.message : "Canonical input validation failed");
    process.exitCode = 1;
  }
}
