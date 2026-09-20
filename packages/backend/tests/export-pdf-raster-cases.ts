import { describe, expect, test } from "bun:test";
import { PDFDocument, rgb } from "pdf-lib";
import type { BrowserContext } from "playwright-core";
import { PdfValidationError, validatePdf } from "../src/services/export-pdf-validation";

async function rasterPdf(kind: "white" | "transparent" | "one_color" | "edge_clipped" | "valid"): Promise<Uint8Array> {
  const document = await PDFDocument.create(); document.setTitle(kind); const page = document.addPage([200, 100]);
  if (kind === "white") for (let x = 0; x < 200; x += 20) page.drawRectangle({ x, y: 0, width: 20, height: 100, color: rgb(1, 1, 1) });
  if (kind === "transparent") for (let x = 0; x < 200; x += 20) page.drawRectangle({ x, y: 0, width: 20, height: 100, color: rgb(0, 0, 0), opacity: 0 });
  if (kind === "one_color") page.drawRectangle({ x: 0, y: 0, width: 200, height: 100, color: rgb(1, 0, 0) });
  if (kind === "edge_clipped") page.drawRectangle({ x: 0, y: 20, width: 60, height: 40, color: rgb(1, 0, 0) });
  if (kind === "valid") { page.drawRectangle({ x: 20, y: 20, width: 100, height: 50, color: rgb(1, 0, 0) }); page.drawRectangle({ x: 40, y: 30, width: 40, height: 20, color: rgb(0, 0, 1) }); }
  return new Uint8Array(await document.save({ useObjectStreams: false }));
}

describe("PDF raster validation", () => {
  test("Given parseable PDFs with painted operators but no meaningful raster content When validated Then each page fails closed", async () => {
    for (const kind of ["white", "transparent", "one_color"] as const) {
      const bytes = await rasterPdf(kind);
      try {
        await validatePdf({ bytes, context: {} as BrowserContext, expectedPages: 1, expectedWidthPoints: 200, expectedHeightPoints: 100, expectedTitle: kind });
        throw new TypeError(`expected ${kind} raster rejection`);
      } catch (error) {
        expect(error).toBeInstanceOf(PdfValidationError);
        expect((error as PdfValidationError).code).toBe("blank_page");
      }
    }
  });

  test("Given parseable PDF content touching a page edge When rasterized Then clipping is rejected", async () => {
    const bytes = await rasterPdf("edge_clipped");
    try {
      await validatePdf({ bytes, context: {} as BrowserContext, expectedPages: 1, expectedWidthPoints: 200, expectedHeightPoints: 100, expectedTitle: "edge_clipped" });
      throw new TypeError("expected clipped raster rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(PdfValidationError);
      expect((error as PdfValidationError).code).toBe("clipped_page");
    }
  });

  test("Given interior multicolor PDF content When rasterized Then receipt metrics include stable pixel bounds", async () => {
    const validation = await validatePdf({ bytes: await rasterPdf("valid"), context: {} as BrowserContext, expectedPages: 1, expectedWidthPoints: 200, expectedHeightPoints: 100, expectedTitle: "valid" });
    expect(validation.observations[0]).toMatchObject({ page: 1, width_points: 200, height_points: 100, raster_width: 400, raster_height: 200 });
    expect(validation.observations[0]?.statistics.differing_pixels).toBeGreaterThan(100);
    expect(validation.observations[0]?.content_bounds).toEqual({ left: 40, top: 60, right: 239, bottom: 159 });
  });
});
