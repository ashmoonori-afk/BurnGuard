import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExportOptions, GraphicSetV1 } from "@bg/shared";
import type { CapturePage, CaptureRequest, SectionMeasurement } from "../src/services/export-frame-capture";
import { createCanvas } from "../src/services/export-native-modules";
import { renderPngZipWithPage, type PngZipResult } from "../src/services/export-png-zip";
import { planSlices, SlicePlanError, type SliceRegion } from "../src/services/export-slice-plan";
import { JpegValidationError, parseJpeg, validateJpeg } from "../src/services/export-jpeg-validation";

function contiguous(slices: readonly SliceRegion[], pageHeight: number): boolean {
  return slices.length > 0
    && slices[0]?.top === 0
    && slices.at(-1)?.bottom === pageHeight
    && slices.every((slice, index) => slice.bottom > slice.top && (index === 0 || slice.top === slices[index - 1]?.bottom));
}

function jpegBytes(width: number, height: number, quality: number): Uint8Array {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#123456";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#f0a020";
  context.fillRect(0, 0, Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 3)));
  return new Uint8Array(canvas.toBuffer("image/jpeg", quality));
}

describe("product detail slice plan", () => {
  test("Given the 860x12000 example with section bottoms 4800/9600/12000 When planned at 5000 Then cuts land on those bottoms", () => {
    // Given / When
    const plan = planSlices({ pageHeight: 12_000, width: 860, sectionBottoms: [4800, 9600, 12_000], sliceHeight: 5000 });

    // Then
    expect(plan.slices).toEqual([
      { top: 0, bottom: 4800, cut_through_content: false },
      { top: 4800, bottom: 9600, cut_through_content: false },
      { top: 9600, bottom: 12_000, cut_through_content: false },
    ]);
    expect(plan.findings).toEqual([]);
  });

  test("Given nested and unsorted section bottoms When planned Then slices stay contiguous with no gap, overlap, or zero height", () => {
    // Given
    const bottoms = [2400, 2400, 900, 7300, 4800, 9600, 12_000, 11_100];

    // When
    const plan = planSlices({ pageHeight: 12_000, width: 860, sectionBottoms: bottoms, sliceHeight: 3000 });

    // Then
    expect(contiguous(plan.slices, 12_000)).toBe(true);
    expect(plan.slices.every((slice) => slice.bottom - slice.top <= 3000)).toBe(true);
  });

  test("Given a section taller than the slice height When planned Then the forced cut is recorded with its slice index", () => {
    // Given / When
    const plan = planSlices({ pageHeight: 12_000, width: 860, sectionBottoms: [6000, 12_000], sliceHeight: 5000 });

    // Then
    expect(plan.slices).toEqual([
      { top: 0, bottom: 5000, cut_through_content: true },
      { top: 5000, bottom: 6000, cut_through_content: false },
      { top: 6000, bottom: 11_000, cut_through_content: true },
      { top: 11_000, bottom: 12_000, cut_through_content: false },
    ]);
    expect(plan.findings).toEqual([
      { code: "cut_through_content", slice: 1 },
      { code: "cut_through_content", slice: 3 },
    ]);
  });

  test("Given a page with no usable section boundary When planned Then every slice is a forced cut and still covers the page", () => {
    // Given / When
    const plan = planSlices({ pageHeight: 7000, width: 780, sectionBottoms: [], sliceHeight: 3000 });

    // Then
    expect(plan.slices.map((slice) => slice.bottom)).toEqual([3000, 6000, 7000]);
    expect(plan.findings).toEqual([{ code: "cut_through_content", slice: 1 }, { code: "cut_through_content", slice: 2 }]);
    expect(contiguous(plan.slices, 7000)).toBe(true);
  });

  test("Given a slice wider than the pixel budget When planned Then planning fails before any capture", () => {
    // Given / When / Then
    expect(() => planSlices({ pageHeight: 12_000, width: 4000, sectionBottoms: [], sliceHeight: 5000 })).toThrow(SlicePlanError);
    try {
      planSlices({ pageHeight: 12_000, width: 4000, sectionBottoms: [], sliceHeight: 5000 });
    } catch (error) {
      expect(error).toMatchObject({ code: "slice_pixel_limit" });
    }
  });

  test.each([
    { pageHeight: 0, sectionBottoms: [] as readonly number[], code: "invalid_page_height" },
    { pageHeight: 12_000, sectionBottoms: [12_500], code: "invalid_section_bottoms" },
    { pageHeight: 12_000, sectionBottoms: [1200.5], code: "invalid_section_bottoms" },
  ])("Given invalid geometry $code When planned Then a typed error is thrown", ({ pageHeight, sectionBottoms, code }) => {
    // Given / When / Then
    try {
      planSlices({ pageHeight, width: 860, sectionBottoms, sliceHeight: 5000 });
      throw new TypeError("expected slice plan rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(SlicePlanError);
      expect(error).toMatchObject({ code });
    }
  });
});

describe("JPEG slice validation", () => {
  test("Given an encoded JPEG slice When parsed Then the SOF dimensions are decoded", () => {
    // Given
    const bytes = jpegBytes(860, 4800, 85);

    // When / Then
    expect(parseJpeg(bytes)).toEqual({ width: 860, height: 4800 });
    expect(validateJpeg(bytes, { width: 860, height: 4800 })).toEqual({ width: 860, height: 4800 });
  });

  test("Given a JPEG whose dimensions differ from the slice When validated Then it is rejected", () => {
    // Given
    const bytes = jpegBytes(860, 1200, 85);

    // When / Then
    try {
      validateJpeg(bytes, { width: 860, height: 4800 });
      throw new TypeError("expected dimension rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(JpegValidationError);
      expect(error).toMatchObject({ code: "dimension_mismatch" });
    }
  });

  test.each([
    { label: "PNG bytes", bytes: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]) },
    { label: "truncated marker stream", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00]) },
    { label: "no frame header", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]) },
  ])("Given $label When parsed Then the JPEG parser rejects it", ({ bytes }) => {
    // Given / When / Then
    expect(() => parseJpeg(bytes)).toThrow(JpegValidationError);
  });

  test("Given a lower quality When the same slice is encoded Then the byte size shrinks so a bounded retry can converge", () => {
    // Given / When
    const high = jpegBytes(860, 2400, 95).byteLength;
    const low = jpegBytes(860, 2400, 60).byteLength;

    // Then
    expect(low).toBeLessThan(high);
  });
});

