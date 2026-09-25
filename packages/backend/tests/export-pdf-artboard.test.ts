import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { ARTBOARD_PRINT_CSS, assertUniformArtboardPages, PdfExportError, renderDeckToPdf } from "../src/services/export-pdf";
import { pdfDimensionsForPaper, pdfPointsForPaper, pdfRasterBudgetFitsPages } from "../src/services/export-pdf-contract";
import { createCanvas, getDocument } from "../src/services/export-native-modules";

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

describe("deck PDF layout", () => {
  test("Given a deck slide authored as a two-column grid When exported to widescreen PDF Then the right-column box stays in the right half", async () => {
    // Given
    const stagedDir = await mkdtemp(path.join(tmpdir(), "bg-deck-pdf-grid-"));
    try {
      await writeFile(path.join(stagedDir, "index.html"), twoColumnDeckHtml);
      const outputPath = path.join(stagedDir, "deck.pdf");

      // When
      await renderDeckToPdf({ stagedDir, entrypoint: "index.html", outputPath, paper: "widescreen-16x9", title: "Columns", signal: AbortSignal.timeout(45_000) });

      // Then
      for (const page of await rasterizePdf(outputPath)) {
        const left = centroid(page, [0xe0, 0x30, 0x50]); const right = centroid(page, [0x30, 0x50, 0xe0]);
        expect(left.count).toBeGreaterThan(0); expect(right.count).toBeGreaterThan(0);
        expect(left.x).toBeLessThan(page.width / 2); expect(right.x).toBeGreaterThan(page.width / 2);
        expect(Math.abs(left.y - right.y)).toBeLessThanOrEqual(2);
      }
    } finally { await rm(stagedDir, { recursive: true, force: true }); }
  }, 60_000);

  test("Given transparent slides over a dark page background When exported to widescreen PDF Then the page prints the authored background And a slide painting its own white stays white", async () => {
    // Given
    const stagedDir = await mkdtemp(path.join(tmpdir(), "bg-deck-pdf-background-"));
    try {
      await writeFile(path.join(stagedDir, "index.html"), darkDeckHtml);
      const outputPath = path.join(stagedDir, "deck.pdf");

      // When
      await renderDeckToPdf({ stagedDir, entrypoint: "index.html", outputPath, paper: "widescreen-16x9", title: "Dark", signal: AbortSignal.timeout(45_000) });

      // Then
      const [dark, white] = await rasterizePdf(outputPath);
      if (dark === undefined || white === undefined) throw new TypeError("expected two PDF pages");
      for (const [channel, value] of [17, 18, 20].entries()) expect(Math.abs((pixelAt(dark, dark.width / 2, 4)[channel] ?? -255) - value)).toBeLessThanOrEqual(2);
      expect(pixelAt(white, white.width / 2, 4).slice(0, 3)).toEqual([255, 255, 255]);
    } finally { await rm(stagedDir, { recursive: true, force: true }); }
  }, 60_000);
});

/** A dark page background under a transparent slide, then a slide that paints its own white background. */
const darkDeckHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Dark</title><style>html,body{margin:0;background:#111214;color:#f4f4ee;font-family:sans-serif}body[data-deck-ready] .slide:not([data-active]){display:none}.slide{width:100vw;height:100vh;padding:80px;box-sizing:border-box}h1{margin:0;font-size:120px}</style><script src="/runtime/deck-stage.js" defer></script></head><body><section data-slide class="slide"><h1>Dark</h1></section><section data-slide class="slide" style="background:#ffffff;color:#111214"><h1>Light</h1></section></body></html>`;

/** Two gated grid slides: the gate hides inactive slides the way the slide-deck template does. */
const twoColumnDeckHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Columns</title><style>html,body{margin:0}body[data-deck-ready] .slide:not([data-active]){display:none}.slide{width:100vw;height:100vh;display:grid;grid-template-columns:1fr 1fr;align-items:center;justify-items:center;background:#ffffff;box-sizing:border-box;padding:40px}.box{width:200px;height:200px}</style><script src="/runtime/deck-stage.js" defer></script></head><body>${Array.from({ length: 2 }, () => '<section data-slide class="slide"><div class="box" style="background:#e03050"></div><div class="box" style="background:#3050e0"></div></section>').join("")}</body></html>`;

type Raster = { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray };

/** Rasterises every page; the default 4/3 scale maps PDF points back to CSS pixels. */
async function rasterizePdf(file: string, scale = 4 / 3): Promise<readonly Raster[]> {
  const pdf = await getDocument({ data: new Uint8Array(await readFile(file)) }).promise;
  try {
    const pages: Raster[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number); const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height)); const canvasContext = canvas.getContext("2d");
      await Reflect.get(Reflect.apply(page.render, page, [{ canvas, canvasContext, viewport }]), "promise");
      pages.push({ width: canvas.width, height: canvas.height, data: canvasContext.getImageData(0, 0, canvas.width, canvas.height).data });
    }
    return pages;
  } finally { await pdf.destroy(); }
}

function pixelAt(raster: Raster, x: number, y: number): readonly number[] { const offset = (Math.round(y) * raster.width + Math.round(x)) * 4; return Array.from(raster.data.subarray(offset, offset + 4)); }

function centroid(raster: Raster, rgb: readonly [number, number, number], tolerance = 24): { readonly x: number; readonly y: number; readonly count: number } {
  let x = 0; let y = 0; let count = 0;
  for (let offset = 0; offset < raster.data.length; offset += 4) {
    if (rgb.every((value, channel) => Math.abs((raster.data[offset + channel] ?? -255) - value) <= tolerance)) { x += (offset / 4) % raster.width; y += Math.floor(offset / 4 / raster.width); count += 1; }
  }
  return { x: count === 0 ? -1 : x / count, y: count === 0 ? -1 : y / count, count };
}

function artboardHtml(artboards: readonly { readonly width: number; readonly height: number }[]): string {
  return `<!doctype html><html><head><style>html,body{margin:0;min-width:1280px;min-height:720px}[data-graphic-artboard]{margin:32px;background:white;padding:32px;box-sizing:border-box}[data-graphic-artboard]>div{width:50%;height:50%;background:#2468ac}</style></head><body>${artboards.map(({ width, height }) => `<section data-graphic-artboard style="width:${width}px;height:${height}px"><div></div></section>`).join("")}</body></html>`;
}
