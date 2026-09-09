import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "node-html-parser";
import { defaultTreeAdapter, parse as parseHtmlDocument, parseFragment, serialize, type DefaultTreeAdapterTypes } from "parse5";
import type { ExportFormat, ExportOptions, ExportProgress, ExportStopReason } from "@bg/shared";
import { getExportJob } from "../db/exports";
import { createExportAuthority, createRetryAuthority, advanceExportAttempt, completeExportAttempt, failExportAttempt, recordExportAuditFindings, requestExportCancellation, type ExportIdentity } from "../db/export-lifecycle-repository";
import { getProjectDetail } from "../db/project-read-repository";
import { getSqlite } from "../db/sqlite-client";
import { exportsDir, projectsDir, resolveManagedPath, systemsDir } from "../lib/paths";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import { ArtifactCoordinator } from "./artifact-coordinator";
import { materializeManagedTree } from "./artifact-tree-storage";
import { inspectCanonicalTree, validateCanonicalTree, type CanonicalTreeManifest } from "./canonical-tree-manifest";
import { catalogPaths, inspectCatalogTree, validateCatalogReceiptTree } from "./catalog-files";
import { resolveStaticClosure } from "./export-closure";
import { publishExportAttemptEvent } from "./export-events";
import { buildHtmlArchiveManifest, HTML_EXPORT_MANIFEST, validateHtmlArchive } from "./export-html-validation";
import { validateHandoffPackage, validatePptxPackage } from "./export-package-validation";
import { canonicalJson, parseExportReceipt, receiptDigest, sha256, type ExportReceipt } from "./export-receipt";
import type { ExportValidation } from "./export-receipt-validation";
import { auditRenderedTreeForExport } from "./design-audit";
import { prepareSlideDeckExport } from "./export-stage";
import { parseStoredProjectOptions } from "./project-options";
import { zipDirectory } from "./zip";

const RENDERER_CONTRACT = "burnguard-export/1|playwright-core@1.62.1|pdfjs-dist@5.4.149";
const active = new Map<string, AbortController>();
const DESIGN_AUDIT_TIMEOUT_MS = 30_000;
const HTML_EXPORT_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'none'; object-src 'none'; frame-src 'self' data: blob:; worker-src 'self' blob:; base-uri 'none'; form-action 'none'";
export type ExportPhase = "after_snapshot" | "after_partial_render" | "after_render" | "after_validation" | "after_receipt" | "after_publish_before_db";
export type ExportHooks = { readonly phase?: (attemptId: string, phase: ExportPhase, signal: AbortSignal) => Promise<void> | void };

