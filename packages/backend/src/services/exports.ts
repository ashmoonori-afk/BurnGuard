import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "node-html-parser";
import type { ExportFormat, ExportOptions, ExportProgress, ExportStopReason } from "@bg/shared";
import { getExportJob } from "../db/exports";
import { createExportAuthority, createRetryAuthority, advanceExportAttempt, failExportAttempt, recordExportAuditFindings, requestExportCancellation, type ExportIdentity } from "../db/export-lifecycle-repository";
import { getProjectDetail } from "../db/project-read-repository";
import { getSqlite } from "../db/sqlite-client";
import { exportsDir, projectsDir, resolveManagedPath, systemsDir } from "../lib/paths";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import { ArtifactCoordinator } from "./artifact-coordinator";
import { materializeManagedTree } from "./artifact-tree-storage";
import { inspectCanonicalTree, validateCanonicalTree, type CanonicalTreeManifest } from "./canonical-tree-manifest";
import { catalogPaths, inspectCatalogTree, validateCatalogReceiptTree } from "./catalog-files";
import { resolveStaticClosure } from "./export-closure";
import { completeExportAttemptWithEvent, publishExportAttemptEvent, publishPersistedExportAttemptEvent } from "./export-events";
import { renderHandoffBundle } from "./export-handoff-render";
import { buildHtmlArchiveManifest, HTML_EXPORT_MANIFEST, validateHtmlArchive } from "./export-html-validation";
import { formatExtension } from "./export-naming";
import { validateHandoffPackage, validatePptxPackage } from "./export-package-validation";
import { assertUniformArtboardPages, PdfExportError, renderDeckToPdf } from "./export-pdf";
import { pdfPointsForPaper, pdfRasterBudgetFitsPages } from "./export-pdf-contract";
import { ExportError } from "./export-errors";
import { renderPlatformPackage } from "./export-platform-package";
import { capturePageFromSession } from "./export-frame-capture";
import { renderPngZipWithPage } from "./export-png-zip";
import type { SliceFinding } from "./export-slice-plan";
import { renderToPng } from "./export-png";
import { renderDeckToPptx } from "./export-pptx-render";
import { canonicalJson, parseExportReceipt, receiptDigest, sha256, type ExportReceipt } from "./export-receipt";
import type { ExportValidation } from "./export-receipt-validation";
import { openRenderSession } from "./export-render-session";
import { auditRenderedTree } from "./design-audit";
import { prepareSlideDeckExport } from "./export-stage";
import { parseStoredProjectOptions } from "./project-options";
import { zipDirectory } from "./zip";

const RENDERER_CONTRACT = "burnguard-export/1|playwright-core@1.59.1|pdfjs-dist@5.4.149";
const active = new Map<string, AbortController>();
export type ExportPhase = "after_snapshot" | "after_partial_render" | "after_render" | "after_validation" | "after_receipt" | "after_publish_before_db";
export type ExportHooks = { readonly phase?: (attemptId: string, phase: ExportPhase, signal: AbortSignal) => Promise<void> | void };

export type AttemptFinding = { readonly code: string; readonly path: string | null };
export const MAX_ATTEMPT_FINDINGS = 200;

/**
 * Batch renderers report per-slice findings that the design audit knows nothing about.
 * Both sets live in the one attempt findings row, so the audit set is merged, never replaced.
 */
export function recordRenderFindings(attemptId: string, audit: readonly AttemptFinding[], rendered: readonly SliceFinding[]): void {
  if (rendered.length === 0) return;
  const merged = [...audit, ...rendered.map((finding) => ({ code: `png_zip:${finding.code}`, path: `slice-${finding.slice}` }))].slice(0, MAX_ATTEMPT_FINDINGS);
  recordExportAuditFindings(getSqlite(), attemptId, merged);
}

/**
 * Platform lint reports while the attempt is still running, and on a blocking finding it reports before the
 * failure is written, so the already persisted audit set is read back and appended to instead of replaced.
 */
