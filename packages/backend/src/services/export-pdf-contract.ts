import type { PdfPaper } from "@bg/shared";

export const PDF_RASTER_SCALE = 2;
export const PDF_MAX_PAGE_PIXELS = 16_000_000;
export const PDF_MAX_EXPECTED_PIXELS = 64_000_000;
export const PDF_POINT_TOLERANCE = 1;
export const PDF_EDGE_TOLERANCE_PIXELS = 1;
export const PDF_CLIPPED_PAINT_RATIO = 0.25;
export const PDF_PAPER_POINTS: Readonly<Record<Exclude<PdfPaper, "artboard">, { readonly width: number; readonly height: number }>> = {
  a4: { width: 841.89, height: 595.28 },
  letter: { width: 792, height: 612 },
  "widescreen-16x9": { width: 959.976, height: 540 },
};

export const PDF_PRINT_CSS = `
html, body { margin: 0 !important; padding: 0 !important; background: #ffffff !important; }
[data-deck-nav], [data-deck-nav-style] { display: none !important; }
[data-slide], [data-graphic-artboard] { display: block !important; overflow: hidden !important; box-sizing: border-box !important; page-break-after: always; break-after: page; page-break-inside: avoid; break-inside: avoid; }
[data-slide] { width: 100vw !important; height: 100vh !important; min-height: 0 !important; max-height: 100vh !important; }
[data-bg-export-page] { display: block !important; }
[data-slide]:last-of-type, [data-graphic-artboard]:last-of-type { page-break-after: auto; break-after: auto; }
`;
export type PdfArtboardDimensions = { readonly width: number; readonly height: number };
export type PdfPageDimensions = { readonly format?: "A4" | "Letter"; readonly width?: string; readonly height?: string };
export class PdfContractError extends Error { readonly name = "PdfContractError"; constructor(readonly code: "artboard_dimensions_required") { super(code); } }

export function pdfDimensionsForPaper(paper: PdfPaper, artboard?: PdfArtboardDimensions): PdfPageDimensions {
  switch (paper) {
    case "letter": return { format: "Letter" };
    case "widescreen-16x9": return { width: "13.333in", height: "7.5in" };
    case "a4": return { format: "A4" };
    case "artboard": {
      const points = artboardPoints(artboard);
      return { width: `${points.width}pt`, height: `${points.height}pt` };
    }
  }
}
export function pdfPointsForPaper(paper: PdfPaper, artboard?: PdfArtboardDimensions): { readonly width: number; readonly height: number } {
  switch (paper) {
    case "a4":
    case "letter":
    case "widescreen-16x9":
      return PDF_PAPER_POINTS[paper];
    case "artboard":
      return artboardPoints(artboard);
  }
}
function artboardPoints(artboard: PdfArtboardDimensions | undefined): PdfArtboardDimensions {
  if (artboard === undefined) throw new PdfContractError("artboard_dimensions_required");
  return { width: artboard.width * 0.75, height: artboard.height * 0.75 };
}
export function pdfRasterDimensions(widthPoints: number, heightPoints: number): { readonly width: number; readonly height: number } { return { width: Math.ceil(widthPoints * PDF_RASTER_SCALE), height: Math.ceil(heightPoints * PDF_RASTER_SCALE) }; }
export function pdfRasterBudgetFits(widthPoints: number, heightPoints: number, pages: number): boolean {
  if (!Number.isSafeInteger(pages) || pages <= 0) return false;
  return pdfRasterBudgetFitsPages(Array.from({ length: pages }, () => ({ width: widthPoints, height: heightPoints })));
}
export function pdfRasterBudgetFitsPages(pages: readonly PdfArtboardDimensions[]): boolean {
  if (pages.length === 0) return false;
  let total = 0;
  for (const page of pages) {
    const { width, height } = pdfRasterDimensions(page.width, page.height); const pixels = width * height;
    if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > PDF_MAX_PAGE_PIXELS) return false;
    total += pixels;
    if (!Number.isSafeInteger(total) || total > PDF_MAX_EXPECTED_PIXELS) return false;
  }
  return true;
}
export function pdfPointsMatchPaper(paper: PdfPaper, width: number, height: number, artboard?: PdfArtboardDimensions): boolean { const expected = pdfPointsForPaper(paper, artboard); return Math.abs(width - expected.width) <= PDF_POINT_TOLERANCE && Math.abs(height - expected.height) <= PDF_POINT_TOLERANCE; }
export function isPdfSingleEdgeClipped(bounds: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }, width: number, height: number, painted: number, pixels: number): boolean {
  const near = PDF_EDGE_TOLERANCE_PIXELS; const edges = [bounds.left <= near, bounds.top <= near, bounds.right >= width - near - 1, bounds.bottom >= height - near - 1];
  return edges.filter(Boolean).length === 1 && painted / pixels < PDF_CLIPPED_PAINT_RATIO;
}