export class ExportServiceError extends Error {
  readonly name = "ExportServiceError";
  constructor(readonly code: "project_not_found" | "source_changed" | "format_requires_deck" | "attempt_not_found" | "design_audit_failed" | "invalid_graphic_export_options", message: string) { super(message); }
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
  const { context } = input; const db = getSqlite(); const stageRoot = resolveWithin(exportsDir, ".staging", assertSafeName(input.attemptId)); const renderRoot = path.join(stageRoot, "render");
  const extension = context.format === "pdf" ? "pdf" : context.format === "png" ? "png" : context.format === "pptx" ? "pptx" : "zip";
  const outputFile = `artifact.${extension}`; const stagedOutput = path.join(stageRoot, outputFile); const publishedRoot = resolveWithin(exportsDir, "attempts", assertSafeName(input.attemptId));
  try {
    advance(input, "running", "snapshotting");
    const source = resolveManagedPath(projectsDir, context.project.dir_path); const live = await inspectCanonicalTree(source);
    if (live.tree_digest !== context.identity.digest) throw new ExportServiceError("source_changed", "Live project digest differs from stable identity");
    await materializeManagedTree(source, renderRoot); await validateCanonicalTree(renderRoot, live);
    if (context.project.type === "slide_deck") await prepareSlideDeckExport(renderRoot, context.project.entrypoint);
    if (context.format === "html_zip") await enforceOfflineHtmlPolicy(renderRoot, await inspectCanonicalTree(renderRoot));
    const renderManifest = await inspectCanonicalTree(renderRoot);
    const graphicCanvas = context.project.type === "graphic"
      ? parseStoredProjectOptions(context.project.options_json).graphic_canvas ?? undefined
      : undefined;
    const auditController = new AbortController();
    const abortAudit = () => auditController.abort(input.controller.signal.reason);
    if (input.controller.signal.aborted) abortAudit();
    else input.controller.signal.addEventListener("abort", abortAudit, { once: true });
    const auditTimeout = setTimeout(
      () => auditController.abort(new Error("Design audit timed out")),
      DESIGN_AUDIT_TIMEOUT_MS,
    );
    try {
      const audit = await auditRenderedTreeForExport({ projectId: context.identity.projectId, projectDir: renderRoot, entrypoint: context.project.entrypoint, revision: context.identity.revision, digest: context.identity.digest, treeDigest: renderManifest.tree_digest, safeFix: false, deck: context.project.type === "slide_deck", ...(graphicCanvas === undefined ? {} : { canvas: graphicCanvas }), signal: auditController.signal });
      const auditUnknowns = audit.checks.filter((check) => check.reason !== null).map((check) => ({ code: `design_audit:${check.code}:${check.status}`, path: null }));
      const auditFindings = audit.checks.flatMap((check) => check.findings.map((finding) => ({ code: finding.check_code, path: finding.source.rel_path }))).slice(0, 200 - auditUnknowns.length);
      recordExportAuditFindings(db, input.attemptId, [...auditFindings, ...auditUnknowns]);
      const mustFixCount = audit.checks.flatMap((check) => check.findings).filter((finding) => finding.severity === "must_fix").length;
      if (mustFixCount > 0) throw new ExportServiceError("design_audit_failed", `Design audit found ${mustFixCount} must-fix finding${mustFixCount === 1 ? "" : "s"}`);
    } finally {
      clearTimeout(auditTimeout);
      input.controller.signal.removeEventListener("abort", abortAudit);
    }
    await resolveStaticClosure(renderRoot, context.project.entrypoint, renderManifest);
    const inputDigest = sha256(canonicalJson({ schema_version: 1, project: context.identity, entrypoint: context.project.entrypoint, manifest: renderManifest }));
    advanceExportAttempt(db, { attemptId: input.attemptId, status: "running", stage: "rendering", inputClosureDigest: inputDigest, designSystemDigest: context.identity.designSystemDigest });
    emit(context.identity, input, "running", { stage: "rendering", completed: 2, total: 6 }, null); await input.hooks.phase?.(input.attemptId, "after_snapshot", input.controller.signal);
    const validation = await renderOutput(input, renderRoot, stagedOutput, renderManifest, inputDigest);
    await input.hooks.phase?.(input.attemptId, "after_partial_render", input.controller.signal); await input.hooks.phase?.(input.attemptId, "after_render", input.controller.signal); advance(input, "validating", "validating");
    const outputBytes = new Uint8Array(await readFile(stagedOutput)); const outputDigest = sha256(outputBytes); const outputInfo = await stat(stagedOutput);
    await input.hooks.phase?.(input.attemptId, "after_validation", input.controller.signal);
    const receipt: ExportReceipt = { schema_version: 1, job_id: input.jobId, attempt_id: input.attemptId, parent_attempt_id: (await getExportJob(input.jobId))?.latest_attempt?.parent_attempt_id ?? null, format: context.format, project: { id: context.identity.projectId, revision: context.identity.revision, digest: context.identity.digest }, options: context.options, output_file: outputFile, output_size: outputInfo.size, digests: { input_closure: inputDigest, design_system: context.identity.designSystemDigest, options: sha256(canonicalJson(context.options)), renderer: context.rendererDigest, capture: context.captureDigest, output: outputDigest }, validation };
    const receiptJson = canonicalJson(receipt); await writeFile(path.join(stageRoot, "receipt.json"), receiptJson);
    const rereadReceipt = parseExportReceipt(JSON.parse(await readFile(path.join(stageRoot, "receipt.json"), "utf8")));
    if (sha256(new Uint8Array(await readFile(stagedOutput))) !== outputDigest || receiptDigest(rereadReceipt) !== sha256(receiptJson)) throw new TypeError("Staged receipt verification failed");
    await input.hooks.phase?.(input.attemptId, "after_receipt", input.controller.signal); advance(input, "validating", "publishing"); await rm(renderRoot, { recursive: true, force: true }); await mkdir(path.dirname(publishedRoot), { recursive: true }); await rm(publishedRoot, { recursive: true, force: true }); await rename(stageRoot, publishedRoot);
    await input.hooks.phase?.(input.attemptId, "after_publish_before_db", input.controller.signal);
    completeExportAttempt(db, { jobId: input.jobId, attemptId: input.attemptId, outputPath: path.join(publishedRoot, outputFile), size: outputInfo.size, outputDigest, receiptDigest: sha256(receiptJson) });
    emit(context.identity, input, "validated", { stage: "complete", completed: 6, total: 6 }, null);
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true }); await rm(publishedRoot, { recursive: true, force: true });
    const cancelled = input.controller.signal.aborted; const reason: ExportStopReason = cancelled ? "user_cancelled" : error instanceof ExportServiceError && error.code === "source_changed" ? "source_changed" : error instanceof ExportServiceError && error.code === "design_audit_failed" ? "validation_failed" : "render_failed";
    failExportAttempt(db, { jobId: input.jobId, attemptId: input.attemptId, status: cancelled ? "cancelled" : "failed", reason, message: error instanceof Error ? error.message : String(error) });
    emit(context.identity, input, cancelled ? "cancelled" : "failed", { stage: "rendering", completed: 2, total: 6 }, reason);
  }
}