type SliceRecorder = { readonly page: CapturePage; readonly captures: CaptureRequest[]; readonly flattened: number[] };

let root = "";
let stagedDir = "";
let outputPath = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "bg-slice-export-"));
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
  context.fillStyle = "#0f1c2e";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#e8f0ff";
  context.fillRect(0, 0, width, Math.max(1, Math.floor(height / 4)));
  return new Uint8Array(canvas.toBuffer("image/png"));
}

function padded(bytes: Uint8Array, size: number): Uint8Array {
  if (size <= bytes.byteLength) return bytes;
  const filled = new Uint8Array(size);
  filled.set(bytes);
  return filled;
}

function slicePage(measurement: SectionMeasurement, encode: (request: CaptureRequest) => Uint8Array): SliceRecorder {
  const captures: CaptureRequest[] = [];
  const flattened: number[] = [];
  const page: CapturePage = {
    awaitRenderReady: async () => undefined,
    applyDeckPrintStyles: async () => undefined,
    measureFrames: async () => [],
    isolateFrame: async () => null,
    restoreFrames: async () => undefined,
    measureSections: async () => measurement,
    flattenBackground: async () => { flattened.push(captures.length); },
    capture: async (request) => { captures.push(request); return encode(request); },
  };
  return { page, captures, flattened };
}

const detailSet: GraphicSetV1 = { schema_version: 1, kind: "product_detail", frame_count: 1 };

async function runSlices(page: CapturePage, options: ExportOptions, graphicSet: GraphicSetV1 = detailSet): Promise<PngZipResult> {
  return await renderPngZipWithPage({
    page,
    stagedDir,
    outputPath,
    deck: false,
    graphic_set: graphicSet,
    options,
    receiptWriter: async () => undefined,
    signal: new AbortController().signal,
  });
}

