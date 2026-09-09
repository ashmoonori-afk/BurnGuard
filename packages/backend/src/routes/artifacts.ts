import { Hono, type Context } from "hono";
import { UpgradeContractError, parseExportOptions } from "@bg/shared";
import type {
  ApiErrorBody,
  ApiSuccess,
  ArtifactSummary,
  ExportFormat,
  ExportJob,
  FileInfo,
} from "@bg/shared";
import { buildArtifactSummary, indexProjectFiles, listIndexedProjectFiles } from "../services/files";
import { getExportAttemptDetail, getExportJob, listExportAttempts, listProjectExports } from "../db/exports";
import { ExportLifecycleError } from "../db/export-lifecycle-repository";
import { getProjectDetail } from "../db/project-read-repository";
import { isCanonicalTreeRootMissing } from "../services/canonical-tree-manifest";
import type { ExportQaPhase } from "../services/export-qa-barrier";

function ok<T>(data: T): ApiSuccess<T> {
  return { data };
}

function fail(
  code: string,
  message: string,
  details?: unknown,
): ApiErrorBody {
  return { error: { code, message, details } };
}

function isExportFormat(value: unknown): value is ExportFormat {
  return value === "html_zip" || value === "pdf" || value === "png" || value === "pptx" || value === "handoff";
}

export const artifactRoutes = new Hono();

for (const resource of ["files", "artifacts", "refresh"]) {
  artifactRoutes.use(`/api/projects/:id/${resource}`, async (c, next) => {
    const project = await getProjectDetail(c.req.param("id")!);
    if (project !== null && await isCanonicalTreeRootMissing(project.dir_path)) {
      return c.json(fail("project_directory_missing", "프로젝트 폴더를 찾을 수 없습니다. 폴더를 원래 위치로 복원한 뒤 다시 시도해 주세요."), 409);
    }
    await next();
  });
}

artifactRoutes.get("/api/projects/:id/files", async (c) => {
  const projectId = c.req.param("id");
  const project = await getProjectDetail(projectId);
  if (!project) {
    return c.json(fail("project_not_found", "Project not found", { projectId }), 404);
  }

  const files = await listIndexedProjectFiles(projectId);
  return c.json(ok(files satisfies FileInfo[]));
});

artifactRoutes.get("/api/projects/:id/artifacts", async (c) => {
  const projectId = c.req.param("id");
  const artifacts = await buildArtifactSummary(projectId);
  if (!artifacts) {
    return c.json(fail("project_not_found", "Project not found", { projectId }), 404);
  }

  return c.json(ok(artifacts satisfies ArtifactSummary));
});

artifactRoutes.post("/api/projects/:id/refresh", async (c) => {
  const projectId = c.req.param("id");
  const project = await getProjectDetail(projectId);
  if (!project) {
    return c.json(fail("project_not_found", "Project not found", { projectId }), 404);
  }

  await indexProjectFiles(projectId);
  const artifacts = await buildArtifactSummary(projectId);
  if (!artifacts) {
    return c.json(fail("project_not_found", "Project not found", { projectId }), 404);
  }
  return c.json(ok(artifacts satisfies ArtifactSummary));
});

artifactRoutes.get("/api/projects/:id/design-audit", async (c) => designAuditResponse(c.req.param("id"), false, c.req.raw.signal, c));
artifactRoutes.get("/api/projects/:id/ux-review", async (c) => {
  if (Object.keys(c.req.queries()).some((key) => key !== "path") || (c.req.queries("path")?.length ?? 0) > 1) return c.json(fail("invalid_review_path", "Only one HTML path is supported"), 400);
  const { getProjectUxReview, UxReviewError } = await import("../services/ux-review");
  try { return c.json(ok(await getProjectUxReview(c.req.param("id"), c.req.query("path")))); }
  catch (error) {
    if (!(error instanceof UxReviewError)) throw error;
    return c.json(fail(error.code, error.message), error.code === "project_not_found" ? 404 : error.code === "invalid_review_path" ? 400 : error.code === "stale_artifact_identity" ? 409 : 503);
  }
});
artifactRoutes.post("/api/projects/:id/design-audit/retry", async (c) => designAuditResponse(c.req.param("id"), true, c.req.raw.signal, c));