async function enforceOfflineHtmlPolicy(renderRoot: string, manifest: CanonicalTreeManifest): Promise<void> {
  const policy = `<meta http-equiv="Content-Security-Policy" content="${HTML_EXPORT_CSP}" data-burnguard-export-policy="offline">`;
  for (const file of manifest.files) {
    if (!/\.html?$/iu.test(file.path)) continue;
    const filePath = resolveWithin(renderRoot, file.path);
    const document = parseHtmlDocument(await readFile(filePath, "utf8"));
    const html = directElement(document.childNodes, "html");
    const head = html === null ? null : directElement(html.childNodes, "head");
    if (head === null) throw new TypeError(`HTML parser did not produce a document head for ${file.path}`);
    const fragment = parseFragment(head, policy, {});
    const meta = directElement(fragment.childNodes, "meta");
    if (meta === null) throw new TypeError(`HTML parser did not produce an export policy for ${file.path}`);
    defaultTreeAdapter.detachNode(meta);
    const first = head.childNodes[0];
    if (first === undefined) defaultTreeAdapter.appendChild(head, meta);
    else defaultTreeAdapter.insertBefore(head, meta, first);
    await writeFile(filePath, serialize(document));
  }
}

function directElement(nodes: readonly DefaultTreeAdapterTypes.ChildNode[], tagName: string): DefaultTreeAdapterTypes.Element | null {
  for (const node of nodes) {
    if (defaultTreeAdapter.isElementNode(node) && node.tagName === tagName) return node;
  }
  return null;
}

