import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PLATFORM_PRESETS, type ExportOptions, type GraphicSetV1, type PlatformPreset, type ProjectDetail } from "@bg/shared";
import { capturePageFromSession, type CapturePage, type FrameMeasurement, type FrameRect } from "./export-frame-capture";
import { parseJpeg, validateJpeg } from "./export-jpeg-validation";
import { parsePng } from "./export-png-validation";
import { sha256 } from "./export-receipt";
import type { ExportValidation, PngZipOutputValidation, PngZipValidation } from "./export-receipt-validation";
import type { RenderSession } from "./export-render-session";
import { planSlices, type SliceFinding } from "./export-slice-plan";
import { zipDirectory } from "./zip";

const MAX_IMAGE_PIXELS = 16_000_000;
const MIN_JPEG_QUALITY = 60;
const JPEG_QUALITY_STEP = 5;
export const PNG_ZIP_BUDGETS = { maxFrames: 40, maxTotalBytes: 200_000_000, maxDurationMs: 300_000 } as const;
export type PngZipBudgets = typeof PNG_ZIP_BUDGETS;

export class PngZipError extends Error {
  readonly name = "PngZipError";
  constructor(
    readonly code: "dpr_unsupported" | "frame_count_limit" | "frame_count_mismatch" | "frame_geometry_invalid" | "frame_pixel_limit" | "total_bytes_limit" | "time_budget_exceeded" | "render_aborted" | "slice_bytes_exceeded",
    message: string,
  ) { super(message); }
}

export type PngZipContext = {
  readonly stagedDir: string;
  readonly outputPath: string;
  readonly project: ProjectDetail;
  readonly graphic_set: GraphicSetV1;
  readonly options: ExportOptions;
  readonly browserSession: RenderSession;
  readonly receiptWriter: (validation: ExportValidation) => Promise<void>;
  readonly signal: AbortSignal;
};

export type PngZipRun = {
  readonly page: CapturePage;
  readonly stagedDir: string;
  readonly outputPath: string;
  readonly deck: boolean;
  readonly graphic_set: GraphicSetV1;
  readonly options: ExportOptions;
  readonly receiptWriter: (validation: PngZipValidation) => Promise<void>;
  readonly signal: AbortSignal;
  readonly budgets?: Partial<PngZipBudgets>;
  readonly now?: () => number;
};

export type PngZipResult = { readonly validation: PngZipValidation; readonly findings: readonly SliceFinding[] };

type Batch = {
  readonly run: PngZipRun;
  readonly scratch: string;
  readonly budgets: PngZipBudgets;
  readonly deadline: number;
  readonly now: () => number;
  readonly outputs: PngZipOutputValidation[];
};

/** Renders frame or slice outputs from the staged tree, project and graphic-set contracts, options, browser session, receipt writer, and cancellation signal. */
export async function renderPngZip(context: PngZipContext): Promise<ExportValidation> {
  const result = await renderPngZipWithPage({
    page: capturePageFromSession(context.browserSession.page),
    stagedDir: context.stagedDir,
    outputPath: context.outputPath,
    deck: context.project.type === "slide_deck",
    graphic_set: context.graphic_set,
    options: context.options,
    receiptWriter: context.receiptWriter,
    signal: context.signal,
  });
  return result.validation;
}

