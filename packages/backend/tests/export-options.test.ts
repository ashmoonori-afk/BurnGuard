import { describe, expect, test } from "bun:test";
import { pdfDimensionsForPaper } from "../src/services/export-pdf-contract";
import { pptxLayoutForSize } from "../src/services/export-pptx";

describe("pdfDimensionsForPaper", () => {
  test("a4 maps to the named A4 format with no explicit dimensions", () => {
    const dims = pdfDimensionsForPaper("a4");
    expect(dims.format).toBe("A4");
    expect(dims.width).toBeUndefined();
    expect(dims.height).toBeUndefined();
  });

  test("letter maps to the named Letter format", () => {
    const dims = pdfDimensionsForPaper("letter");
    expect(dims.format).toBe("Letter");
    expect(dims.width).toBeUndefined();
    expect(dims.height).toBeUndefined();
  });

  test("widescreen-16x9 emits explicit width/height instead of a named format", () => {
    // page.pdf needs explicit width/height when the paper isn't one of
    // its named presets. 13.333" x 7.5" is the standard 16:9 PowerPoint
    // slide footprint scaled to inches.
    const dims = pdfDimensionsForPaper("widescreen-16x9");
    expect(dims.format).toBeUndefined();
    expect(dims.width).toBe("13.333in");
    expect(dims.height).toBe("7.5in");
  });

  test("Given an artboard paper and canvas pixels When mapped Then Chromium receives 0.75-point dimensions", () => {
    // Given / When
    const dims = pdfDimensionsForPaper("artboard", { width: 1080, height: 1350 });

    // Then
    expect(dims).toEqual({ width: "810pt", height: "1012.5pt" });
  });
});

describe("pptxLayoutForSize", () => {
  test("16x9 is the 10in × 5.625in widescreen default", () => {
    const layout = pptxLayoutForSize("16x9");
    expect(layout.width).toBe(10);
    expect(layout.height).toBe(5.625);
    expect(layout.name).toBe("BG_16x9");
  });

  test("4x3 is the 10in × 7.5in classic PowerPoint layout", () => {
    const layout = pptxLayoutForSize("4x3");
    expect(layout.width).toBe(10);
    expect(layout.height).toBe(7.5);
    expect(layout.name).toBe("BG_4x3");
  });

  test("layout names are unique so PptxGenJS does not collide between exports", () => {
    expect(pptxLayoutForSize("16x9").name).not.toBe(
      pptxLayoutForSize("4x3").name,
    );
  });
});
