import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { ARTBOARD_PRINT_CSS, assertUniformArtboardPages, PdfExportError, renderDeckToPdf } from "../src/services/export-pdf";
import { pdfDimensionsForPaper, pdfPointsForPaper, pdfRasterBudgetFitsPages } from "../src/services/export-pdf-contract";

describe("artboard PDF geometry", () => {
  test.each([
    { width: 640, height: 480, pages: 1 },
    { width: 640, height: 480, pages: 2 },
    { width: 480, height: 640, pages: 2 },
  ])("real renderer preserves 0.75 points per CSS pixel for $pages artboards at $width x $height", async ({ width, height, pages }) => {
    const stagedDir = await mkdtemp(path.join(tmpdir(), "bg-artboard-pdf-"));
    try {
      await writeFile(path.join(stagedDir, "index.html"), artboardHtml(Array.from({ length: pages }, () => ({ width, height }))));
      const outputPath = path.join(stagedDir, "artboards.pdf");
      const validation = await renderDeckToPdf({ stagedDir, entrypoint: "index.html", outputPath, paper: "artboard", selector: "[data-graphic-artboard]", signal: AbortSignal.timeout(45_000) });
      const bytes = await readFile(outputPath);
      const pdf = await PDFDocument.load(bytes);
      const geometry = pdf.getPages().map(page => page.getSize());
      expect(pdf.getPageCount()).toBe(pages);
      expect(geometry).toEqual(Array.from({ length: pages }, () => ({ width: width * 0.75, height: height * 0.75 })));
      expect(validation.pages).toBe(pages);
      expect(validation.observations).toHaveLength(pages);
      for (const observation of validation.observations) {
        expect(observation.width_points).toBe(width * 0.75);
        expect(observation.height_points).toBe(height * 0.75);
        expect(observation.statistics.painted_pixels).toBeGreaterThan(0);
      }
      console.info("artboard-pdf-geometry", JSON.stringify({ css: { width, height }, pages, geometry, bytes: bytes.length }));
    } finally { await rm(stagedDir, { recursive: true, force: true }); }
  }, 60_000);

  test("real renderer rejects mixed artboard sizes before writing a PDF", async () => {
    const stagedDir = await mkdtemp(path.join(tmpdir(), "bg-artboard-pdf-mixed-"));
    try {
      await writeFile(path.join(stagedDir, "index.html"), artboardHtml([{ width: 640, height: 480 }, { width: 800, height: 400 }]));
      await expect(renderDeckToPdf({ stagedDir, entrypoint: "index.html", outputPath: path.join(stagedDir, "artboards.pdf"), paper: "artboard", selector: "[data-graphic-artboard]", signal: AbortSignal.timeout(45_000) })).rejects.toMatchObject({ code: "mixed_page_sizes" });
      expect(await readdir(stagedDir)).toEqual(["index.html"]);
    } finally { await rm(stagedDir, { recursive: true, force: true }); }
  }, 60_000);

  test("Given a uniform card news set When paged Then every page is the artboard size in points", () => {
    // Given
    const artboards = Array.from({ length: 6 }, () => ({ width: 1080, height: 1350 }));

    // When
    const points = artboards.map((artboard) => pdfPointsForPaper("artboard", artboard));

    // Then
    expect(points).toEqual(Array.from({ length: 6 }, () => ({ width: 810, height: 1012.5 })));
    expect(pdfDimensionsForPaper("artboard", { width: 1080, height: 1350 })).toEqual({ width: "11.25in", height: "14.0625in" });
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

function artboardHtml(artboards: readonly { readonly width: number; readonly height: number }[]): string {
  return `<!doctype html><html><head><style>html,body{margin:0;min-width:1280px;min-height:720px}[data-graphic-artboard]{margin:32px;background:white;padding:32px;box-sizing:border-box}[data-graphic-artboard]>div{width:50%;height:50%;background:#2468ac}</style></head><body>${artboards.map(({ width, height }) => `<section data-graphic-artboard style="width:${width}px;height:${height}px"><div></div></section>`).join("")}</body></html>`;
}