export function recordPlatformFindings(attemptId: string, platform: readonly AttemptFinding[]): void {
  if (platform.length === 0) return;
  const db = getSqlite();
  const persisted = JSON.parse(db.query<{ readonly findings_json: string }, [string]>("SELECT findings_json FROM export_attempts WHERE id=?").get(attemptId)?.findings_json ?? "[]") as readonly AttemptFinding[];
  recordExportAuditFindings(db, attemptId, [...persisted, ...platform].slice(0, MAX_ATTEMPT_FINDINGS));
}

/** Maps a render failure onto the attempt stop reason; cancellation is decided by the attempt row, not by the error. */
export function exportStopReason(error: unknown): ExportStopReason {
  if (error instanceof ExportServiceError) return error.code === "source_changed" ? "source_changed" : error.code === "design_audit_failed" ? "validation_failed" : "render_failed";
  if (error instanceof ExportError) return error.code === "platform_lint_failed" || error.code === "platform_package_incomplete" || error.code === "invalid_asset_destination" ? "validation_failed" : "render_failed";
  return "render_failed";
}

export class ExportServiceError extends Error {
  readonly name = "ExportServiceError";
  constructor(readonly code: "project_not_found" | "source_changed" | "format_requires_deck" | "format_requires_web" | "format_requires_frames" | "pdf_resource_limit" | "attempt_not_found" | "design_audit_failed" | "invalid_graphic_export_options", message: string) { super(message); }
}

export async function enqueueProjectExport(projectId: string, format: ExportFormat, options: ExportOptions, hooks: ExportHooks = {}) {
  const context = await exportContext(projectId, format, options);
  const ids = createExportAuthority(getSqlite(), { ...context.identity, format, options, rendererDigest: context.rendererDigest, captureDigest: context.captureDigest });
  emit(context.identity, ids, "pending", { stage: "queued", completed: 0, total: 6 }, null);
  const controller = new AbortController(); active.set(ids.attemptId, controller);
  void runExport({ ...ids, context, controller, hooks }).finally(() => active.delete(ids.attemptId));
  return getExportJob(ids.jobId);
}

export async function retryProjectExport(jobId: string, hooks: ExportHooks = {}) {
  const job = await getExportJob(jobId); if (job === null || job.latest_attempt === null) throw new ExportServiceError("attempt_not_found", "Export attempt not found");
  const context = await exportContext(job.project_id, job.format, job.options);
  const attemptId = createRetryAuthority(getSqlite(), { jobId, parentAttemptId: job.latest_attempt.id, identity: context.identity, rendererDigest: context.rendererDigest, captureDigest: context.captureDigest });
  const controller = new AbortController(); active.set(attemptId, controller);
  emit(context.identity, { jobId, attemptId }, "retrying", { stage: "queued", completed: 0, total: 6 }, null);
  void runExport({ jobId, attemptId, context, controller, hooks }).finally(() => active.delete(attemptId));
  return getExportJob(jobId);
}

export function cancelProjectExport(attemptId: string): boolean {
  const persisted = requestExportCancellation(getSqlite(), attemptId);
  if (persisted) active.get(attemptId)?.abort();
  return persisted;
}

type Context = { readonly identity: ExportIdentity; readonly project: NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>; readonly format: ExportFormat; readonly options: ExportOptions; readonly rendererDigest: string; readonly captureDigest: string };
type RunInput = { readonly jobId: string; readonly attemptId: string; readonly context: Context; readonly controller: AbortController; readonly hooks: ExportHooks };

