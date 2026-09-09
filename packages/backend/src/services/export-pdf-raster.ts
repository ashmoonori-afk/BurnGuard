import { createCanvas } from "./export-native-modules";
import { isPdfSingleEdgeClipped, pdfRasterBudgetFits, pdfRasterDimensions, PDF_MAX_PAGE_PIXELS, PDF_RASTER_SCALE } from "./export-pdf-contract";

export type PdfContentBounds = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
export type PdfPixelStatistics = {
  readonly pixels: number;
  readonly visible_pixels: number;
  readonly painted_pixels: number;
  readonly differing_pixels: number;
  readonly color_count: number;
  readonly dominant_ratio: number;
  readonly luminance_variance: number;
  readonly entropy: number;
};
export type PdfRasterPage = { readonly getViewport: (input: { readonly scale: number }) => { readonly width: number; readonly height: number }; readonly render: Function };
export type PdfRasterObservation = {
  readonly raster_width: number;
  readonly raster_height: number;
  readonly statistics: PdfPixelStatistics;
  readonly content_bounds: PdfContentBounds | null;
};

export class PdfRasterError extends Error {
  readonly name = "PdfRasterError";
  constructor(readonly code: "raster_limit" | "raster_aborted" | "blank_page" | "clipped_page", message: string = code) { super(message); }
}

export function assertPdfRasterBudget(widthPoints: number, heightPoints: number, pages: number): void {
  if (!pdfRasterBudgetFits(widthPoints, heightPoints, pages)) fail("raster_limit");
}

export async function rasterizePdfPage(page: PdfRasterPage, signal?: AbortSignal): Promise<PdfRasterObservation> {
  aborted(signal); const viewport = page.getViewport({ scale: PDF_RASTER_SCALE }); const { width, height } = pdfRasterDimensions(viewport.width / PDF_RASTER_SCALE, viewport.height / PDF_RASTER_SCALE);
  assertPdfRasterBudget(viewport.width / PDF_RASTER_SCALE, viewport.height / PDF_RASTER_SCALE, 1);
  const canvas = createCanvas(width, height); const context = canvas.getContext("2d");
  const task = nativeRender(page, { canvas, canvasContext: context, viewport });
  const cancel = (): void => { Reflect.apply(task.cancel, task.owner, []); }; signal?.addEventListener("abort", cancel, { once: true });
  try { await task.promise; aborted(signal); }
  catch (error) { if (signal?.aborted === true) fail("raster_aborted"); throw error; }
  finally { signal?.removeEventListener("abort", cancel); }
  return analyzePdfRaster(new Uint8Array(context.getImageData(0, 0, width, height).data), width, height);
}

export function analyzePdfRaster(rgba: Uint8Array, width: number, height: number): PdfRasterObservation {
  const pixels = width * height; if (pixels <= 0 || pixels > PDF_MAX_PAGE_PIXELS || rgba.length !== pixels * 4) fail("raster_limit");
  const background = cornerBackground(rgba, width, height); const colors = new Map<number, number>(); const luminance = new Uint32Array(256);
  let visible = 0; let painted = 0; let dominant = 0; let sum = 0; let squares = 0; let left = width; let top = height; let right = -1; let bottom = -1;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4; const alpha = rgba[offset + 3] ?? 0; if (alpha <= 2) continue;
    const red = rgba[offset] ?? 0; const green = rgba[offset + 1] ?? 0; const blue = rgba[offset + 2] ?? 0; const key = colorKey(red, green, blue);
    const count = (colors.get(key) ?? 0) + 1; colors.set(key, count); dominant = Math.max(dominant, count);
    const value = Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue); luminance[value] = (luminance[value] ?? 0) + 1; visible += 1; sum += value; squares += value * value;
    if (key !== background) { const x = pixel % width; const y = Math.floor(pixel / width); painted += 1; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  }
  const mean = sum / Math.max(1, visible); let entropy = 0;
  for (const count of luminance) if (count > 0) { const probability = count / Math.max(1, visible); entropy -= probability * Math.log2(probability); }
  const statistics = { pixels, visible_pixels: visible, painted_pixels: painted, differing_pixels: visible - dominant, color_count: colors.size, dominant_ratio: dominant / Math.max(1, visible), luminance_variance: Math.max(0, squares / Math.max(1, visible) - mean * mean), entropy };
  if (visible / pixels < 0.001 || painted / pixels < 0.001 || colors.size <= 1 || statistics.differing_pixels / Math.max(1, visible) < 0.001 || statistics.luminance_variance === 0 || entropy === 0) fail("blank_page");
  const bounds = painted === 0 ? null : { left, top, right, bottom };
  if (bounds !== null) {
    if (isPdfSingleEdgeClipped(bounds, width, height, painted, pixels)) throw new PdfRasterError("clipped_page", JSON.stringify({ bounds, painted_ratio: painted / pixels }));
  }
  return { raster_width: width, raster_height: height, statistics, content_bounds: bounds };
}

function nativeRender(page: PdfRasterPage, parameters: Readonly<Record<string, unknown>>): { readonly promise: Promise<unknown>; readonly cancel: Function; readonly owner: object } {
  const owner: object = Reflect.apply(page.render, page, [parameters]); const promise: unknown = Reflect.get(owner, "promise"); const cancel: unknown = Reflect.get(owner, "cancel");
  if (!(promise instanceof Promise) || typeof cancel !== "function") throw new TypeError("PDF raster task contract unavailable");
  return { promise, cancel, owner };
}
function cornerBackground(rgba: Uint8Array, width: number, height: number): number {
  const keys = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].map(([x, y]) => { const offset = ((y ?? 0) * width + (x ?? 0)) * 4; return colorKey(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0); });
  return keys.sort((a, b) => keys.filter((key) => key === b).length - keys.filter((key) => key === a).length)[0] ?? 0;
}
function colorKey(red: number, green: number, blue: number): number { return ((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3); }
function aborted(signal?: AbortSignal): void { if (signal?.aborted === true) fail("raster_aborted"); }
function fail(code: PdfRasterError["code"]): never { throw new PdfRasterError(code); }