async function designAuditResponse(projectId: string, force: boolean, signal: AbortSignal, c: Context) {
  const { DesignAuditServiceError, getProjectDesignAudit } = await import("../services/design-audit");
  try { return c.json(ok(await getProjectDesignAudit(projectId, force, signal))); }
  catch (error) {
    if (!(error instanceof DesignAuditServiceError)) throw error;
    const status = error.code === "project_not_found" ? 404 : error.code === "stale_artifact_identity" ? 409 : 503;
    return c.json(fail(error.code, error.message), status);
  }
}

artifactRoutes.get("/api/projects/:id/exports", async (c) => {
  const projectId = c.req.param("id");
  const project = await getProjectDetail(projectId);
  if (!project) {
    return c.json(fail("project_not_found", "Project not found", { projectId }), 404);
  }

  const jobs = await listProjectExports(projectId);
  return c.json(ok(jobs satisfies ExportJob[]));
});

artifactRoutes.post("/api/projects/:id/exports", async (c) => {
  const projectId = c.req.param("id");
  const project = await getProjectDetail(projectId);
  if (!project) {
    return c.json(fail("project_not_found", "Project not found", { projectId }), 404);
  }

  const body = await c.req.json<unknown>().catch(() => null);
  const format = body && typeof body === "object" && "format" in body ? body.format : undefined;
  if (!isExportFormat(format)) {
    return c.json(fail("invalid_export_format", "Unsupported export format", { format }), 400);
  }
  if ((format === "pdf" || format === "pptx") && project.type !== "slide_deck") {
    return c.json(
      fail(
        "format_requires_deck",
        `${format.toUpperCase()} export is only available for slide_deck projects`,
        { projectType: project.type },
      ),
      400,
    );
  }

  const optionsRaw = body && typeof body === "object" && "options" in body ? Reflect.get(body, "options") : {};
  let options;
  try { options = parseExportOptions(format, optionsRaw); }
  catch (error) {
    if (error instanceof UpgradeContractError) return c.json(fail("invalid_export_options", "Export options are invalid", { path: error.path }), 400);
    throw error;
  }
  const { enqueueProjectExport, ExportServiceError } = await import("../services/exports");
  const { exportQaHooks } = await import("../services/export-qa-barrier");
  try {
    const job = await enqueueProjectExport(projectId, format, options, exportQaHooks(c.req.header("x-bg-export-qa-barrier") ?? null));
    if (job === null) return c.json(fail("export_create_failed", "Export job could not be created"), 500);
    return c.json(ok(job satisfies ExportJob), 202);
  } catch (error) {
    if (error instanceof ExportServiceError && error.code === "invalid_graphic_export_options") {
      return c.json(fail(error.code, error.message), 400);
    }
    throw error;
  }
});

artifactRoutes.post("/api/exports/qa/barriers", async (c) => {
  if (process.env.BG_EXPORT_QA !== "1") return c.notFound();
  const body = await c.req.json<unknown>().catch(() => null); const token = recordValue(body, "token"); const phase = recordValue(body, "phase"); const behavior = recordValue(body, "behavior");
  if (typeof token !== "string" || !isExportPhase(phase) || (behavior !== "pause" && behavior !== "fail")) return c.json(fail("invalid_qa_barrier", "Invalid export QA barrier"), 400);
  const { armExportQaBarrier } = await import("../services/export-qa-barrier"); armExportQaBarrier(token, phase, behavior); return c.json(ok({ token, phase, behavior }), 201);
});
artifactRoutes.get("/api/exports/qa/barriers/:token/wait", async (c) => {
  if (process.env.BG_EXPORT_QA !== "1") return c.notFound(); const { waitForExportQaBarrier } = await import("../services/export-qa-barrier"); const attempt_id = await waitForExportQaBarrier(c.req.param("token"), c.req.raw.signal); return c.json(ok({ attempt_id }));
});
artifactRoutes.post("/api/exports/qa/barriers/:token/release", async (c) => {
  if (process.env.BG_EXPORT_QA !== "1") return c.notFound(); const { releaseExportQaBarrier } = await import("../services/export-qa-barrier"); return c.json(ok({ attempt_id: releaseExportQaBarrier(c.req.param("token")) }));
});
artifactRoutes.post("/api/exports/qa/gc", async (c) => {
  if (process.env.BG_EXPORT_QA !== "1") return c.notFound(); const body = await c.req.json<unknown>().catch(() => null); const now = recordValue(body, "now"); const attemptId = recordValue(body, "attempt_id");
  if (typeof now !== "number" || !Number.isSafeInteger(now) || typeof attemptId !== "string") return c.json(fail("invalid_qa_gc", "A bounded GC time and attempt are required"), 400);
  const { getSqlite } = await import("../db/sqlite-client"); const { canonicalJson } = await import("../services/export-receipt");
  const expired = getSqlite().prepare("UPDATE export_attempts SET retention_json=? WHERE id=? AND status='validated'").run(canonicalJson({ retained_until: now - 1, output_available: true }), attemptId);
  if (expired.changes !== 1) return c.json(fail("invalid_qa_gc_attempt", "GC attempt must be validated"), 409);
  const { exportGcQaHook } = await import("../services/export-qa-barrier"); const { pruneOldExports } = await import("../services/export-gc");
  return c.json(ok(await pruneOldExports({ now, retentionMs: 0, signal: c.req.raw.signal, phase: exportGcQaHook(c.req.header("x-bg-export-qa-barrier") ?? null) })));
});

