import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { MeasuredBox, MeasuredViewportLayout, MeasuredViewportName } from "@bg/shared";

export type GrayImage = { readonly width: number; readonly height: number; readonly data: Uint8Array };
export type VisualSectionScore = {
  readonly viewport: MeasuredViewportName;
  readonly section: number;
  readonly heading: string;
  /** Structural similarity of the section's band in the reference and the generated page, or null when the band is outside either image. */
  readonly ssim: number | null;
  /** Mean intersection over union of the measured section band and its hero blocks against the rendered ones. */
  readonly overlap: number;
  readonly score: number;
};
export type VisualViewportReport = { readonly viewport: MeasuredViewportName; readonly unavailable: boolean; readonly sections: readonly VisualSectionScore[] };

const GRID_WIDTH = 180;
const WINDOW = 8;
const MIN_BAND_PX = 8;
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export async function decodeGrayImage(bytes: Uint8Array): Promise<GrayImage> {
  const image = await loadImage(Buffer.from(bytes));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, image.width, image.height).data;
  const data = new Uint8Array(image.width * image.height);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.round(0.299 * rgba[index * 4]! + 0.587 * rgba[index * 4 + 1]! + 0.114 * rgba[index * 4 + 2]!);
  return { width: image.width, height: image.height, data };
}

/** Area-averages the rows [top, bottom) of an image onto an outWidth x outHeight grid. */
function resampleBand(image: GrayImage, top: number, bottom: number, outWidth: number, outHeight: number): Float64Array {
  const out = new Float64Array(outWidth * outHeight);
  const scaleX = image.width / outWidth;
  const scaleY = (bottom - top) / outHeight;
  for (let oy = 0; oy < outHeight; oy += 1) {
    const y0 = top + Math.floor(oy * scaleY);
    const y1 = Math.max(y0 + 1, top + Math.floor((oy + 1) * scaleY));
    for (let ox = 0; ox < outWidth; ox += 1) {
      const x0 = Math.floor(ox * scaleX);
      const x1 = Math.max(x0 + 1, Math.floor((ox + 1) * scaleX));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1 && y < bottom; y += 1) for (let x = x0; x < x1 && x < image.width; x += 1) { sum += image.data[y * image.width + x]!; count += 1; }
      out[oy * outWidth + ox] = count === 0 ? 0 : sum / count;
    }
  }
  return out;
}

/** Mean SSIM over non-overlapping windows of the band [top, bottom), clamped to the height both images share. */
export function ssimBand(a: GrayImage, b: GrayImage, top: number, bottom: number): number | null {
  const end = Math.min(bottom, a.height, b.height);
  const start = Math.max(0, top);
  if (a.width !== b.width || end - start < MIN_BAND_PX) return null;
  const outWidth = Math.min(GRID_WIDTH, a.width);
  const outHeight = Math.max(WINDOW, Math.round((end - start) * outWidth / a.width));
  const left = resampleBand(a, start, end, outWidth, outHeight);
  const right = resampleBand(b, start, end, outWidth, outHeight);
  let total = 0;
  let windows = 0;
  for (let wy = 0; wy + WINDOW <= outHeight; wy += WINDOW) {
    for (let wx = 0; wx + WINDOW <= outWidth; wx += WINDOW) {
      let meanA = 0;
      let meanB = 0;
      for (let y = 0; y < WINDOW; y += 1) for (let x = 0; x < WINDOW; x += 1) { meanA += left[(wy + y) * outWidth + wx + x]!; meanB += right[(wy + y) * outWidth + wx + x]!; }
      meanA /= WINDOW * WINDOW;
      meanB /= WINDOW * WINDOW;
      let varA = 0;
      let varB = 0;
      let cov = 0;
      for (let y = 0; y < WINDOW; y += 1) for (let x = 0; x < WINDOW; x += 1) {
        const da = left[(wy + y) * outWidth + wx + x]! - meanA;
        const db = right[(wy + y) * outWidth + wx + x]! - meanB;
        varA += da * da; varB += db * db; cov += da * db;
      }
      const n = WINDOW * WINDOW - 1;
      varA /= n; varB /= n; cov /= n;
      total += ((2 * meanA * meanB + C1) * (2 * cov + C2)) / ((meanA * meanA + meanB * meanB + C1) * (varA + varB + C2));
      windows += 1;
    }
  }
  return windows === 0 ? null : total / windows;
}

function boxIou(a: MeasuredBox, b: MeasuredBox): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  const inter = width * height;
  return inter / (a.width * a.height + b.width * b.height - inter);
}

/** Per measured section: the mean IoU of its vertical band and of the hero blocks that sit inside it, against the rendered page. */
export function sectionOverlap(expected: MeasuredViewportLayout, actual: MeasuredViewportLayout): { readonly section: number; readonly overlap: number }[] {
  return expected.sections.map((section, index) => {
    const rendered = actual.sections[index];
    const inter = rendered === undefined ? 0 : Math.min(section.top + section.height, rendered.top + rendered.height) - Math.max(section.top, rendered.top);
    const union = rendered === undefined ? 1 : section.height + rendered.height - Math.max(0, inter);
    const parts = [rendered === undefined || inter <= 0 ? 0 : inter / union];
    for (const [name, box] of Object.entries(expected.blocks)) {
      const centre = box.y + box.height / 2;
      if (centre < section.top || centre >= section.top + section.height) continue;
      const got = actual.blocks[name as keyof typeof actual.blocks];
      parts.push(got === undefined ? 0 : boxIou(box, got));
    }
    return { section: index, overlap: parts.reduce((sum, part) => sum + part, 0) / parts.length };
  });
}

/** Scores every measured section of one viewport against its reference screenshot; report-only, never throws on bad images. */
export async function compareVisualViewport(input: {
  readonly viewport: MeasuredViewportName; readonly reference: Uint8Array; readonly generated: Uint8Array;
  readonly expected: MeasuredViewportLayout; readonly actual: MeasuredViewportLayout;
}): Promise<VisualViewportReport> {
  let reference: GrayImage;
  let generated: GrayImage;
  try {
    [reference, generated] = await Promise.all([decodeGrayImage(input.reference), decodeGrayImage(input.generated)]);
  } catch {
    return { viewport: input.viewport, unavailable: true, sections: [] };
  }
  const overlaps = sectionOverlap(input.expected, input.actual);
  return {
    viewport: input.viewport, unavailable: false,
    sections: input.expected.sections.map((section, index) => {
      const ssim = ssimBand(reference, generated, section.top, section.top + section.height);
      const overlap = overlaps[index]!.overlap;
      const score = ssim === null ? overlap : 0.5 * Math.min(1, Math.max(0, ssim)) + 0.5 * overlap;
      return { viewport: input.viewport, section: index, heading: section.heading, ssim: ssim === null ? null : round3(ssim), overlap: round3(overlap), score: round3(score) };
    }),
  };
}

/** The lowest-scoring sections across viewports: where a repair should look first. */
export function visualRepairTargets(reports: readonly VisualViewportReport[], count: number): VisualSectionScore[] {
  return reports.flatMap((report) => report.sections)
    .sort((a, b) => a.score - b.score || a.viewport.localeCompare(b.viewport) || a.section - b.section)
    .slice(0, count);
}
