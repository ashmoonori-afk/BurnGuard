import { readFile, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import type { PdfPaper } from "@bg/shared";
import { PDF_PRINT_CSS, pdfDimensionsForPaper, pdfPointsForPaper, pdfRasterBudgetFitsPages } from "./export-pdf-contract";
import { capturePageFromSession } from "./export-frame-capture";
import { openRenderSession, RenderSessionError, type RenderPhase, type RenderSession } from "./export-render-session";
import { validatePdf, type PdfValidation } from "./export-pdf-validation";

/** Stacked artboards carry layout spacing and page minimums that would print as blank pages. */
export const ARTBOARD_PRINT_CSS = `
html, body { min-width: 0 !important; min-height: 0 !important; }
[data-graphic-artboard] { margin: 0 !important; }
`;
const ARTBOARD_SIZE_TOLERANCE = 1;

export class PdfExportError extends Error {
  readonly name = "PdfExportError";
  constructor(readonly code: "chromium_not_installed" | "chromium_launch_timeout" | "deck_not_ready" | "render_failed" | "resource_limit" | "mixed_page_sizes", message: string) { super(message); }
}

/** Artboard paper prints one page per artboard, so a set with more than one size has no single page geometry. */
export function assertUniformArtboardPages(pages: readonly { readonly width: number; readonly height: number }[]): void {
  const first = pages[0];
  if (first === undefined) throw new PdfExportError("render_failed", "Export pages are missing or clipped");
  const mixed = pages.find((page) => Math.abs(page.width - first.width) > ARTBOARD_SIZE_TOLERANCE || Math.abs(page.height - first.height) > ARTBOARD_SIZE_TOLERANCE);
  if (mixed !== undefined) throw new PdfExportError("mixed_page_sizes", `Artboard PDF requires one page size; found ${first.width}x${first.height} and ${mixed.width}x${mixed.height}`);
}

export async function renderDeckToPdf(input: {
  readonly stagedDir: string;
  readonly entrypoint: string;
  readonly outputPath: string;
  readonly paper?: PdfPaper;
  readonly selector?: "[data-slide]" | "[data-graphic-artboard]";
  readonly title?: string;
  readonly signal?: AbortSignal;
  readonly onPhase?: (phase: RenderPhase) => void;
}): Promise<PdfValidation> {
  const controller = input.signal === undefined ? new AbortController() : null;
  const signal = input.signal ?? controller?.signal;
  if (signal === undefined) throw new PdfExportError("render_failed", "Abort signal unavailable");
  let session: RenderSession;
  try {
    session = await openRenderSession({ stagedDir: input.stagedDir, entrypoint: input.entrypoint, viewport: { width: 1280, height: 720, dpr: 1 }, deck: (input.selector ?? "[data-slide]") === "[data-slide]", signal, ...(input.onPhase === undefined ? {} : { onPhase: input.onPhase }) });
  } catch (error) {
    if (error instanceof RenderSessionError) throw new PdfExportError(error.code === "render_aborted" ? "render_failed" : error.code, error.message);
    throw error;
  }
  try {
    const title = input.title ?? await session.page.title();
    await session.page.evaluate((value) => { document.title = value; }, title);
    await session.page.addStyleTag({ content: PDF_PRINT_CSS });
    const selector = input.selector ?? "[data-slide]";
    if (selector === "[data-graphic-artboard]") {
      await session.page.addStyleTag({ content: ARTBOARD_PRINT_CSS });
      await capturePageFromSession(session.page).awaitRenderReady();
    }
    const preflight = await session.page.evaluate((elementSelector) => [...document.querySelectorAll<HTMLElement>(elementSelector)].map((slide) => {
      const bounds = slide.getBoundingClientRect();
      const clipped = [...slide.querySelectorAll<HTMLElement>("*")].some((element) => {
        const style = getComputedStyle(element); if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
        const rect = element.getBoundingClientRect(); return rect.right > bounds.right + 1 || rect.bottom > bounds.bottom + 1 || rect.left < bounds.left - 1 || rect.top < bounds.top - 1;
      });
      return { width: bounds.width, height: bounds.height, clipped };
    }), selector);
    if (preflight.length === 0 || preflight.some((slide) => slide.clipped || slide.width <= 0 || slide.height <= 0)) throw new PdfExportError("render_failed", "Export pages are missing or clipped");
    const paper = input.paper ?? "a4";
    if (paper === "artboard") assertUniformArtboardPages(preflight);
    const pagePoints = paper === "artboard"
      ? preflight.map((page) => pdfPointsForPaper(paper, page))
      : preflight.map(() => pdfPointsForPaper(paper));
    if (!pdfRasterBudgetFitsPages(pagePoints)) throw new PdfExportError("resource_limit", "PDF raster budget exceeded before rendering");
    const combined = await PDFDocument.create();
    const slideDisplays = await session.page.evaluate((elementSelector) => [...document.querySelectorAll<HTMLElement>(elementSelector)].map((slide) => ({ value: slide.style.getPropertyValue("display"), priority: slide.style.getPropertyPriority("display") })), selector);
    for (let index = 0; index < preflight.length; index += 1) {
      await session.page.evaluate(({ pageIndex, displays, elementSelector }) => {
        for (const [slideIndex, slide] of [...document.querySelectorAll<HTMLElement>(elementSelector)].entries()) {
          slide.toggleAttribute("data-bg-export-page", slideIndex === pageIndex);
          // Inline importance keeps authored print selectors from exposing every slide.
          const original = displays[slideIndex];
          if (slideIndex !== pageIndex) slide.style.setProperty("display", "none", "important");
          else if (original?.value) slide.style.setProperty("display", original.value, original.priority);
          else slide.style.removeProperty("display");
        }
      }, { pageIndex: index, displays: slideDisplays, elementSelector: selector });
      const dimensions = pdfDimensionsForPaper(paper, preflight[index]);
      const pageBytes = await session.page.pdf({ format: dimensions.format, width: dimensions.width, height: dimensions.height, landscape: dimensions.format !== undefined, printBackground: true, preferCSSPageSize: false, displayHeaderFooter: false });
      const part = await PDFDocument.load(pageBytes); const copied = await combined.copyPages(part, part.getPageIndices()); for (const page of copied) combined.addPage(page);
    }
    combined.setTitle(title); combined.setProducer("BurnGuard"); await writeFile(input.outputPath, await combined.save({ useObjectStreams: false }));
    const firstPoints = pagePoints[0];
    if (firstPoints === undefined) throw new PdfExportError("render_failed", "PDF page geometry unavailable");
    return await validatePdf({ bytes: new Uint8Array(await readFile(input.outputPath)), context: session.context, expectedPages: preflight.length, expectedWidthPoints: firstPoints.width, expectedHeightPoints: firstPoints.height, expectedPagePoints: pagePoints, expectedTitle: title, signal });
  } catch (error) {
    if (error instanceof PdfExportError) throw error;
    throw new PdfExportError("render_failed", error instanceof Error ? error.message : String(error));
  } finally { await session.close(); }
}
