import { and, desc, eq, lt } from "drizzle-orm";
import { ulid } from "ulid";
import { HANDOFF_CONTINUATION, parseExportAttempt, parseExportOptions, type ExportAttempt, type ExportFormat, type ExportJob, type ExportOptions, type ExportStatus } from "@bg/shared";
import { getDb } from "./client";
import { exportAttemptsTable } from "./pipeline-schema";
import { exportsTable } from "./schema";

export async function createExportJob(projectId: string, format: ExportFormat, options: ExportOptions = parseExportOptions(format, {})): Promise<ExportJob | null> {
  const id = ulid(); const createdAt = Date.now(); const canonical = parseExportOptions(format, options);
  await getDb().insert(exportsTable).values({ id, projectId, format, status: "pending", optionsJson: JSON.stringify(canonical), createdAt });
  return getExportJob(id);
}

export async function updateExportJob(id: string, patch: { readonly status: ExportStatus; readonly outputPath?: string | null; readonly errorMessage?: string | null; readonly sizeBytes?: number | null; readonly completedAt?: number | null }): Promise<ExportJob | null> {
  await getDb().update(exportsTable).set({ status: patch.status, outputPath: patch.outputPath, errorMessage: patch.errorMessage, sizeBytes: patch.sizeBytes, completedAt: patch.completedAt }).where(eq(exportsTable.id, id));
  return getExportJob(id);
}

export async function getExportJob(id: string): Promise<ExportJob | null> {
  const row = (await getDb().select().from(exportsTable).where(eq(exportsTable.id, id)).limit(1))[0];
  return row === undefined ? null : toJob(row);
}

export async function listStaleSucceededExports(cutoffMs: number): Promise<ExportJob[]> {
  const rows = await getDb().select().from(exportsTable).where(and(eq(exportsTable.status, "succeeded"), lt(exportsTable.completedAt, cutoffMs))).orderBy(exportsTable.completedAt);
  return Promise.all(rows.map(toJob));
}

export async function deleteExportJob(id: string): Promise<void> { await getDb().delete(exportsTable).where(eq(exportsTable.id, id)); }

export async function listProjectExports(projectId: string): Promise<ExportJob[]> {
  const rows = await getDb().select().from(exportsTable).where(eq(exportsTable.projectId, projectId)).orderBy(desc(exportsTable.createdAt));
  return Promise.all(rows.map(toJob));
}

export async function listExportAttempts(jobId: string): Promise<readonly ExportAttempt[]> {
  const rows = await getDb().select().from(exportAttemptsTable).where(eq(exportAttemptsTable.jobId, jobId)).orderBy(desc(exportAttemptsTable.createdAt));
  return rows.map(attemptDto);
}

export async function getExportAttemptDetail(attemptId: string): Promise<ExportAttempt | null> {
  const row = (await getDb().select().from(exportAttemptsTable).where(eq(exportAttemptsTable.id, attemptId)).limit(1))[0];
  return row === undefined ? null : attemptDto(row);
}

/**
 * Every message written today is fixed copy, but rows failed before #202 still hold raw exception text with
 * absolute paths and errno codes. Anything outside the written copy is served as "Export failed", keeping a leading
 * lowercase domain code (errno codes are uppercase) as "Export failed: <code>" like exportFailureMessage does, so
 * the export menu can still classify Chromium failures. A new fixed message must be added here or it is masked.
 */
const FIXED_EXPORT_MESSAGES = new Set([
  "Export failed", "Export cancelled", "Export recovery found no owned output", "Export receipt or output is corrupt",
  "Legacy export has no validated receipt", "Export retention expired",
]);
function publicErrorMessage(message: string | null): string | null {
  if (message === null || FIXED_EXPORT_MESSAGES.has(message) || /^Export failed: [a-z][a-z0-9_]{0,63}$/u.test(message)) return message;
  const code = /^([a-z][a-z0-9_]{0,63}):/u.exec(message)?.[1];
  return code === undefined ? "Export failed" : `Export failed: ${code}`;
}

async function toJob(row: typeof exportsTable.$inferSelect): Promise<ExportJob> {
  const attempt = (await getDb().select().from(exportAttemptsTable).where(eq(exportAttemptsTable.jobId, row.id)).orderBy(desc(exportAttemptsTable.createdAt)).limit(1))[0];
  return {
    id: row.id, project_id: row.projectId, format: row.format, status: row.status,
    output_path: row.outputPath, error_message: publicErrorMessage(row.errorMessage), size_bytes: row.sizeBytes,
    options: parseExportOptions(row.format, row.optionsJson), latest_attempt: attempt === undefined ? null : attemptDto(attempt), parity: null,
    handoff_continuation: row.format === "handoff" && row.status === "succeeded" ? HANDOFF_CONTINUATION : null,
    created_at: row.createdAt, completed_at: row.completedAt,
  };
}

function attemptDto(row: typeof exportAttemptsTable.$inferSelect): ExportAttempt {
  return parseExportAttempt({
    id: row.id, job_id: row.jobId, parent_attempt_id: row.parentAttemptId, status: row.status,
    project_revision: row.projectRevision, project_digest: row.projectDigest, design_system_digest: row.designSystemDigest,
    digests: { options: row.optionsDigest, input_closure: row.inputClosureDigest, renderer: row.rendererDigest, capture: row.captureDigest, output: row.outputDigest, receipt: row.receiptDigest },
    progress: JSON.parse(row.progressJson), stop_reason: row.stopReason, findings: JSON.parse(row.findingsJson), retention: JSON.parse(row.retentionJson),
    cancel_requested_at: row.cancelRequestedAt, created_at: row.createdAt, updated_at: row.updatedAt,
  });
}
