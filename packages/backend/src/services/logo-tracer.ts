/**
 * Modified TypeScript adaptation of the vtracer/visioncortex tracing approach.
 * Copyright (c) 2024, 2026 TSANG, Hao Fung.
 * vtracer: MIT; visioncortex: Apache-2.0 (upstream also offers MIT).
 * Changes: bounded palette fitting and edge graph instead of hierarchical
 * clustering; iterative polygon reduction; optional local quadratic smoothing.
 * Full MIT terms and Apache attribution: THIRD_PARTY_NOTICES.md and NOTICE.
 * Apache License, Version 2.0: root LICENSE. No upstream NOTICE was present.
 */
import { LOGO_SOURCE_ATTRIBUTE } from "@bg/shared";
import { validateLogoSvg } from "./logo-svg-validation";
import { checkpoint, LogoTraceError, traceColor } from "./logo-tracer-path";
export { LogoTraceError } from "./logo-tracer-path";

type Color = readonly [number, number, number];
type Bin = { readonly color: Color; readonly count: number; readonly key: number };

export type LogoTraceOptions = {
  readonly source: string;
  readonly mode?: "color" | "binary";
  readonly curve?: "polygon" | "spline";
  readonly colors?: number;
  readonly threshold?: number;
  readonly speckle?: number;
  readonly tolerance?: number;
  readonly signal?: AbortSignal;
};

const MAX_PIXELS = 4 * 1024 * 1024;
const MAX_BYTES = 1024 * 1024;
const colorDistance = (a: Color, b: Color): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const colorKey = (data: Uint8ClampedArray, i: number): number =>
  ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);

function fitPalette(bins: readonly Bin[], count: number): Color[] {
  if (bins.length === 0) return [];
  const sorted = [...bins].sort((a, b) => b.count - a.count || a.key - b.key);
  const palette: Color[] = [sorted[0].color];
  while (palette.length < count) {
    let best: Bin | undefined, score = 0;
    for (const bin of sorted) {
      const distance = Math.min(...palette.map(color => colorDistance(color, bin.color)));
      const candidate = distance * bin.count;
      if (distance > 144 && candidate > score) { best = bin; score = candidate; }
    }
    if (!best) break;
    palette.push(best.color);
  }
  for (let iteration = 0; iteration < 6; iteration++) {
    const sums = palette.map(() => [0, 0, 0, 0]);
    for (const bin of bins) {
      const sum = sums[nearest(bin.color, palette)];
      for (let c = 0; c < 3; c++) sum[c] += bin.color[c] * bin.count;
      sum[3] += bin.count;
    }
    for (let i = 0; i < palette.length; i++) {
      const sum = sums[i];
      if (sum[3]) palette[i] = [Math.round(sum[0] / sum[3]), Math.round(sum[1] / sum[3]), Math.round(sum[2] / sum[3])];
    }
  }
  const distinct: Color[] = [];
  for (const color of palette) {
    if (!distinct.some(other => colorDistance(color, other) <= 3 * 16 ** 2)) distinct.push(color);
  }
  return distinct;
}

function nearest(color: Color, palette: readonly Color[]): number {
  let best = 0, distance = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const candidate = colorDistance(color, palette[i]);
    if (candidate < distance) { distance = candidate; best = i; }
  }
  return best;
}

async function labelPixels(data: Uint8ClampedArray, width: number, height: number, options: LogoTraceOptions): Promise<{ labels: Uint8Array; palette: Color[] }> {
  const labels = new Uint8Array(width * height);
  if (options.mode === "binary") {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x, i = p * 4;
        if (data[i + 3] >= 128 && (299 * data[i] + 587 * data[i + 1] + 114 * data[i + 2]) / 1000 < (options.threshold ?? 128)) labels[p] = 1;
      }
      if (y % 128 === 0) await checkpoint(options.signal);
    }
    return { labels, palette: [[0, 0, 0]] };
  }
  const histogram = new Map<number, number[]>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;
      const key = colorKey(data, i);
      let bin = histogram.get(key);
      if (!bin) { bin = [0, 0, 0, 0]; histogram.set(key, bin); }
      bin[0] += data[i]; bin[1] += data[i + 1]; bin[2] += data[i + 2]; bin[3]++;
    }
    if (y % 128 === 0) await checkpoint(options.signal);
  }
  const bins: Bin[] = [...histogram].map(([key, sum]) => ({
    key, count: sum[3], color: [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]],
  }));
  const palette = fitPalette(bins, options.colors ?? 8);
  const lookup = new Uint8Array(32768);
  for (const bin of bins) lookup[bin.key] = nearest(bin.color, palette) + 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x, i = p * 4;
      if (data[i + 3] >= 128) labels[p] = lookup[colorKey(data, i)];
    }
    if (y % 128 === 0) await checkpoint(options.signal);
  }
  return { labels, palette };
}