describe("product detail slice export", () => {
  test("Given the 860x12000 page When exported as PNG slices Then each slice is clipped, validated and receipted at its section bottom", async () => {
    // Given
    const recorder = slicePage(
      { pageWidth: 860, pageHeight: 12_000, originX: 0, originY: 0, sectionBottoms: [4800, 9600, 12_000] },
      (request) => pngBytes(request.clip.width, request.clip.height),
    );

    // When
    const { validation, findings } = await runSlices(recorder.page, { slice_height: 5000, slice_format: "png" });

    // Then
    expect(recorder.captures.map((capture) => capture.clip)).toEqual([
      { x: 0, y: 0, width: 860, height: 4800 },
      { x: 0, y: 4800, width: 860, height: 4800 },
      { x: 0, y: 9600, width: 860, height: 2400 },
    ]);
    expect(validation.outputs.map((output) => [output.rel_path, output.height, output.image_format])).toEqual([
      ["01.png", 4800, "png"],
      ["02.png", 4800, "png"],
      ["03.png", 2400, "png"],
    ]);
    expect(validation.outputs.map((output) => output.source_region)).toEqual([
      { top: 0, bottom: 4800 },
      { top: 4800, bottom: 9600 },
      { top: 9600, bottom: 12_000 },
    ]);
    expect(findings).toEqual([]);
  }, 30_000);

  test("Given a section taller than the slice height When exported Then the forced cut is reported with its slice index", async () => {
    // Given
    const recorder = slicePage(
      { pageWidth: 780, pageHeight: 7000, originX: 0, originY: 0, sectionBottoms: [7000] },
      (request) => pngBytes(request.clip.width, request.clip.height),
    );

    // When
    const { findings, validation } = await runSlices(recorder.page, { slice_height: 3000, slice_format: "png" });

    // Then
    expect(findings).toEqual([{ code: "cut_through_content", slice: 1 }, { code: "cut_through_content", slice: 2 }]);
    expect(validation.outputs).toHaveLength(3);
    expect(recorder.captures.every((capture) => capture.clip.height <= 3000)).toBe(true);
  }, 30_000);

  test("Given JPEG slices When exported Then transparency is flattened before capture and decoded dimensions are recorded", async () => {
    // Given
    const recorder = slicePage(
      { pageWidth: 780, pageHeight: 5000, originX: 0, originY: 0, sectionBottoms: [2500, 5000] },
      (request) => jpegBytes(request.clip.width, request.clip.height, request.quality ?? 85),
    );

    // When
    const { validation } = await runSlices(recorder.page, { slice_height: 3000, slice_format: "jpeg", jpeg_quality: 85 });

    // Then
    expect(recorder.flattened).toEqual([0]);
    expect(recorder.captures.every((capture) => capture.format === "jpeg" && capture.quality === 85)).toBe(true);
    expect(validation.outputs.map((output) => [output.rel_path, output.width, output.height, output.image_format])).toEqual([
      ["01.jpg", 780, 2500, "jpeg"],
      ["02.jpg", 780, 2500, "jpeg"],
    ]);
  }, 30_000);

  test("Given a preset byte cap When the first quality is too large Then quality drops in bounded steps until the slice fits", async () => {
    // Given: Coupang caps a slice at 5,000,000 bytes.
    const recorder = slicePage(
      { pageWidth: 780, pageHeight: 2000, originX: 0, originY: 0, sectionBottoms: [2000] },
      (request) => padded(jpegBytes(request.clip.width, request.clip.height, request.quality ?? 85), (request.quality ?? 85) * 62_000),
    );

    // When
    const { validation } = await runSlices(
      recorder.page,
      { slice_height: 3000, slice_format: "jpeg", jpeg_quality: 85 },
      { schema_version: 1, kind: "product_detail", frame_count: 1, preset_id: "coupang-product-detail" },
    );

    // Then
    expect(recorder.captures.map((capture) => capture.quality)).toEqual([85, 80]);
    expect(validation.outputs[0]?.bytes).toBe(80 * 62_000);
    expect(validation.outputs[0]?.image_format).toBe("jpeg");
  }, 30_000);

  test("Given a slice that stays over the cap at quality 60 When exported Then the export fails instead of shipping an oversized upload", async () => {
    // Given
    const recorder = slicePage(
      { pageWidth: 780, pageHeight: 2000, originX: 0, originY: 0, sectionBottoms: [2000] },
      (request) => padded(jpegBytes(request.clip.width, request.clip.height, request.quality ?? 85), 6_000_000),
    );

    // When / Then
    await expect(runSlices(
      recorder.page,
      { slice_height: 3000, slice_format: "jpeg", jpeg_quality: 85 },
      { schema_version: 1, kind: "product_detail", frame_count: 1, preset_id: "coupang-product-detail" },
    )).rejects.toMatchObject({ code: "slice_bytes_exceeded" });
    expect(recorder.captures.map((capture) => capture.quality)).toEqual([85, 80, 75, 70, 65, 60]);
    expect(existsSync(outputPath)).toBe(false);
  }, 30_000);
});