artifactRoutes.get("/api/exports/:id/attempts", async (c) => {
  const job = await getExportJob(c.req.param("id"));
  if (job === null) return c.json(fail("export_not_found", "Export job not found"), 404);
  return c.json(ok(await listExportAttempts(job.id)));
});

artifactRoutes.get("/api/exports/:id/attempts/:attemptId", async (c) => {
  const attempt = await getExportAttemptDetail(c.req.param("attemptId"));
  if (attempt === null || attempt.job_id !== c.req.param("id")) return c.json(fail("export_attempt_not_found", "Export attempt not found"), 404);
  return c.json(ok(attempt));
});

artifactRoutes.post("/api/exports/:id/cancel", async (c) => {
  const job = await getExportJob(c.req.param("id"));
  if (job === null) return c.json(fail("export_not_found", "Export job not found"), 404);
  if (job.latest_attempt === null) return c.json(fail("export_not_ready", "Export has no active attempt"), 409);
  const { cancelProjectExport } = await import("../services/exports");
  if (!cancelProjectExport(job.latest_attempt.id)) return c.json(fail("export_terminal", "Export attempt is already terminal"), 409);
  return c.json(ok(await getExportJob(job.id)), 202);
});

artifactRoutes.post("/api/exports/:id/retry", async (c) => {
  const job = await getExportJob(c.req.param("id"));
  if (job === null) return c.json(fail("export_not_found", "Export job not found"), 404);
  const project = await getProjectDetail(job.project_id);
  const body = await c.req.json<unknown>().catch(() => null);
  const revision = body && typeof body === "object" ? Reflect.get(body, "project_revision") : undefined;
  const digest = body && typeof body === "object" ? Reflect.get(body, "project_digest") : undefined;
  if (project === null || revision !== project.current_revision || digest !== project.current_digest) return c.json(fail("stale_artifact_identity", "Current project revision and digest are required"), 412);
  const { retryProjectExport } = await import("../services/exports"); const { exportQaHooks } = await import("../services/export-qa-barrier");
  try { return c.json(ok(await retryProjectExport(job.id, exportQaHooks(c.req.header("x-bg-export-qa-barrier") ?? null))), 202); }
  catch (error) { if (error instanceof ExportLifecycleError && error.code === "invalid_retry") return c.json(fail("export_retry_conflict", "Export retry already exists or parent is not retryable"), 409); throw error; }
});

function recordValue(value: unknown, key: string): unknown { return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined; }
function isExportPhase(value: unknown): value is ExportQaPhase { return value === "after_snapshot" || value === "after_partial_render" || value === "after_render" || value === "after_validation" || value === "after_receipt" || value === "after_publish_before_db" || value === "gc_after_tombstone_before_unlink" || value === "gc_after_unlink"; }

artifactRoutes.get("/api/exports/:id", async (c) => {
  const id = c.req.param("id");
  const job = await getExportJob(id);
  if (!job) {
    return c.json(fail("export_not_found", "Export job not found", { id }), 404);
  }

  return c.json(ok(job satisfies ExportJob));
});
