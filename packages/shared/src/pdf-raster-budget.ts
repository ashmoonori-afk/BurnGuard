/**
 * PDF raster budget. Every exported PDF page is rasterised at PDF_RASTER_SCALE for validation, so
 * each page and the whole document are bounded in pixels. The backend renderer is the authority;
 * the export menu reads the same rule so it never offers a PDF the backend will refuse.
 */
export const PDF_RASTER_SCALE = 2;
export const PDF_MAX_PAGE_PIXELS = 16_000_000;
export const PDF_MAX_EXPECTED_PIXELS = 64_000_000;

export type PdfPagePoints = { readonly width: number; readonly height: number };

/** Artboard paper prints 0.75 points per CSS pixel (72 points per 96 px inch). */
export function pdfArtboardPoints(artboard: PdfPagePoints): PdfPagePoints { return { width: artboard.width * 0.75, height: artboard.height * 0.75 }; }
export function pdfRasterDimensions(widthPoints: number, heightPoints: number): { readonly width: number; readonly height: number } { return { width: Math.ceil(widthPoints * PDF_RASTER_SCALE), height: Math.ceil(heightPoints * PDF_RASTER_SCALE) }; }
export function pdfRasterBudgetFitsPages(pages: readonly PdfPagePoints[]): boolean {
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