async function runExport(input: RunInput): Promise<void> {
  const { context } = input; const db = getSqlite();
  let stageRoot: string | null = null, publishedRoot: string | null = null;
  const outputFile = `artifact.${formatExtension(context.format)}`;
  try {
    await mkdir(exportsDir, { recursive: true });
    stageRoot = resolveWithin(exportsDir, ".staging", assertSafeName(input.attemptId));
    publishedRoot = resolveWithin(exportsDir, "attempts", assertSafeName(input.attemptId));
    const renderRoot = path.join(stageRoot, "render"), stagedOutput = path.join(stageRoot, outputFile);
    advance(input, "running", "snapshotting");
    const source = resolveManagedPath(projectsDir, context.project.dir_path); const live = await inspectCanonicalTree(source);
    if (live.tree_digest !== context.identity.digest) throw new ExportServiceError("source_changed", "Live project digest differs from stable identity");
    await materializeManagedTree(source, renderRoot); await validateCanonicalTree(renderRoot, live);
    if (context.project.type === "slide_deck") await prepareSlideDeckExport(renderRoot, context.project.entrypoint);
    const renderManifest = await inspectCanonicalTree(renderRoot);
    const graphicCanvas = context.project.type === "graphic"
      ? parseStoredProjectOptions(context.project.options_json).graphic_canvas ?? undefined
      : undefined;
    let attemptFindings: readonly AttemptFinding[];
    if (context.format === "html_zip" && context.options.skip_quality_check === true) {
      attemptFindings = [{ code: "design_audit:skipped_by_user", path: null }];
      recordExportAuditFindings(db, input.attemptId, attemptFindings);
    } else {
      const audit = await auditRenderedTree({ projectId: context.identity.projectId, projectDir: renderRoot, entrypoint: context.project.entrypoint, revision: context.identity.revision, digest: context.identity.digest, treeDigest: renderManifest.tree_digest, safeFix: false, deck: context.project.type === "slide_deck", ...(graphicCanvas === undefined ? {} : { canvas: graphicCanvas }), signal: input.controller.signal });
      const auditUnknowns = audit.checks.filter((check) => check.reason !== null).map((check) => ({ code: `design_audit:${check.code}:${check.status}`, path: null }));
      const auditFindings = audit.checks.flatMap((check) => check.findings.map((finding) => ({ code: finding.check_code, path: finding.source.rel_path }))).slice(0, 200 - auditUnknowns.length);
      attemptFindings = [...auditFindings, ...auditUnknowns];
      recordExportAuditFindings(db, input.attemptId, attemptFindings);
      const mustFixCount = audit.checks.flatMap((check) => check.findings).filter((finding) => finding.severity === "must_fix").length;
      if (mustFixCount > 0) throw new ExportServiceError("design_audit_failed", `Design audit found ${mustFixCount} must-fix finding${mustFixCount === 1 ? "" : "s"}`);
    }
    await resolveStaticClosure(renderRoot, context.project.entrypoint, renderManifest);
    const inputDigest = sha256(canonicalJson({ schema_version: 1, project: context.identity, entrypoint: context.project.entrypoint, manifest: renderManifest }));
    advanceExportAttempt(db, { attemptId: input.attemptId, status: "running", stage: "rendering", inputClosureDigest: inputDigest, designSystemDigest: context.identity.designSystemDigest });
    emit(context.identity, input, "running", { stage: "rendering", completed: 2, total: 6 }, null); await input.hooks.phase?.(input.attemptId, "after_snapshot", input.controller.signal);
    input.controller.signal.throwIfAborted();
    const rendered = await renderOutput(input, renderRoot, stagedOutput, renderManifest, inputDigest);
    const validation = rendered.validation;
    recordRenderFindings(input.attemptId, attemptFindings, rendered.findings);
    await input.hooks.phase?.(input.attemptId, "after_partial_render", input.controller.signal); await input.hooks.phase?.(input.attemptId, "after_render", input.controller.signal); advance(input, "validating", "validating");
    const outputBytes = new Uint8Array(await readFile(stagedOutput)); const outputDigest = sha256(outputBytes); const outputInfo = await stat(stagedOutput);
    await input.hooks.phase?.(input.attemptId, "after_validation", input.controller.signal);
    input.controller.signal.throwIfAborted();
    const receipt: ExportReceipt = { schema_version: 1, job_id: input.jobId, attempt_id: input.attemptId, parent_attempt_id: (await getExportJob(input.jobId))?.latest_attempt?.parent_attempt_id ?? null, format: context.format, project: { id: context.identity.projectId, revision: context.identity.revision, digest: context.identity.digest }, options: context.options, output_file: outputFile, output_size: outputInfo.size, digests: { input_closure: inputDigest, design_system: context.identity.designSystemDigest, options: sha256(canonicalJson(context.options)), renderer: context.rendererDigest, capture: context.captureDigest, output: outputDigest }, validation };
    const receiptJson = canonicalJson(receipt); await writeFile(path.join(stageRoot, "receipt.json"), receiptJson);
    const rereadReceipt = parseExportReceipt(JSON.parse(await readFile(path.join(stageRoot, "receipt.json"), "utf8")));
    if (sha256(new Uint8Array(await readFile(stagedOutput))) !== outputDigest || receiptDigest(rereadReceipt) !== sha256(receiptJson)) throw new TypeError("Staged receipt verification failed");
    await input.hooks.phase?.(input.attemptId, "after_receipt", input.controller.signal);
    input.controller.signal.throwIfAborted();
    advance(input, "validating", "publishing"); for (const scratch of ["render", "handoff", "platform", "frames"] as const) await rm(path.join(stageRoot, scratch), { recursive: true, force: true }); await mkdir(path.dirname(publishedRoot), { recursive: true }); await rm(publishedRoot, { recursive: true, force: true });
    input.controller.signal.throwIfAborted();
    await rename(stageRoot, publishedRoot);
    await input.hooks.phase?.(input.attemptId, "after_publish_before_db", input.controller.signal);
    input.controller.signal.throwIfAborted();
    const outputPath = path.join(publishedRoot, outputFile);
    const completedEvent = completeExportAttemptWithEvent(db, { jobId: input.jobId, attemptId: input.attemptId, outputPath, size: outputInfo.size, outputDigest, receiptDigest: sha256(receiptJson), projectId: context.identity.projectId, projectRevision: context.identity.revision, projectDigest: context.identity.digest });
    publishPersistedExportAttemptEvent(completedEvent);
  } catch (error) {
    if (stageRoot !== null) await rm(stageRoot, { recursive: true, force: true });
    if (publishedRoot !== null) await rm(publishedRoot, { recursive: true, force: true });
    const cancelled = input.controller.signal.aborted || db.query<{ readonly requested: number }, [string]>("SELECT cancel_requested_at IS NOT NULL requested FROM export_attempts WHERE id=?").get(input.attemptId)?.requested === 1; const reason: ExportStopReason = cancelled ? "user_cancelled" : exportStopReason(error);
    failExportAttempt(db, { jobId: input.jobId, attemptId: input.attemptId, status: cancelled ? "cancelled" : "failed", reason, message: error instanceof Error ? error.message : String(error) });
    emit(context.identity, input, cancelled ? "cancelled" : "failed", { stage: "rendering", completed: 2, total: 6 }, reason);
  }
}