async function renderOutput(input: RunInput, renderRoot: string, outputPath: string, manifest: CanonicalTreeManifest, inputDigest: string): Promise<ExportValidation> {
  const { context } = input;
  switch (context.format) {
    case "html_zip": {
      const archiveManifest = buildHtmlArchiveManifest({ schema_version: 1, entrypoint: context.project.entrypoint, project_revision: context.identity.revision, project_digest: context.identity.digest, input_closure_digest: inputDigest }, manifest.files.map((file) => ({ path: file.path, size: file.size, sha256: file.sha256 })));
      await writeFile(path.join(renderRoot, HTML_EXPORT_MANIFEST), canonicalJson(archiveManifest)); await zipDirectory(renderRoot, outputPath); await validateHtmlArchive(new Uint8Array(await readFile(outputPath)), archiveManifest); return { entries: archiveManifest.entries.length };
    }
    case "png": {
      const { renderToPng } = await import("./export-png");
      return renderToPng({ stagedDir: renderRoot, entrypoint: context.project.entrypoint, outputPath, width: context.options.png_width ?? 1280, height: context.options.png_height ?? 720, dpr: context.options.png_dpr ?? 1, deck: context.project.type === "slide_deck", signal: input.controller.signal });
    }
    case "pdf": {
      const { renderDeckToPdf } = await import("./export-pdf");
      return renderDeckToPdf({ stagedDir: renderRoot, entrypoint: context.project.entrypoint, outputPath, paper: context.options.pdf_paper, title: `${context.project.name} r${context.identity.revision}`, signal: input.controller.signal });
    }
    case "pptx": {
      const { renderDeckToPptx } = await import("./export-pptx-render");
      await renderDeckToPptx({ stagedDir: renderRoot, entrypoint: context.project.entrypoint, outputPath, size: context.options.pptx_size, signal: input.controller.signal }); const slides = parse(await readFile(path.join(renderRoot, context.project.entrypoint), "utf8")).querySelectorAll("[data-slide]").length; return validatePptxPackage(new Uint8Array(await readFile(outputPath)), slides);
    }
    case "handoff": {
      const { renderHandoffBundle } = await import("./export-handoff-render");
      const bundle = path.join(path.dirname(renderRoot), "handoff"); await renderHandoffBundle({ stagedProjectDir: renderRoot, stagingDir: bundle, entrypoint: context.project.entrypoint, tokensSrcPath: null, tokensFileName: null, designSystemName: context.project.design_system_name, project: { id: context.project.id, name: context.project.name, type: context.project.type, entrypoint: context.project.entrypoint }, isDeck: context.project.type === "slide_deck", signal: input.controller.signal }); await zipDirectory(bundle, outputPath); return validateHandoffPackage(new Uint8Array(await readFile(outputPath)), context.project.entrypoint);
    }
  }
}

async function exportContext(projectId: string, format: ExportFormat, options: ExportOptions): Promise<Context> {
  let project = await getProjectDetail(projectId); if (project === null) throw new ExportServiceError("project_not_found", "Project not found");
  if ((format === "pdf" || format === "pptx") && project.type !== "slide_deck") throw new ExportServiceError("format_requires_deck", "Format requires a slide deck");
  if (project.type === "graphic" && format === "png") {
    const canvas = parseStoredProjectOptions(project.options_json).graphic_canvas;
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
  const rendererDigest = sha256(RENDERER_CONTRACT); const captureDigest = sha256(canonicalJson({ format, options, viewport: format === "png" ? { width: options.png_width, height: options.png_height, dpr: options.png_dpr } : { width: 1280, height: 720, dpr: 1 } }));
  return { identity: { projectId, revision: project.current_revision, digest: project.current_digest, designSystemDigest }, project, format, options, rendererDigest, captureDigest };
}

async function designDigest(id: string | null): Promise<string | null> {
  if (id === null) return null; const db = getSqlite(); const system = db.query<{ readonly dir_path: string }, [string]>("SELECT dir_path FROM design_systems WHERE id=?").get(id); if (system === null) return null;
  const paths = await catalogPaths(systemsDir, id, system.dir_path); const receipt = db.query<{ readonly digest: string; readonly manifestJson: string; readonly provenanceJson: string; readonly metadataJson: string; readonly operation: string; readonly parentDigest: string | null }, [string]>("SELECT digest,manifest_json manifestJson,provenance_json provenanceJson,metadata_json metadataJson,operation,parent_digest parentDigest FROM design_system_receipts WHERE design_system_id=? AND status='committed' ORDER BY content_revision DESC LIMIT 1").get(id);
  return receipt === null ? (await inspectCatalogTree(paths.live)).digest : (await validateCatalogReceiptTree(paths.live, receipt)).digest;
}
function advance(input: RunInput, status: "running" | "validating", stage: "snapshotting" | "validating" | "publishing"): void { advanceExportAttempt(getSqlite(), { attemptId: input.attemptId, status, stage }); emit(input.context.identity, input, status, { stage, completed: stage === "snapshotting" ? 1 : stage === "validating" ? 3 : 4, total: 6 }, null); }
function emit(identity: ExportIdentity, ids: { readonly jobId: string; readonly attemptId: string }, status: Parameters<typeof publishExportAttemptEvent>[1]["status"], progress: ExportProgress, stopReason: ExportStopReason | null): void { publishExportAttemptEvent(getSqlite(), { projectId: identity.projectId, jobId: ids.jobId, attemptId: ids.attemptId, status, progress, projectRevision: identity.revision, projectDigest: identity.digest, stopReason }); }