async function mergeSpeckles(labels: Uint8Array, width: number, height: number, minimum: number, palette: readonly Color[], signal?: AbortSignal): Promise<void> {
  if (minimum === 0) return;
  const visited = new Uint8Array(labels.length), queue = new Int32Array(labels.length);
  for (let start = 0; start < labels.length; start++) {
    if (start % 65536 === 0) await checkpoint(signal);
    if (visited[start] || labels[start] === 0) continue;
    const label = labels[start], neighbors = new Map<number, number>();
    let head = 0, tail = 1;
    queue[0] = start; visited[start] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      for (const q of [x > 0 ? p - 1 : -1, x + 1 < width ? p + 1 : -1, y > 0 ? p - width : -1, y + 1 < height ? p + width : -1]) {
        if (q < 0) continue;
        if (labels[q] !== label) { neighbors.set(labels[q], (neighbors.get(labels[q]) ?? 0) + 1); continue; }
        if (!visited[q]) { visited[q] = 1; queue[tail++] = q; }
      }
      if (head % 65536 === 0) await checkpoint(signal);
    }
    if (tail >= minimum) continue;
    let target = label, best = Infinity;
    for (const [candidate, border] of neighbors) {
      const distance = candidate === 0 ? 3 * 255 ** 2 : colorDistance(palette[label - 1], palette[candidate - 1]);
      const score = distance + 1 / border;
      if (score < best) { best = score; target = candidate; }
    }
    for (let i = 0; i < tail; i++) labels[queue[i]] = target;
  }
}


/** Traces native-size RGBA pixels; zero labels represent transparency, not a paint color. */
export async function traceLogoPixels(data: Uint8ClampedArray, width: number, height: number, options: LogoTraceOptions): Promise<string> {
  options.signal?.throwIfAborted();
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length !== width * height * 4
    || !/^explorations\/round-\d{1,2}\/candidate-[1-4]\.png$/.test(options.source)
    || !Number.isInteger(options.colors ?? 8) || (options.colors ?? 8) < 1 || (options.colors ?? 8) > 8
    || !Number.isFinite(options.tolerance ?? 0.75) || (options.tolerance ?? 0.75) < 0 || (options.tolerance ?? 0.75) > 16
    || !Number.isInteger(options.speckle ?? 4) || (options.speckle ?? 4) < 0 || (options.speckle ?? 4) > 128
    || !Number.isInteger(options.threshold ?? 128) || (options.threshold ?? 128) < 0 || (options.threshold ?? 128) > 255) throw new LogoTraceError("input");
  if (width * height > MAX_PIXELS) throw new LogoTraceError("budget");
  const { labels, palette } = await labelPixels(data, width, height, options);
  await mergeSpeckles(labels, width, height, options.speckle ?? 4, palette, options.signal);
  const areas = new Uint32Array(palette.length);
  let opaque = true;
  for (const label of labels) {
    if (label === 0) { opaque = false; break; }
    areas[label - 1]++;
  }
  const background = opaque && palette.length ? areas.indexOf(Math.max(...areas)) : -1;
  const order = palette.map((_, i) => i);
  if (background >= 0) { order.splice(order.indexOf(background), 1); order.unshift(background); }
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ${LOGO_SOURCE_ATTRIBUTE}="${options.source}">`;
  let paths = 0;
  for (const i of order) {
    const d = i === background ? `M0 0H${width}V${height}H0Z` : await traceColor(labels, width, height, i + 1, options);
    if (!d) continue;
    const hex = palette[i].map(c => c.toString(16).padStart(2, "0")).join("");
    svg += `<path fill="#${hex}" fill-rule="evenodd" d="${d}"/>`;
    if (svg.length > MAX_BYTES - 6) throw new LogoTraceError("budget");
    paths++;
  }
  if (!paths) throw new LogoTraceError("empty");
  svg += "</svg>";
  validateLogoSvg(svg);
  return svg;
}
