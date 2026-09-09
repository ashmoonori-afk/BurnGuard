import { readFile, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import type { PdfPaper } from "@bg/shared";
import { PDF_PRINT_CSS, pdfDimensionsForPaper, pdfPointsForPaper } from "./export-pdf-contract";
import { openRenderSession, RenderSessionError, type RenderPhase } from "./export-render-session";
import { validatePdf, type PdfValidation } from "./export-pdf-validation";

export class PdfExportError extends Error {
  readonly name = "PdfExportError";
  constructor(readonly code: "chromium_not_installed" | "chromium_launch_timeout" | "deck_not_ready" | "render_failed", message: string) { super(message); }
}

export async function renderDeckToPdf(input: {
  readonly stagedDir: string;
  readonly entrypoint: string;
  readonly outputPath: string;
  readonly paper?: PdfPaper;
  readonly title?: string;
  readonly signal?: AbortSignal;
  readonly onPhase?: (phase: RenderPhase) => void;
}): Promise<PdfValidation> {
  const controller = input.signal === undefined ? new AbortController() : null;
  const signal = input.signal ?? controller?.signal;
  if (signal === undefined) throw new PdfExportError("render_failed", "Abort signal unavailable");
  let session;
  try {
    session = await openRenderSession({ stagedDir: input.stagedDir, entrypoint: input.entrypoint, viewport: { width: 1280, height: 720, dpr: 1 }, deck: true, signal, ...(input.onPhase === undefined ? {} : { onPhase: input.onPhase }) });
  } catch (error) {
    if (error instanceof RenderSessionError) throw new PdfExportError(error.code === "render_aborted" ? "render_failed" : error.code, error.message);
    throw error;
  }
  try {
    const title = input.title ?? await session.page.title();
    await session.page.evaluate((value) => { document.title = value; }, title);
    await session.page.addStyleTag({ content: PDF_PRINT_CSS });
    const preflight = await session.page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-slide]")].map((slide) => {
      const bounds = slide.getBoundingClientRect();
      const clipped = [...slide.querySelectorAll<HTMLElement>("*")].some((element) => {
        const style = getComputedStyle(element); if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
        const rect = element.getBoundingClientRect(); return rect.right > bounds.right + 1 || rect.bottom > bounds.bottom + 1 || rect.left < bounds.left - 1 || rect.top < bounds.top - 1;
      });
      return { width: bounds.width, height: bounds.height, clipped };
    }));
    if (preflight.some((slide) => slide.clipped || slide.width <= 0 || slide.height <= 0)) throw new PdfExportError("render_failed", "Slide content is clipped");
    const paper = input.paper ?? "a4"; const dimensions = pdfDimensionsForPaper(paper); const combined = await PDFDocument.create();
    const slideDisplays = await session.page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-slide]")].map((slide) => ({ value: slide.style.getPropertyValue("display"), priority: slide.style.getPropertyPriority("display") })));
    for (let index = 0; index < preflight.length; index += 1) {
      await session.page.evaluate(({ pageIndex, displays }) => {
        for (const [slideIndex, slide] of [...document.querySelectorAll<HTMLElement>("[data-slide]")].entries()) {
          slide.toggleAttribute("data-bg-export-page", slideIndex === pageIndex);
          // Inline importance keeps authored print selectors from exposing every slide.
          const original = displays[slideIndex];
          if (slideIndex !== pageIndex) slide.style.setProperty("display", "none", "important");
          else if (original?.value) slide.style.setProperty("display", original.value, original.priority);
          else slide.style.removeProperty("display");
        }
      }, { pageIndex: index, displays: slideDisplays });
      const pageBytes = await session.page.pdf({ format: dimensions.format, width: dimensions.width, height: dimensions.height, landscape: dimensions.format !== undefined, printBackground: true, preferCSSPageSize: false, displayHeaderFooter: false });
      const part = await PDFDocument.load(pageBytes); const copied = await combined.copyPages(part, part.getPageIndices()); for (const page of copied) combined.addPage(page);
    }
    combined.setTitle(title); combined.setProducer("BurnGuard"); await writeFile(input.outputPath, await combined.save({ useObjectStreams: false }));
    const points = pdfPointsForPaper(paper);
    return await validatePdf({ bytes: new Uint8Array(await readFile(input.outputPath)), context: session.context, expectedPages: preflight.length, expectedWidthPoints: points.width, expectedHeightPoints: points.height, expectedTitle: title, signal });
  } catch (error) {
    if (error instanceof PdfExportError) throw error;
    throw new PdfExportError("render_failed", error instanceof Error ? error.message : String(error));
  } finally { await session.close(); }
}