type RenderedOutput = { readonly validation: ExportValidation; readonly findings: readonly SliceFinding[] };

async function renderOutput(input: RunInput, renderRoot: string, outputPath: string, manifest: CanonicalTreeManifest, inputDigest: string): Promise<RenderedOutput> {
  const { context } = input;
  const only = (validation: ExportValidation): RenderedOutput => ({ validation, findings: [] });
  switch (context.format) {
    case "html_zip": {
      if (context.options.skip_quality_check !== true) {
        const session = await openRenderSession({ stagedDir: renderRoot, entrypoint: context.project.entrypoint, viewport: { width: 1280, height: 720, dpr: 1 }, deck: context.project.type === "slide_deck", signal: input.controller.signal }); await session.close();
      }
      const archiveManifest = buildHtmlArchiveManifest({ schema_version: 1, entrypoint: context.project.entrypoint, project_revision: context.identity.revision, project_digest: context.identity.digest, input_closure_digest: inputDigest }, manifest.files.map((file) => ({ path: file.path, size: file.size, sha256: file.sha256 })));
      await writeFile(path.join(renderRoot, HTML_EXPORT_MANIFEST), canonicalJson(archiveManifest)); await zipDirectory(renderRoot, outputPath); await validateHtmlArchive(new Uint8Array(await readFile(outputPath)), archiveManifest); return only({ entries: archiveManifest.entries.length });
    }
    case "png": return only(await renderToPng({ stagedDir: renderRoot, entrypoint: context.project.entrypoint, outputPath, width: context.options.png_width ?? 1280, height: context.options.png_height ?? 720, dpr: context.options.png_dpr ?? 1, deck: context.project.type === "slide_deck", signal: input.controller.signal }));
    case "pdf": return only(await renderDeckToPdf({ stagedDir: renderRoot, entrypoint: context.project.entrypoint, outputPath, paper: context.options.pdf_paper, selector: context.project.type === "graphic" ? "[data-graphic-artboard]" : "[data-slide]", title: `${context.project.name} r${context.identity.revision}`, signal: input.controller.signal }));
    case "pptx": { await renderDeckToPptx({ stagedDir: renderRoot, entrypoint: context.project.entrypoint, outputPath, size: context.options.pptx_size, signal: input.controller.signal }); const slides = parse(await readFile(path.join(renderRoot, context.project.entrypoint), "utf8")).querySelectorAll("[data-slide]").length; return only(await validatePptxPackage(new Uint8Array(await readFile(outputPath)), slides)); }
    case "handoff": { const bundle = path.join(path.dirname(renderRoot), "handoff"); await renderHandoffBundle({ stagedProjectDir: renderRoot, stagingDir: bundle, entrypoint: context.project.entrypoint, tokensSrcPath: null, tokensFileName: null, designSystemName: context.project.design_system_name, project: { id: context.project.id, name: context.project.name, type: context.project.type, entrypoint: context.project.entrypoint }, isDeck: context.project.type === "slide_deck", signal: input.controller.signal }); await zipDirectory(bundle, outputPath); return only(await validateHandoffPackage(new Uint8Array(await readFile(outputPath)), context.project.entrypoint)); }
    case "cafe24_package":
    case "imweb_package": {
      const browserSession = await openRenderSession({ stagedDir: renderRoot, entrypoint: context.project.entrypoint, viewport: { width: 1280, height: 720, dpr: 1 }, deck: false, signal: input.controller.signal });
      try { return only(await renderPlatformPackage({ stagedDir: renderRoot, outputPath, format: context.format, project: context.project, graphic_set: parseStoredProjectOptions(context.project.options_json).graphic_set, options: context.options, browserSession, receiptWriter: async () => undefined, onFindings: (findings) => { recordPlatformFindings(input.attemptId, findings); }, signal: input.controller.signal })); }
      finally { await browserSession.close(); }
    }
    case "png_zip": {
      const browserSession = await openRenderSession({ stagedDir: renderRoot, entrypoint: context.project.entrypoint, viewport: { width: 1280, height: 720, dpr: 1 }, deck: context.project.type === "slide_deck", signal: input.controller.signal });
      try { return await renderPngZipWithPage({ page: capturePageFromSession(browserSession.page), stagedDir: renderRoot, outputPath, deck: context.project.type === "slide_deck", graphic_set: parseStoredProjectOptions(context.project.options_json).graphic_set, options: context.options, receiptWriter: async () => undefined, signal: input.controller.signal }); }
      finally { await browserSession.close(); }
    }
  }
}

