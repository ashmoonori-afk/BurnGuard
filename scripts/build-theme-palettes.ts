#!/usr/bin/env bun
/**
 * Read-only deterministic producer for the registered themes' owned palette pairs.
 * Check: bun scripts/build-theme-palettes.ts --check
 * Patch: bun scripts/build-theme-palettes.ts --patch | git apply
 * Source state.json bytes are serializePalette(state) plus exactly one terminal LF.
 * Neither mode writes files. Legacy CSS, fonts, surfaces and canonical/ are never output.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseHexColor, relativeLuminance, rgbToOklch } from "../packages/shared/src/color";
import {
  createDefaultPalette, emitPaletteCss, PALETTE_DERIVED_DIGITS, parsePaletteState, serializePalette, type PaletteState,
} from "../packages/shared/src/palette";
import { bundledDesignSystems } from "../packages/backend/src/data/bundled-design-systems";
import {
  bundledThemeHistory, themeAdditiveDigest, themeFileHash, type BundledThemeHistory,
} from "../packages/backend/src/services/bundled-theme-refresh";

const REPOSITORY = path.resolve(import.meta.dir, "..");
const HISTORY_PATH = "packages/backend/src/data/bundled-theme-history.json";
const SCALE_ROLES = ["primary-blue", "secondary", "accent", "gray-50"] as const;
const ANCHOR_ROLES = [...SCALE_ROLES, "success", "warning-yellow", "error", "bg", "fg-1"] as const;

export class BundledPaletteGenerationError extends Error {
  readonly code = "bundled_palette_generation";
  constructor(readonly slug: string, readonly field: string) {
    super(`${slug}: unresolved or ambiguous ${field}`);
  }
}

/** Native paths are only for IO; all hash and patch identities use forward slashes. */
export function bundledPalettePaths(repository: string, slug: string, flavor: typeof path = path) {
  if (!bundledDesignSystems.some(theme => theme.slug === slug)) {
    throw new BundledPaletteGenerationError(slug, "registered slug");
  }
  const relative = `design system themes/${slug}`;
  return {
    relative,
    directory: flavor.join(repository, "design system themes", slug),
    source: flavor.join(repository, "design system themes", slug, "colors_and_type.css"),
    state: flavor.join(repository, "design system themes", slug, "palette", "state.json"),
    css: flavor.join(repository, "design system themes", slug, "palette", "scales.css"),
  };
}

/** Production CSS is the input, never the frozen QA corpus or a generic hue preset. */
export function generateThemePalette(slug: string, css: string): PaletteState {
  if (!bundledDesignSystems.some(theme => theme.slug === slug)) {
    throw new BundledPaletteGenerationError(slug, "registered slug");
  }
  const roots = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/:root\s*\{([^}]*)\}/g)];
  if (roots.length === 0) throw new BundledPaletteGenerationError(slug, ":root");
  const body = roots.map(root => root[1]).join("\n");
  const color = (role: typeof ANCHOR_ROLES[number]) => {
    const declarations = [...body.matchAll(new RegExp(`--${role}\\s*:\\s*([^;]+);`, "g"))];
    const value = declarations[0]?.[1]?.trim();
    if (declarations.length !== 1 || value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) {
      throw new BundledPaletteGenerationError(slug, `--${role} in colors_and_type.css`);
    }
    return parseHexColor(value);
  };
  const anchors = ANCHOR_ROLES.map(role => ({ id: `anchor-${role}`, name: `--${role}`, color: color(role) }));
  const colors = SCALE_ROLES.map(role => ({ role, oklch: rgbToOklch(color(role)) }));
  const defaults = createDefaultPalette();
  return parsePaletteState({
    ...defaults,
    scales: colors.map(({ role, oklch }) => oklch.c === 0
      ? { id: `scale-${role}`, name: `--${role}`, kind: "neutral" }
      : { id: `scale-${role}`, name: `--${role}`, kind: "hue", hue: Number(oklch.h.toFixed(PALETTE_DERIVED_DIGITS)) % 360 }),
    anchors,
    // Shared chroma preserves the existing engine invariant. Exact tinted neutrals
    // and all semantic fills remain separately available as unmodified RGB anchors.
    curve: { ...defaults.curve, amount: Number(Math.max(...colors.map(({ oklch }) => oklch.c)).toFixed(PALETTE_DERIVED_DIGITS)) },
    display: {
      ...defaults.display,
      appearance: relativeLuminance(color("bg")) < relativeLuminance(color("fg-1")) ? "dark" : "light",
    },
  });
}

export type BundledPalettePair = {
  readonly slug: string;
  readonly state: PaletteState;
  readonly json: string;
  readonly css: string;
  readonly digest: string;
};

