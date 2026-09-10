import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import type { ExportOptions, GraphicSetV1 } from "@bg/shared";
import type { CapturePage, CaptureRequest, FrameMeasurement, FrameRect } from "../src/services/export-frame-capture";
import { createCanvas } from "../src/services/export-native-modules";
import { PngZipError, renderPngZipWithPage, type PngZipResult } from "../src/services/export-png-zip";
import type { PngZipValidation } from "../src/services/export-receipt-validation";

const pngOptions: ExportOptions = { slice_height: 5000, slice_format: "png" };

let root = "";
let stagedDir = "";
let outputPath = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "bg-png-zip-"));
  stagedDir = path.join(root, "project");
  outputPath = path.join(root, "artifact.zip");
  await mkdir(stagedDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function pngBytes(width: number, height: number): Uint8Array {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#101820";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#f2a03d";
  context.fillRect(0, 0, Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)));
  return new Uint8Array(canvas.toBuffer("image/png"));
}

type Recorder = {
  readonly page: CapturePage;
  readonly selectors: string[];
  readonly isolated: number[];
  readonly captures: CaptureRequest[];
};

function stackedFrames(count: number, width: number, height: number): readonly FrameMeasurement[] {
  return Array.from({ length: count }, (_unused, index) => ({
    sequence: index + 1,
    width,
    height,
    top: index * height,
    bottom: (index + 1) * height,
  }));
}

function recorderPage(frames: readonly FrameMeasurement[], onCapture?: (request: CaptureRequest) => void): Recorder {
  const selectors: string[] = [];
  const isolated: number[] = [];
  const captures: CaptureRequest[] = [];
  const page: CapturePage = {
    awaitRenderReady: async () => undefined,
    applyDeckPrintStyles: async () => undefined,
    measureFrames: async (selector) => { selectors.push(selector); return frames; },
    isolateFrame: async (_selector, index): Promise<FrameRect | null> => {
      isolated.push(index);
      const frame = frames[index];
      return frame === undefined ? null : { x: 0, y: frame.top, width: frame.width, height: frame.height };
    },
    restoreFrames: async () => undefined,
    measureSections: async () => ({ pageWidth: 0, pageHeight: 0, originX: 0, originY: 0, sectionBottoms: [] }),
    flattenBackground: async () => undefined,
    capture: async (request) => {
      captures.push(request);
      onCapture?.(request);
      return pngBytes(request.clip.width, request.clip.height);
    },
  };
  return { page, selectors, isolated, captures };
}