async function exportContext(projectId: string, format: ExportFormat, options: ExportOptions): Promise<Context> {
  let project = await getProjectDetail(projectId); if (project === null) throw new ExportServiceError("project_not_found", "Project not found");
  const projectOptions = parseStoredProjectOptions(project.options_json);
  if (format === "pdf" && options.pdf_paper === "artboard" && project.type !== "graphic") throw new ExportServiceError("invalid_graphic_export_options", "Artboard paper is only valid for graphic projects");
  if (format === "png_zip" && options.slice_format === "jpeg" && (project.type !== "graphic" || projectOptions.graphic_set.kind !== "product_detail")) throw new ExportServiceError("invalid_graphic_export_options", "JPEG slices are only valid for product detail graphics");
  if ((format === "cafe24_package" || format === "imweb_package") && (project.type === "slide_deck" || project.type === "graphic")) throw new ExportServiceError("format_requires_web", "Platform packages require a web project");
  if (format === "png_zip" && project.type !== "slide_deck" && (project.type !== "graphic" || (projectOptions.graphic_set.frame_count <= 1 && projectOptions.graphic_set.kind !== "product_detail"))) throw new ExportServiceError("format_requires_frames", "PNG ZIP requires a deck, multi-frame graphic, or product detail");
  if (format === "pptx" && project.type !== "slide_deck") throw new ExportServiceError("format_requires_deck", "Format requires a slide deck");
  if (format === "pdf" && project.type !== "slide_deck" && !(project.type === "graphic" && options.pdf_paper === "artboard")) throw new ExportServiceError("format_requires_deck", "PDF requires a slide deck or graphic artboard");
  if (format === "pdf" && project.type === "graphic") {
    const canvas = projectOptions.graphic_canvas;
    if (canvas === null) throw new ExportServiceError("invalid_graphic_export_options", "Graphic PDF requires a persisted canvas");
    const sizes = projectOptions.graphic_set.kind === "banner_set" && projectOptions.graphic_set.frames !== undefined
      ? projectOptions.graphic_set.frames
      : Array.from({ length: projectOptions.graphic_set.frame_count }, () => canvas);
    // Artboard paper prints one page per artboard, so a mixed-size set has no single page geometry (doc/14 T06).
    try { assertUniformArtboardPages(sizes); }
    catch (error) { throw error instanceof PdfExportError ? new ExportServiceError("invalid_graphic_export_options", error.message) : error; }
    const points = sizes.map((size) => pdfPointsForPaper("artboard", size));
    if (!pdfRasterBudgetFitsPages(points)) throw new ExportServiceError("pdf_resource_limit", "Graphic PDF exceeds the per-page or aggregate raster budget");
  }
  if (project.type === "graphic" && format === "png") {
    const canvas = projectOptions.graphic_canvas;
    if (
      canvas === null ||
      options.png_width !== canvas.width ||
      options.png_height !== canvas.height ||
      options.png_dpr !== 1
    ) {
      throw new ExportServiceError(
        "invalid_graphic_export_options",
        "Graphic PNG options must exactly match the persisted canvas at DPR 1",
      );
    }
  }
  const source = resolveManagedPath(projectsDir, project.dir_path); if (project.current_digest === null) { await new ArtifactCoordinator(getSqlite()).initialize(project.id, source); project = await getProjectDetail(projectId); }
  if (project === null || project.current_digest === null) throw new ExportServiceError("source_changed", "Stable project identity unavailable");
  const designSystemDigest = await designDigest(project.design_system_id);
  const rendererDigest = sha256(RENDERER_CONTRACT); const captureDigest = sha256(canonicalJson({ format, options, viewport: format === "png" || format === "png_zip" ? { width: projectOptions.graphic_canvas?.width ?? options.png_width ?? 1280, height: projectOptions.graphic_canvas?.height ?? options.png_height ?? 720, dpr: options.png_dpr ?? 1 } : { width: 1280, height: 720, dpr: 1 } }));
  return { identity: { projectId, revision: project.current_revision, digest: project.current_digest, designSystemDigest }, project, format, options, rendererDigest, captureDigest };
}

