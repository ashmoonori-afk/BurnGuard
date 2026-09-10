import { describe, expect, test } from "bun:test";
import { analyzePdfRaster } from "../src/services/export-pdf-raster";
import { isPdfSingleEdgeClipped, pdfPointsForPaper, pdfPointsMatchPaper, pdfRasterBudgetFits, pdfRasterBudgetFitsPages } from "../src/services/export-pdf-contract";
import { balancedEntropyMaximum, binaryOneOutlierEntropy, validatePdfReceiptObservation } from "../src/services/export-pdf-receipt-invariants";

describe("canonical PDF producer closure", () => {
  test("two quantized colors can produce four balanced luminance bins", () => {
    const rgba = Uint8Array.from([0, 0, 0, 255, 0, 0, 7, 255, 0, 1, 11, 255, 0, 2, 15, 255]);
    const observation = analyzePdfRaster(rgba, 2, 2);
    expect(observation.statistics.color_count).toBe(2); expect(observation.statistics.differing_pixels).toBe(2); expect(observation.statistics.entropy).toBe(2); expect(observation.statistics.entropy).toBeGreaterThan(Math.log2(observation.statistics.color_count)); expect(validatePdfReceiptObservation({ page: 1, width_points: 1, height_points: 1, operators: 1, ...observation })).toEqual({ ok: true });
  });
  test("budgets option-derived geometry rather than observed-page sums", () => {
    expect(pdfPointsForPaper("a4")).toEqual({ width: 841.89, height: 595.28 }); expect(pdfPointsForPaper("letter")).toEqual({ width: 792, height: 612 }); const points = pdfPointsForPaper("widescreen-16x9"); expect(points).toEqual({ width: 959.976, height: 540 }); expect(pdfRasterBudgetFits(points.width, points.height, 30)).toBe(true); expect(pdfRasterBudgetFits(points.width, points.height, 31)).toBe(false);
    expect(pdfPointsMatchPaper("letter", 793, 611)).toBe(true); expect(pdfPointsMatchPaper("letter", 793.001, 612)).toBe(false);
  });
  test("Given many artboards When raster budgets are checked Then aggregate overflow is rejected before rendering", () => {
    // Given
    const points = { width: 1080 * 0.75, height: 1080 * 0.75 };

    // When / Then
    expect(pdfRasterBudgetFitsPages(Array.from({ length: 20 }, () => points))).toBe(true);
    expect(pdfRasterBudgetFitsPages(Array.from({ length: 40 }, () => points))).toBe(false);
  });
  test("uses exact producer clipping and finite-sample scalar boundaries", () => {
    expect(isPdfSingleEdgeClipped({ left: 0, top: 10, right: 19, bottom: 19 }, 100, 100, 200, 10_000)).toBe(true); expect(isPdfSingleEdgeClipped({ left: 0, top: 0, right: 19, bottom: 19 }, 100, 100, 200, 10_000)).toBe(false);
    expect(binaryOneOutlierEntropy(3)).toBeGreaterThan(0); expect(balancedEntropyMaximum(4, 4)).toBe(2);
  });
});
