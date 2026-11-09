/**
 * Construction draw-in GIF export for geometric logo projects (doc/36-logo-construction-gif-2026-11-09.md).
 *
 * The frames are the app's own draw-in: `renderLogoConstruction` sampled at a fixed frame step over
 * its timeline, rasterised with the bundled canvas and mapped onto one fixed 256-colour table built
 * from the light construction palette. The last frame is held, then the loop restarts. Frame count,
 * pixel size and file size are all bounded, so no record can make an unbounded file.
 */
import { readFile, writeFile } from "node:fs/promises";
import {
  compileLogoGeometry,
  LOGO_GEOMETRY_FILE,
  LogoGeometryError,
  logoConstructionPalette,
  logoConstructionTimeline,
  parseLogoGeometryV1,
  renderLogoConstruction,
  type LogoGeometryCompiled,
  type LogoGeometryV1,
} from "@bg/shared";
import { resolveWithin } from "../security/path-boundary";
import { LogoConstructionExportError } from "./export-construction";
import type { GifValidation } from "./export-receipt-validation";
import { encodeGif, type GifFrame } from "./gif-encoder";

export const LOGO_CONSTRUCTION_GIF = {
  /** Width and height in pixels. */
  size: 480,
  /** One frame per 100 ms of the draw-in (10 fps). */
  frameMs: 100,
  /** The finished drawing stays this long before the loop restarts. */
  holdMs: 2000,
  maxFrames: 120,
  maxBytes: 8 * 1024 * 1024,
} as const;

/** The draw-in positions sampled for a timeline of `durationMs`: 0 first, 1 last, evenly spaced. */
export function logoConstructionGifTimes(durationMs: number): readonly number[] {
  const steps = Math.min(LOGO_CONSTRUCTION_GIF.maxFrames - 1, Math.max(1, Math.ceil(durationMs / LOGO_CONSTRUCTION_GIF.frameMs)));
  return Array.from({ length: steps + 1 }, (_, index) => index / steps);
}

/**
 * The fixed colour table, 256 entries in five ramps: paper to ink, line and accent (64 steps each),
 * then ink to line and ink to accent (32 each), so every anti-aliased edge between two drawing
 * colours has a close entry. Index 0 is the paper.
 */
export function logoConstructionGifPalette(): Uint8Array {
  const { paper, ink, line, accent } = logoConstructionPalette("light");
  const ramps: readonly (readonly [string, string, number])[] = [[paper, ink, 64], [paper, line, 64], [paper, accent, 64], [ink, line, 32], [ink, accent, 32]];
  const palette = new Uint8Array(256 * 3);
  let index = 0;
  for (const [from, to, steps] of ramps) {
    for (let step = 0; step < steps; step += 1, index += 1) palette.set(mix(rgb(from), rgb(to), step / (steps - 1)), index * 3);
  }
  return palette;
}

export async function renderLogoConstructionGif(input: {
  readonly stagedDir: string;
  readonly entrypointDir: string;
  readonly outputPath: string;
  /** The accessible name of each frame's drawing; the same name the symbol step gives the mark. */
  readonly label: string;
}): Promise<GifValidation> {
  const relativeDir = input.entrypointDir === "" || input.entrypointDir === "." ? [] : [input.entrypointDir];
  let source: string;
  try {
    source = await readFile(resolveWithin(input.stagedDir, ...relativeDir, LOGO_GEOMETRY_FILE), "utf8");
  } catch (error) {
    if (!(error instanceof Error && Reflect.get(error, "code") === "ENOENT")) throw error;
    throw new LogoConstructionExportError("construction_missing", LOGO_GEOMETRY_FILE);
  }
  let geometry: LogoGeometryV1;
  let compiled: LogoGeometryCompiled;
  try {
    geometry = parseLogoGeometryV1(source.replace(/^\uFEFF/, "")).geometry;
    compiled = compileLogoGeometry(geometry);
  } catch (error) {
    if (!(error instanceof LogoGeometryError)) throw error;
    throw new LogoConstructionExportError("construction_invalid", error.code);
  }
  const { createCanvas, loadImage } = await import("./export-native-modules");
  const { size, frameMs, holdMs, maxBytes } = LOGO_CONSTRUCTION_GIF;
  const palette = logoConstructionGifPalette();
  const nearest = paletteMatcher(palette);
  const timeline = logoConstructionTimeline(geometry, compiled);
  const times = logoConstructionGifTimes(timeline.duration_ms);
  const delayCs = Math.max(1, Math.round(timeline.duration_ms / (times.length - 1) / 10)) || frameMs / 10;
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  const frames: GifFrame[] = [];
  for (const [index, t] of times.entries()) {
    // A viewBox-only SVG rasterises at its intrinsic size, so the copy handed to the rasteriser
    // carries the target pixel size.
    const svg = renderLogoConstruction(geometry, compiled, t, { theme: "light", label: input.label })
      .replace("<svg ", `<svg width="${size}" height="${size}" `);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    context.drawImage(await loadImage(Buffer.from(svg)), 0, 0, size, size);
    const { data } = context.getImageData(0, 0, size, size);
    const indices = new Uint8Array(size * size);
    for (let pixel = 0; pixel < indices.length; pixel += 1) indices[pixel] = nearest(data[pixel * 4], data[pixel * 4 + 1], data[pixel * 4 + 2]);
    frames.push({ indices, delayCs: index === times.length - 1 ? holdMs / 10 : delayCs });
  }
  const bytes = encodeGif({ width: size, height: size, palette, frames });
  if (bytes.byteLength > maxBytes) throw new LogoConstructionExportError("construction_too_large", String(bytes.byteLength));
  await writeFile(input.outputPath, bytes);
  return { frames: frames.length, width: size, height: size, bytes: bytes.byteLength };
}

function rgb(hex: string): readonly [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
}

function mix(a: readonly number[], b: readonly number[], amount: number): number[] {
  return [0, 1, 2].map((channel) => Math.round(a[channel] + (b[channel] - a[channel]) * amount));
}

/** Nearest table entry by squared RGB distance, remembered per colour (frames repeat few colours). */
function paletteMatcher(palette: Uint8Array): (r: number, g: number, b: number) => number {
  const memo = new Map<number, number>();
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < 256; index += 1) {
      const dr = palette[index * 3] - r;
      const dg = palette[index * 3 + 1] - g;
      const db = palette[index * 3 + 2] - b;
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    memo.set(key, best);
    return best;
  };
}