async function designDigest(id: string | null): Promise<string | null> {
  if (id === null) return null; const db = getSqlite(); const system = db.query<{ readonly dir_path: string }, [string]>("SELECT dir_path FROM design_systems WHERE id=?").get(id); if (system === null) return null;
  const paths = await catalogPaths(systemsDir, id, system.dir_path); const receipt = db.query<{ readonly digest: string; readonly manifestJson: string; readonly provenanceJson: string; readonly metadataJson: string; readonly operation: string; readonly parentDigest: string | null }, [string]>("SELECT digest,manifest_json manifestJson,provenance_json provenanceJson,metadata_json metadataJson,operation,parent_digest parentDigest FROM design_system_receipts WHERE design_system_id=? AND status='committed' ORDER BY content_revision DESC LIMIT 1").get(id);
  return receipt === null ? (await inspectCatalogTree(paths.live)).digest : (await validateCatalogReceiptTree(paths.live, receipt)).digest;
}
function advance(input: RunInput, status: "running" | "validating", stage: "snapshotting" | "validating" | "publishing"): void { advanceExportAttempt(getSqlite(), { attemptId: input.attemptId, status, stage }); emit(input.context.identity, input, status, { stage, completed: stage === "snapshotting" ? 1 : stage === "validating" ? 3 : 4, total: 6 }, null); }
function emit(identity: ExportIdentity, ids: { readonly jobId: string; readonly attemptId: string }, status: Parameters<typeof publishExportAttemptEvent>[1]["status"], progress: ExportProgress, stopReason: ExportStopReason | null): void { publishExportAttemptEvent(getSqlite(), { projectId: identity.projectId, jobId: ids.jobId, attemptId: ids.attemptId, status, progress, projectRevision: identity.revision, projectDigest: identity.digest, stopReason }); }