export function generateThemePalettePair(slug: string, source: string): BundledPalettePair {
  const state = generateThemePalette(slug, source);
  const json = `${serializePalette(state)}\n`, css = emitPaletteCss(state);
  const files = new Map([
    ["palette/state.json", themeFileHash(Buffer.from(json))],
    ["palette/scales.css", themeFileHash(Buffer.from(css))],
  ]);
  return { slug, state, json, css, digest: themeAdditiveDigest(files, "palette") };
}

/** Retain every prior authority value; authorize only complete, nonempty palette pairs. */
export function extendBundledPaletteHistory(history: BundledThemeHistory, pairs: readonly BundledPalettePair[]): BundledThemeHistory {
  const additive = { ...history.additive };
  for (const pair of pairs) {
    const prior = additive[pair.slug];
    additive[pair.slug] = {
      ...prior,
      palette: [...new Set([...(prior?.palette ?? []), pair.digest])].sort(),
    };
  }
  return { ...history, additive };
}

export type PaletteFileChange = {
  readonly relative: string;
  readonly before: string | null;
  readonly after: string;
};

async function readOptional(file: string): Promise<string | null> {
  try { return await readFile(file, "utf8"); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function generateBundledPalettePlan(repository = REPOSITORY, history: BundledThemeHistory = bundledThemeHistory) {
  const pairs: BundledPalettePair[] = [];
  const changes: PaletteFileChange[] = [];
  const compare = async (relative: string, after: string): Promise<void> => {
    const before = await readOptional(path.join(repository, ...relative.split("/")));
    if (before !== after) changes.push({ relative, before, after });
  };
  for (const { slug } of bundledDesignSystems) {
    const paths = bundledPalettePaths(repository, slug);
    // Refuse unknown palette members rather than deleting or granting them authority.
    let members: string[];
    try { members = await readdir(path.join(paths.directory, "palette")); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") members = [];
      else throw error;
    }
    if (members.some(name => name !== "state.json" && name !== "scales.css")) {
      throw new BundledPaletteGenerationError(slug, "palette directory members");
    }
    const source = await readOptional(paths.source);
    if (source === null) throw new BundledPaletteGenerationError(slug, "colors_and_type.css");
    const pair = generateThemePalettePair(slug, source);
    pairs.push(pair);
    await compare(`${paths.relative}/palette/state.json`, pair.json);
    await compare(`${paths.relative}/palette/scales.css`, pair.css);
  }
  const nextHistory = extendBundledPaletteHistory(history, pairs);
  await compare(HISTORY_PATH, `${JSON.stringify(nextHistory, null, 2)}\n`);
  return {
    pairs, changes, history: nextHistory,
    bytes: pairs.reduce((sum, pair) => sum + Buffer.byteLength(pair.json) + Buffer.byteLength(pair.css), 0),
  };
}

/** Complete-file unified hunks need no diff dependency and preserve exact EOF bytes. */
export function emitBundledPalettePatch(changes: readonly PaletteFileChange[]): string {
  const lines = (text: string, prefix: string): string => {
    if (text === "") return "";
    const terminated = text.endsWith("\n");
    const body = (terminated ? text.slice(0, -1) : text).split("\n");
    return body.map(line => `${prefix}${line}\n`).join("") +
      (terminated ? "" : "\\ No newline at end of file\n");
  };
  const count = (text: string): number => text === "" ? 0 : text.split("\n").length - Number(text.endsWith("\n"));
  return changes.map(({ relative, before, after }) => {
    const oldName = JSON.stringify(`a/${relative}`), newName = JSON.stringify(`b/${relative}`);
    const oldCount = count(before ?? ""), newCount = count(after);
    return `diff --git ${oldName} ${newName}\n` +
      (before === null ? "new file mode 100644\n" : "") +
      `--- ${before === null ? "/dev/null" : oldName}\n+++ ${newName}\n` +
      `@@ -${oldCount === 0 ? 0 : 1},${oldCount} +${newCount === 0 ? 0 : 1},${newCount} @@\n` +
      (before === null ? "" : lines(before, "-")) + lines(after, "+");
  }).join("");
}

if (import.meta.main) {
  const mode = process.argv.slice(2);
  if (mode.length !== 1 || (mode[0] !== "--check" && mode[0] !== "--patch")) {
    throw new Error("Usage: bun scripts/build-theme-palettes.ts --check | --patch");
  }
  const plan = await generateBundledPalettePlan();
  if (mode[0] === "--patch") process.stdout.write(emitBundledPalettePatch(plan.changes));
  else {
    for (const change of plan.changes) console.error(`Palette drift: ${change.relative}`);
    console.log(`${plan.pairs.length} pairs, ${plan.pairs.length * 2} palette files, ${plan.bytes} bytes; ${plan.changes.length} differences`);
    if (plan.changes.length !== 0) process.exitCode = 1;
  }
}