async function run(input: {
  readonly page: CapturePage;
  readonly graphic_set: GraphicSetV1;
  readonly signal?: AbortSignal;
  readonly budgets?: { readonly maxTotalBytes?: number; readonly maxDurationMs?: number };
  readonly now?: () => number;
  readonly receipts?: PngZipValidation[];
}): Promise<PngZipResult> {
  const receipts = input.receipts ?? [];
  return await renderPngZipWithPage({
    page: input.page,
    stagedDir,
    outputPath,
    deck: false,
    graphic_set: input.graphic_set,
    options: pngOptions,
    receiptWriter: async (validation) => { receipts.push(validation); },
    signal: input.signal ?? new AbortController().signal,
    ...(input.budgets === undefined ? {} : { budgets: input.budgets }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

const cardNews = (frameCount: number): GraphicSetV1 => ({ schema_version: 1, kind: "card_news", frame_count: frameCount });

describe("graphic frame batch export", () => {
  test("Given three artboards When exported Then zero-padded frames are zipped, validated and receipted in order", async () => {
    // Given
    const recorder = recorderPage(stackedFrames(3, 240, 120));
    const receipts: PngZipValidation[] = [];

    // When
    const { validation } = await run({ page: recorder.page, graphic_set: cardNews(3), receipts });

    // Then
    const archive = await JSZip.loadAsync(await readFile(outputPath));
    expect(Object.keys(archive.files).sort()).toEqual(["01.png", "02.png", "03.png"]);
    expect(validation.aggregate).toEqual({ frames: 3, dpr: 1 });
    expect(validation.outputs.map((output) => [output.rel_path, output.sequence, output.width, output.height, output.image_format])).toEqual([
      ["01.png", 1, 240, 120, "png"],
      ["02.png", 2, 240, 120, "png"],
      ["03.png", 3, 240, 120, "png"],
    ]);
    expect(validation.outputs.map((output) => output.source_region)).toEqual([
      { top: 0, bottom: 120 },
      { top: 120, bottom: 240 },
      { top: 240, bottom: 360 },
    ]);
    expect(validation.outputs.every((output) => /^[0-9a-f]{64}$/u.test(output.sha256) && output.bytes > 0)).toBe(true);
    expect(receipts).toEqual([validation]);
  });

  test("Given stacked artboards When exported Then every frame is isolated before its own clipped capture", async () => {
    // Given
    const recorder = recorderPage(stackedFrames(3, 200, 100));

    // When
    await run({ page: recorder.page, graphic_set: cardNews(3) });

    // Then
    expect(recorder.selectors).toEqual(["[data-graphic-artboard]"]);
    expect(recorder.isolated).toEqual([0, 1, 2]);
    expect(recorder.captures.map((capture) => capture.clip)).toEqual([
      { x: 0, y: 0, width: 200, height: 100 },
      { x: 0, y: 100, width: 200, height: 100 },
      { x: 0, y: 200, width: 200, height: 100 },
    ]);
    expect(recorder.captures.every((capture) => capture.format === "png" && capture.quality === undefined)).toBe(true);
  });

  test("Given a slide deck source When exported Then the slide selector drives the batch", async () => {
    // Given
    const recorder = recorderPage(stackedFrames(2, 320, 180));

    // When
    await renderPngZipWithPage({
      page: recorder.page,
      stagedDir,
      outputPath,
      deck: true,
      graphic_set: { schema_version: 1, kind: "single", frame_count: 1 },
      options: pngOptions,
      receiptWriter: async () => undefined,
      signal: new AbortController().signal,
    });

    // Then
    expect(recorder.selectors).toEqual(["[data-slide]"]);
    expect(recorder.captures).toHaveLength(2);
  });

  test("Given a deck runtime that hides inactive slides When exported Then slides are shown before they are measured", async () => {
    // Given: the deck runtime keeps every non-active slide at display:none, so
    // slides 2..N measure 0x0 until the deck print styles are applied.
    let printed = false;
    const visible = stackedFrames(3, 320, 180);
    const hidden = visible.map((frame, index) => index === 0 ? frame : { ...frame, width: 0, height: 0, top: 0, bottom: 0 });
    const recorder = recorderPage(visible);
    const page: CapturePage = {
      ...recorder.page,
      applyDeckPrintStyles: async () => { printed = true; },
      measureFrames: async (selector) => { recorder.selectors.push(selector); return printed ? visible : hidden; },
    };

    // When
    await renderPngZipWithPage({
      page,
      stagedDir,
      outputPath,
      deck: true,
      graphic_set: { schema_version: 1, kind: "single", frame_count: 1 },
      options: pngOptions,
      receiptWriter: async () => undefined,
      signal: new AbortController().signal,
    });

    // Then
    expect(printed).toBe(true);
    expect(recorder.captures).toHaveLength(3);
  });

  test("Given a cancellation mid-batch When exported Then no archive survives and the scratch directory is removed", async () => {
    // Given
    const controller = new AbortController();
    const recorder = recorderPage(stackedFrames(4, 200, 100), (request) => {
      if (request.clip.y === 100) controller.abort();
    });

    // When / Then
    await expect(run({ page: recorder.page, graphic_set: cardNews(4), signal: controller.signal })).rejects.toMatchObject({ code: "render_aborted" });
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(path.join(root, "frames"))).toBe(false);
    expect(recorder.captures).toHaveLength(2);
  });

  test("Given forty-one artboards When exported Then the frame ceiling rejects the batch before any capture", async () => {
    // Given
    const recorder = recorderPage(stackedFrames(41, 200, 100));

    // When / Then
    await expect(run({ page: recorder.page, graphic_set: cardNews(40) })).rejects.toBeInstanceOf(PngZipError);
    expect(recorder.captures).toHaveLength(0);
    expect(existsSync(outputPath)).toBe(false);
  });

  test("Given a declared frame count that the document does not match When exported Then the mismatch fails before capture", async () => {
    // Given
    const recorder = recorderPage(stackedFrames(2, 200, 100));

    // When / Then
    await expect(run({ page: recorder.page, graphic_set: cardNews(3) })).rejects.toMatchObject({ code: "frame_count_mismatch" });
    expect(recorder.captures).toHaveLength(0);
  });

  test("Given an artboard over the per-image pixel budget When exported Then capture never starts", async () => {
    // Given
    const recorder = recorderPage(stackedFrames(2, 4000, 5000));

    // When / Then
    await expect(run({ page: recorder.page, graphic_set: cardNews(2) })).rejects.toMatchObject({ code: "frame_pixel_limit" });
    expect(recorder.captures).toHaveLength(0);
  });

  test("Given a total byte budget smaller than the batch When exported Then the run stops without an archive", async () => {
    // Given
    const recorder = recorderPage(stackedFrames(3, 200, 100));

    // When / Then
    await expect(run({ page: recorder.page, graphic_set: cardNews(3), budgets: { maxTotalBytes: 200 } })).rejects.toMatchObject({ code: "total_bytes_limit" });
    expect(recorder.captures.length).toBeLessThan(3);
    expect(existsSync(outputPath)).toBe(false);
  });

  test("Given a clock past the time budget When exported Then the run stops with a time budget error", async () => {
    // Given
    const recorder = recorderPage(stackedFrames(3, 200, 100));
    let ticks = 0;
    const now = (): number => { ticks += 1; return ticks * 10_000; };

    // When / Then
    await expect(run({ page: recorder.page, graphic_set: cardNews(3), budgets: { maxDurationMs: 15_000 }, now })).rejects.toMatchObject({ code: "time_budget_exceeded" });
    expect(existsSync(outputPath)).toBe(false);
  });
});