/** Captures, validates and archives every frame or slice; nothing is published unless the whole batch succeeds. */
export async function renderPngZipWithPage(run: PngZipRun): Promise<PngZipResult> {
  if ((run.options.png_dpr ?? 1) !== 1) throw new PngZipError("dpr_unsupported", "PNG ZIP receipts record device pixel ratio 1 only");
  const now = run.now ?? Date.now;
  const budgets = { ...PNG_ZIP_BUDGETS, ...run.budgets };
  const scratch = path.join(path.dirname(run.stagedDir), "frames");
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
  const batch: Batch = { run, scratch, budgets, deadline: now() + budgets.maxDurationMs, now, outputs: [] };
  try {
    await run.page.awaitRenderReady();
    const findings = run.graphic_set.kind === "product_detail" ? await captureSlices(batch) : await captureFrames(batch);
    await zipDirectory(scratch, run.outputPath);
    const validation: PngZipValidation = { transformation_version: 1, outputs: batch.outputs, aggregate: { frames: batch.outputs.length, dpr: 1 } };
    await run.receiptWriter(validation);
    return { validation, findings };
  } catch (error) {
    await rm(run.outputPath, { force: true });
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function captureFrames(batch: Batch): Promise<readonly SliceFinding[]> {
  const selector = batch.run.deck ? "[data-slide]" : "[data-graphic-artboard]";
  const frames = await batch.run.page.measureFrames(selector);
  assertFrameContract(frames, batch);
  try {
    for (const frame of frames) {
      guard(batch);
      const rect = await batch.run.page.isolateFrame(selector, frame.sequence - 1);
      if (rect === null || rect.width !== frame.width || rect.height !== frame.height) throw new PngZipError("frame_geometry_invalid", `Frame ${frame.sequence} lost its geometry after isolation`);
      const bytes = await batch.run.page.capture({ clip: rect, format: "png" });
      guard(batch);
      const header = parsePng(bytes);
      if (header.width !== rect.width || header.height !== rect.height) throw new PngZipError("frame_geometry_invalid", `Frame ${frame.sequence} decoded as ${header.width}x${header.height}`);
      await addOutput(batch, bytes, { sequence: frame.sequence, total: frames.length, format: "png", width: header.width, height: header.height, top: frame.top, bottom: frame.bottom });
    }
  } finally {
    await batch.run.page.restoreFrames(selector);
  }
  return [];
}

function assertFrameContract(frames: readonly FrameMeasurement[], batch: Batch): void {
  if (frames.length > batch.budgets.maxFrames) throw new PngZipError("frame_count_limit", `Batch exports at most ${batch.budgets.maxFrames} frames, found ${frames.length}`);
  if (frames.length === 0) throw new PngZipError("frame_count_mismatch", "The rendered document declares no exportable frame");
  if (!batch.run.deck && frames.length !== batch.run.graphic_set.frame_count) throw new PngZipError("frame_count_mismatch", `Graphic set declares ${batch.run.graphic_set.frame_count} artboards, rendered ${frames.length}`);
  for (const frame of frames) {
    if (!Number.isSafeInteger(frame.width) || !Number.isSafeInteger(frame.height) || frame.width <= 0 || frame.height <= 0) throw new PngZipError("frame_geometry_invalid", `Frame ${frame.sequence} has no finite positive geometry`);
    if (frame.width * frame.height > MAX_IMAGE_PIXELS) throw new PngZipError("frame_pixel_limit", `Frame ${frame.sequence} exceeds ${MAX_IMAGE_PIXELS} pixels`);
  }
}

async function captureSlices(batch: Batch): Promise<readonly SliceFinding[]> {
  const measurement = await batch.run.page.measureSections("[data-graphic-artboard]");
  const plan = planSlices({
    pageHeight: measurement.pageHeight,
    width: measurement.pageWidth,
    sectionBottoms: measurement.sectionBottoms,
    sliceHeight: batch.run.options.slice_height ?? 5000,
  });
  const format = batch.run.options.slice_format ?? "png";
  if (format === "jpeg") await batch.run.page.flattenBackground();
  const maxBytes = presetMaxBytes(batch.run.graphic_set.preset_id);
  for (const [index, slice] of plan.slices.entries()) {
    guard(batch);
    const clip: FrameRect = { x: measurement.originX, y: measurement.originY + slice.top, width: measurement.pageWidth, height: slice.bottom - slice.top };
    const bytes = format === "jpeg" ? await captureJpegSlice(batch, clip, maxBytes) : await batch.run.page.capture({ clip, format });
    guard(batch);
    const header = format === "jpeg" ? parseJpeg(bytes) : parsePng(bytes);
    if (header.width !== clip.width || header.height !== clip.height) throw new PngZipError("frame_geometry_invalid", `Slice ${index + 1} decoded as ${header.width}x${header.height}`);
    await addOutput(batch, bytes, { sequence: index + 1, total: plan.slices.length, format, width: header.width, height: header.height, top: slice.top, bottom: slice.bottom });
  }
  return plan.findings;
}

/** Lowers JPEG quality in bounded steps until the slice fits the preset byte cap, then fails instead of shipping an oversized upload. */
async function captureJpegSlice(batch: Batch, clip: FrameRect, maxBytes: number | null): Promise<Uint8Array> {
  let quality = batch.run.options.jpeg_quality ?? 85;
  for (;;) {
    guard(batch);
    const bytes = await batch.run.page.capture({ clip, format: "jpeg", quality });
    validateJpeg(bytes, { width: clip.width, height: clip.height });
    if (maxBytes === null || bytes.byteLength <= maxBytes) return bytes;
    if (quality <= MIN_JPEG_QUALITY) throw new PngZipError("slice_bytes_exceeded", `Slice stays ${bytes.byteLength} bytes at quality ${MIN_JPEG_QUALITY}, over the ${maxBytes} byte cap`);
    quality = Math.max(MIN_JPEG_QUALITY, quality - JPEG_QUALITY_STEP);
  }
}

type OutputRecord = { readonly sequence: number; readonly total: number; readonly format: "png" | "jpeg"; readonly width: number; readonly height: number; readonly top: number; readonly bottom: number };

async function addOutput(batch: Batch, bytes: Uint8Array, record: OutputRecord): Promise<void> {
  const relPath = `${String(record.sequence).padStart(Math.max(2, String(record.total).length), "0")}.${record.format === "jpeg" ? "jpg" : "png"}`;
  await writeFile(path.join(batch.scratch, relPath), bytes);
  batch.outputs.push({
    rel_path: relPath,
    width: record.width,
    height: record.height,
    image_format: record.format,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    sequence: record.sequence,
    source_region: { top: record.top, bottom: record.bottom },
  });
  const total = batch.outputs.reduce((sum, output) => sum + output.bytes, 0);
  if (total > batch.budgets.maxTotalBytes) throw new PngZipError("total_bytes_limit", `Batch reached ${total} bytes, over the ${batch.budgets.maxTotalBytes} byte budget`);
}

function presetMaxBytes(presetId: string | undefined): number | null {
  if (presetId === undefined) return null;
  const presets: readonly PlatformPreset[] = PLATFORM_PRESETS;
  return presets.find((preset) => preset.id === presetId)?.limits.max_bytes ?? null;
}

function guard(batch: Batch): void {
  if (batch.run.signal.aborted) throw new PngZipError("render_aborted", "Export was cancelled");
  if (batch.now() > batch.deadline) throw new PngZipError("time_budget_exceeded", "Batch export exceeded its time budget");
}
