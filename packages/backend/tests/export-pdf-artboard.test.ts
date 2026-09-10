import { describe, expect, test } from "bun:test";
import { ARTBOARD_PRINT_CSS, assertUniformArtboardPages, PdfExportError } from "../src/services/export-pdf";
import { pdfDimensionsForPaper, pdfPointsForPaper, pdfRasterBudgetFitsPages } from "../src/services/export-pdf-contract";

describe("artboard PDF geometry", () => {
  test("Given a uniform card news set When paged Then every page is the artboard size in points", () => {
    // Given
    const artboards = Array.from({ length: 6 }, () => ({ width: 1080, height: 1350 }));

    // When
    const points = artboards.map((artboard) => pdfPointsForPaper("artboard", artboard));

    // Then
    expect(points).toEqual(Array.from({ length: 6 }, () => ({ width: 810, height: 1012.5 })));
    expect(pdfDimensionsForPaper("artboard", { width: 1080, height: 1350 })).toEqual({ width: "810pt", height: "1012.5pt" });
    expect(pdfRasterBudgetFitsPages(points)).toBe(true);
    expect(() => { assertUniformArtboardPages(artboards); }).not.toThrow();
  });

  test("Given a mixed-size banner set When paged Then rendering is refused with a typed error", () => {
    // Given
    const artboards = [{ width: 1200, height: 628 }, { width: 1200, height: 1200 }];

    // When / Then
    try {
      assertUniformArtboardPages(artboards);
      throw new TypeError("expected mixed page rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(PdfExportError);
      expect(error).toMatchObject({ code: "mixed_page_sizes" });
    }
  });

  test("Given sub-pixel layout jitter When paged Then a one-pixel difference is still one uniform size", () => {
    // Given / When / Then
    expect(() => { assertUniformArtboardPages([{ width: 1080, height: 1350 }, { width: 1080.4, height: 1349.7 }]); }).not.toThrow();
  });

  test("Given forty 1080x1080 artboards When budgeted Then the aggregate raster ceiling refuses the batch", () => {
    // Given
    const points = Array.from({ length: 40 }, () => pdfPointsForPaper("artboard", { width: 1080, height: 1080 }));

    // When / Then
    expect(pdfRasterBudgetFitsPages(points)).toBe(false);
    expect(pdfRasterBudgetFitsPages(points.slice(0, 8))).toBe(true);
  });

  test("Given a single artboard over the per-page ceiling When budgeted Then it is refused before rendering", () => {
    // Given / When / Then
    expect(pdfRasterBudgetFitsPages([pdfPointsForPaper("artboard", { width: 4000, height: 4000 })])).toBe(false);
  });

  test("Given stacked artboards When print CSS is applied Then stack spacing and page minimums cannot add blank pages", () => {
    // Given / When / Then
    expect(ARTBOARD_PRINT_CSS).toMatch(/\[data-graphic-artboard\][^{]*\{[^}]*margin:\s*0\s*!important/u);
    expect(ARTBOARD_PRINT_CSS).toMatch(/min-height:\s*0\s*!important/u);
    expect(ARTBOARD_PRINT_CSS).toMatch(/min-width:\s*0\s*!important/u);
  });
});
