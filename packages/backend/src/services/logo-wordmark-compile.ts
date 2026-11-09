/**
 * Sets a wordmark record (`@bg/shared/logo-wordmark`) in one of the bundled OFL fonts. The glyph
 * outlines come from the font itself through `fontkit`, already a dependency for font validation,
 * so nothing new ships. The cap height and the tracking are exact. The stem is measured, not forced:
 * each font is set at its default weight, and `stem_measured` says how far its capital-I stem sits
 * from the asked stem, so the review can name a mismatch. (fontkit 2.0.4 cannot instance a WOFF2
 * variable font that has composite glyphs, so weights other than the default are not offered yet.)
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  LogoWordmarkError,
  type LogoWordmarkCompiled,
  type LogoWordmarkV1,
} from "@bg/shared/logo-wordmark";
import type { Font, Glyph } from "fontkit";
import { resolveRepoRoot } from "../lib/paths";

type ManifestFamily = { readonly family: string; readonly file: string; readonly weight: string; readonly category: string };

/** Scripts have no flat stems or capitals to measure, so they cannot carry the symbol's module. */
const SET_CATEGORIES = new Set(["sans-serif", "serif", "display", "monospace"]);
/** Line pieces per curve when a stem is measured. */
const FLATTEN = 32;
/** Kerning stays on; letter substitutions do not, so every character keeps its own glyph. */
const FEATURES = { liga: false, clig: false, dlig: false, calt: false, rlig: false };

const fixed = (value: number): number => {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
};

async function manifestFamily(family: string, repoRoot: string): Promise<ManifestFamily> {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, "assets/fonts/manifest.json"), "utf8")) as { families: readonly ManifestFamily[] };
  const entry = manifest.families.find((candidate) => candidate.family === family);
  if (entry === undefined || !SET_CATEGORIES.has(entry.category)) throw new LogoWordmarkError("font_unknown", "$.font");
  return entry;
}

async function openFont(file: string, repoRoot: string): Promise<Font> {
  const { create } = await import("fontkit");
  const font = create(await readFile(path.join(repoRoot, "assets/fonts", path.basename(file))));
  if (!("glyphForCodePoint" in font)) throw new LogoWordmarkError("font_unknown", "$.font");
  return font;
}

/** Width of the first filled run crossing the glyph at height `y`, in font units. */
function runWidth(glyph: Glyph, y: number): number {
  const crossings: number[] = [];
  let start = { x: 0, y: 0 };
  let at = { x: 0, y: 0 };
  const segment = (to: { x: number; y: number }): void => {
    if ((at.y <= y && to.y > y) || (to.y <= y && at.y > y)) crossings.push(at.x + ((y - at.y) / (to.y - at.y)) * (to.x - at.x));
    at = to;
  };
  for (const { command, args } of glyph.path.commands) {
    const a = args;
    if (command === "moveTo") {
      start = { x: a[0]!, y: a[1]! };
      at = start;
    } else if (command === "lineTo") {
      segment({ x: a[0]!, y: a[1]! });
    } else if (command === "quadraticCurveTo" || command === "bezierCurveTo") {
      const from = at;
      for (let step = 1; step <= FLATTEN; step += 1) {
        const t = step / FLATTEN;
        const u = 1 - t;
        segment(command === "quadraticCurveTo"
          ? { x: u * u * from.x + 2 * u * t * a[0]! + t * t * a[2]!, y: u * u * from.y + 2 * u * t * a[1]! + t * t * a[3]! }
          : {
            x: u * u * u * from.x + 3 * u * u * t * a[0]! + 3 * u * t * t * a[2]! + t * t * t * a[4]!,
            y: u * u * u * from.y + 3 * u * u * t * a[1]! + 3 * u * t * t * a[3]! + t * t * t * a[5]!,
          });
      }
    } else if (command === "closePath") {
      segment(start);
    }
  }
  crossings.sort((p, q) => p - q);
  return crossings.length >= 2 ? crossings[1]! - crossings[0]! : 0;
}

/** Cap height and capital-I stem of one font instance, both in font units. */
function measure(font: Font): { cap: number; stem: number } {
  const cap = font.glyphForCodePoint(0x48).bbox.maxY;
  return { cap, stem: runWidth(font.glyphForCodePoint(0x49), cap / 2) };
}

function pathOf(glyph: Glyph, x: number, baseline: number, scale: number): string {
  const point = (px: number, py: number): string => `${fixed(x + px * scale)} ${fixed(baseline - py * scale)}`;
  const parts: string[] = [];
  for (const { command, args: a } of glyph.path.commands) {
    if (command === "moveTo") parts.push(`M${point(a[0]!, a[1]!)}`);
    else if (command === "lineTo") parts.push(`L${point(a[0]!, a[1]!)}`);
    else if (command === "quadraticCurveTo") parts.push(`Q${point(a[0]!, a[1]!)} ${point(a[2]!, a[3]!)}`);
    else if (command === "bezierCurveTo") parts.push(`C${point(a[0]!, a[1]!)} ${point(a[2]!, a[3]!)} ${point(a[4]!, a[5]!)}`);
    else if (command === "closePath") parts.push("Z");
  }
  return parts.join("");
}

/**
 * Sets the record. Refuses with `font_unknown` when the family is not in the bundle or is a script.
 * Coverage of the wordmark characters is a property of the bundle, checked by its test.
 */
export async function compileLogoWordmark(wordmark: LogoWordmarkV1, repoRoot = resolveRepoRoot()): Promise<LogoWordmarkCompiled> {
  const entry = await manifestFamily(wordmark.font, repoRoot);
  const font = await openFont(entry.file, repoRoot);
  const weight = font.variationAxes["wght"]?.default ?? null;
  const { cap, stem } = measure(font);
  const scale = wordmark.cap_height / cap;
  const baseline = wordmark.cap_height;
  const run = font.layout(wordmark.text, FEATURES);
  let x = 0;
  const parts: string[] = [];
  const glyphs: { x: number; advance: number }[] = [];
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  run.glyphs.forEach((glyph, index) => {
    const position = run.positions[index]!;
    const gx = x + position.xOffset * scale;
    const lift = position.yOffset;
    const advance = position.xAdvance * scale;
    if (glyph.path.commands.length > 0) {
      parts.push(pathOf(glyph, gx, baseline - lift * scale, scale));
      box.minX = Math.min(box.minX, gx + glyph.bbox.minX * scale);
      box.maxX = Math.max(box.maxX, gx + glyph.bbox.maxX * scale);
      box.minY = Math.min(box.minY, baseline - (glyph.bbox.maxY + lift) * scale);
      box.maxY = Math.max(box.maxY, baseline - (glyph.bbox.minY + lift) * scale);
    }
    glyphs.push({ x: fixed(x), advance: fixed(advance) });
    x += advance + (index < run.glyphs.length - 1 ? wordmark.tracking : 0);
  });
  return {
    path: parts.join(""),
    width: fixed(x),
    bounds: { minX: fixed(box.minX), minY: fixed(box.minY), maxX: fixed(box.maxX), maxY: fixed(box.maxY) },
    metrics: {
      cap_height: wordmark.cap_height,
      baseline,
      x_height: fixed(font.glyphForCodePoint(0x78).bbox.maxY * scale),
      ascender: fixed(font.ascent * scale),
      descender: fixed(-font.descent * scale),
      stem: wordmark.stem,
      tracking: wordmark.tracking,
    },
    font: { family: entry.family, file: entry.file, weight },
    stem_measured: fixed(stem * scale),
    glyphs,
  };
}
