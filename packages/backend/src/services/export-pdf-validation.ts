import type { BrowserContext } from "playwright-core";
import { getDocument } from "./export-native-modules";
import { PDF_POINT_TOLERANCE } from "./export-pdf-contract";
import { assertPdfRasterBudget, PdfRasterError, rasterizePdfPage, type PdfContentBounds, type PdfPixelStatistics, type PdfRasterObservation, type PdfRasterPage } from "./export-pdf-raster";

const MAX_PAGES = 100; const MAX_DIMENSION_POINTS = 2_000; const MAX_OPERATORS = 1_000_000; const RASTER_TIMEOUT_MS = 60_000;
export type PdfPageObservation = { readonly page: number; readonly width_points: number; readonly height_points: number; readonly operators: number; readonly raster_width: number; readonly raster_height: number; readonly statistics: PdfPixelStatistics; readonly content_bounds: PdfContentBounds | null };
export type PdfValidation = { readonly pages: number; readonly title: string; readonly observations: readonly PdfPageObservation[] };
export class PdfValidationError extends Error { readonly name = "PdfValidationError"; constructor(readonly code: "invalid_pdf" | "page_count" | "page_dimensions" | "metadata" | "blank_page" | "clipped_page" | "raster_limit" | "raster_aborted", message: string = code) { super(message); } }

type PdfPage = PdfRasterPage & { readonly getViewport: (input: { readonly scale: number }) => { readonly width: number; readonly height: number }; readonly getOperatorList: () => Promise<{ readonly fnArray: ArrayLike<unknown> }>; readonly cleanup: () => void };
type PdfDocument = { readonly numPages: number; readonly getMetadata: () => Promise<{ readonly info: unknown }>; readonly getPage: (page: number) => Promise<PdfPage>; readonly destroy: () => Promise<void> };
type PdfLoading = { readonly promise: Promise<PdfDocument>; readonly destroy: () => Promise<void> };
export type PdfValidationDeps = { readonly load: (bytes: Uint8Array) => PdfLoading; readonly raster: (page: PdfPage, signal: AbortSignal) => Promise<PdfRasterObservation>; readonly deadlineMs?: number };

