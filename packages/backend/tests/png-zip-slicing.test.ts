import { describe, expect, test } from "bun:test";
import { createCanvas } from "../src/services/export-native-modules";
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