export async function validatePdf(input: { readonly bytes: Uint8Array; readonly context: BrowserContext; readonly expectedPages: number; readonly expectedWidthPoints: number; readonly expectedHeightPoints: number; readonly expectedTitle: string; readonly signal?: AbortSignal }, deps: PdfValidationDeps = defaults): Promise<PdfValidation> {
  if (input.bytes.length < 8 || new TextDecoder().decode(input.bytes.subarray(0, 5)) !== "%PDF-") throw new PdfValidationError("invalid_pdf");
  if (input.expectedPages <= 0 || input.expectedPages > MAX_PAGES) throw new PdfValidationError("page_count");
  if (input.expectedWidthPoints <= 0 || input.expectedHeightPoints <= 0 || input.expectedWidthPoints > MAX_DIMENSION_POINTS || input.expectedHeightPoints > MAX_DIMENSION_POINTS) throw new PdfValidationError("page_dimensions");
  assertPdfRasterBudget(input.expectedWidthPoints, input.expectedHeightPoints, input.expectedPages); void input.context;
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), deps.deadlineMs ?? RASTER_TIMEOUT_MS); const callerAbort = (): void => controller.abort(); let callerListener = false;
  if (input.signal?.aborted === true) controller.abort(); else if (input.signal !== undefined) { input.signal.addEventListener("abort", callerAbort, { once: true }); callerListener = true; }
  let loading: PdfLoading | null = null; let document: PdfDocument | null = null; let loadingDestroyPromise: Promise<void> | null = null; let documentDestroyPromise: Promise<void> | null = null; let primaryError: unknown = null;
  const observe = (promise: Promise<void> | null): void => { if (promise !== null) void promise.catch(() => {}); };
  const destroyLoading = (): Promise<void> | null => { if (loading === null) return null; if (loadingDestroyPromise === null) { let resolve!: () => void; let reject!: (error: unknown) => void; loadingDestroyPromise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); observe(loadingDestroyPromise); try { void Promise.resolve(loading.destroy()).then(resolve, reject); } catch (error) { reject(error); } } return loadingDestroyPromise; };
  const destroyDocument = (): Promise<void> | null => { if (document === null) return null; if (documentDestroyPromise === null) { let resolve!: () => void; let reject!: (error: unknown) => void; documentDestroyPromise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); observe(documentDestroyPromise); try { void Promise.resolve(document.destroy()).then(resolve, reject); } catch (error) { reject(error); } } return documentDestroyPromise; };
  const abortOwned = (): void => { observe(destroyLoading()); observe(destroyDocument()); }; controller.signal.addEventListener("abort", abortOwned, { once: true });
  try {
    loading = deps.load(Uint8Array.from(input.bytes)); if (controller.signal.aborted) abortOwned(); document = await acquireOwnedDocument(loading.promise, controller.signal, (owned) => { document = owned; if (controller.signal.aborted) observe(destroyDocument()); }); if (controller.signal.aborted) abortOwned();
    if (document.numPages !== input.expectedPages || document.numPages === 0 || document.numPages > MAX_PAGES) throw new PdfValidationError("page_count", `Expected ${input.expectedPages} PDF pages, received ${document.numPages}`);
    const metadata = await bounded(document.getMetadata(), controller.signal); const metadataTitle = typeof metadata.info === "object" && metadata.info !== null ? Reflect.get(metadata.info, "Title") : undefined; const title = typeof metadataTitle === "string" ? metadataTitle : ""; if (title !== input.expectedTitle) throw new PdfValidationError("metadata");
    const observations: PdfPageObservation[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const ownedPage = await acquireOwnedPage(document.getPage(number), controller.signal); const page = ownedPage.page;
      try {
        const viewport = page.getViewport({ scale: 1 }); if (!finiteDimension(viewport.width) || !finiteDimension(viewport.height) || Math.abs(viewport.width - input.expectedWidthPoints) > PDF_POINT_TOLERANCE || Math.abs(viewport.height - input.expectedHeightPoints) > PDF_POINT_TOLERANCE) throw new PdfValidationError("page_dimensions");
        const operators = (await bounded(page.getOperatorList(), controller.signal)).fnArray.length; if (!Number.isSafeInteger(operators) || operators < 0 || operators > MAX_OPERATORS) throw new PdfValidationError("raster_limit");
        const rasterPromise = deps.raster(page, controller.signal); let raster: PdfRasterObservation; try { raster = await bounded(rasterPromise, controller.signal); } catch (error) { if (controller.signal.aborted) await Promise.allSettled([rasterPromise]); throw error; } observations.push({ page: number, width_points: viewport.width, height_points: viewport.height, operators, ...raster });
      } finally { ownedPage.cleanup(); }
    }
    return { pages: document.numPages, title, observations };
  } catch (error) {
    const mapped = mapError(error, controller.signal); primaryError = mapped; throw mapped;
  } finally {
    clearTimeout(timeout); controller.signal.removeEventListener("abort", abortOwned); if (callerListener) input.signal?.removeEventListener("abort", callerAbort);
    const outcomes = await awaitMemoizedDestruction(destroyDocument, destroyLoading);
    if (primaryError === null) { const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected"); if (rejected !== undefined) throw rejected.reason; }
  }
}
async function awaitMemoizedDestruction(destroyDocument: () => Promise<void> | null, destroyLoading: () => Promise<void> | null): Promise<PromiseSettledResult<void>[]> {
  const started = [destroyDocument(), destroyLoading()].filter((promise): promise is Promise<void> => promise !== null);
  const outcomes = await Promise.allSettled(started); const lateDocument = destroyDocument();
  if (lateDocument !== null && !started.includes(lateDocument)) outcomes.push(...await Promise.allSettled([lateDocument]));
  return outcomes;
}
type OwnedPage = { readonly page: PdfPage; readonly cleanup: () => void };
function acquireOwnedPage(raw: Promise<PdfPage>, signal: AbortSignal): Promise<OwnedPage> { return new Promise((resolve, reject) => { let settled = false; const abort = (): void => { if (settled) return; settled = true; reject(new PdfValidationError("raster_aborted")); }; if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true }); raw.then((page) => { let cleaned = false; const cleanup = (): void => { if (cleaned) return; cleaned = true; page.cleanup(); }; if (signal.aborted || settled) { cleanup(); if (!settled) { settled = true; reject(new PdfValidationError("raster_aborted")); } return; } settled = true; signal.removeEventListener("abort", abort); resolve({ page, cleanup }); }, (error) => { if (settled) return; settled = true; signal.removeEventListener("abort", abort); reject(error); }); }); }
function acquireOwnedDocument(raw: Promise<PdfDocument>, signal: AbortSignal, own: (document: PdfDocument) => void): Promise<PdfDocument> { return new Promise((resolve, reject) => { let settled = false; const abort = (): void => { if (settled) return; settled = true; reject(new PdfValidationError("raster_aborted")); }; if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true }); raw.then((document) => { own(document); if (signal.aborted || settled) { if (!settled) { settled = true; reject(new PdfValidationError("raster_aborted")); } return; } settled = true; signal.removeEventListener("abort", abort); resolve(document); }, (error) => { if (settled) return; settled = true; signal.removeEventListener("abort", abort); reject(error); }); }); }
function mapError(error: unknown, signal: AbortSignal): Error { if (signal.aborted) return new PdfValidationError("raster_aborted"); if (error instanceof PdfValidationError) return error; if (error instanceof PdfRasterError) return new PdfValidationError(error.code, error.message); return new PdfValidationError("invalid_pdf", error instanceof Error ? error.message : String(error)); }
async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> { if (signal.aborted) throw new PdfValidationError("raster_aborted"); return new Promise<T>((resolve, reject) => { const abort = (): void => reject(new PdfValidationError("raster_aborted")); signal.addEventListener("abort", abort, { once: true }); promise.then((value) => { signal.removeEventListener("abort", abort); resolve(value); }, (error) => { signal.removeEventListener("abort", abort); reject(error); }); }); }
function finiteDimension(value: number): boolean { return Number.isFinite(value) && value > 0 && value <= MAX_DIMENSION_POINTS; }
const defaults: PdfValidationDeps = { load: (bytes) => getDocument({ data: bytes }), raster: (page, signal) => rasterizePdfPage(page, signal) };
