import type { Database } from "bun:sqlite";
import { ulid } from "ulid";
import type { ExportFormat, ExportOptions, ExportProgressStage, ExportStopReason } from "@bg/shared";
import { canonicalJson, sha256 } from "../services/export-receipt";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export type ExportIdentity = { readonly projectId: string; readonly revision: number; readonly digest: string; readonly designSystemDigest: string | null };
export type NewExport = ExportIdentity & { readonly format: ExportFormat; readonly options: ExportOptions; readonly rendererDigest: string; readonly captureDigest: string };
export type ExportIds = { readonly jobId: string; readonly attemptId: string };

export function createExportAuthority(db: Database, input: NewExport): ExportIds {
  const jobId = ulid(); const attemptId = ulid(); const now = Date.now(); const optionsJson = canonicalJson(input.options);
  db.transaction(() => {
    db.prepare("INSERT INTO exports(id,project_id,format,status,options_json,created_at) VALUES (?,?,?,'pending',?,?)").run(jobId, input.projectId, input.format, optionsJson, now);
    insertAttempt(db, { attemptId, jobId, parentAttemptId: null, identity: input, optionsJson, status: "pending", now, rendererDigest: input.rendererDigest, captureDigest: input.captureDigest });
  })();
  return { jobId, attemptId };
}

export function createRetryAuthority(db: Database, input: { readonly jobId: string; readonly parentAttemptId: string; readonly identity: ExportIdentity; readonly rendererDigest: string; readonly captureDigest: string }): string {
  const attemptId = ulid(); const now = Date.now();
  try {
    db.transaction(() => {
      const parent = db.query<{ readonly job_id: string; readonly canonical_options_json: string }, [string]>("SELECT job_id,canonical_options_json FROM export_attempts WHERE id=? AND status IN ('failed','cancelled','corrupt','expired')").get(input.parentAttemptId);
      if (parent === null || parent.job_id !== input.jobId) throw new ExportLifecycleError("invalid_retry");
      insertAttempt(db, { attemptId, jobId: input.jobId, parentAttemptId: input.parentAttemptId, identity: input.identity, optionsJson: parent.canonical_options_json, status: "retrying", now, rendererDigest: input.rendererDigest, captureDigest: input.captureDigest });
      db.prepare("UPDATE exports SET status='pending',output_path=NULL,error_message=NULL,size_bytes=NULL,completed_at=NULL WHERE id=?").run(input.jobId);
    })();
  } catch { throw new ExportLifecycleError("invalid_retry"); }
  return attemptId;
}

export function advanceExportAttempt(db: Database, input: { readonly attemptId: string; readonly status: "running" | "validating" | "recovering"; readonly stage: ExportProgressStage; readonly inputClosureDigest?: string; readonly designSystemDigest?: string | null }): void {
  const completed = progressCompleted(input.stage); const now = Date.now();
  const changed = db.prepare(`UPDATE export_attempts SET status=?,progress_json=?,input_closure_digest=COALESCE(?,input_closure_digest),design_system_digest=COALESCE(?,design_system_digest),updated_at=? WHERE id=? AND status IN ('pending','retrying','running','validating','recovering')`).run(input.status, canonicalJson({ stage: input.stage, completed, total: 6 }), input.inputClosureDigest ?? null, input.designSystemDigest ?? null, now, input.attemptId);
  if (changed.changes !== 1) throw new ExportLifecycleError("transition_conflict");
}

export function completeExportAttempt(db: Database, input: { readonly jobId: string; readonly attemptId: string; readonly outputPath: string; readonly size: number; readonly outputDigest: string; readonly receiptDigest: string }): void {
  const now = Date.now();
  db.transaction(() => {
    const attempt = db.prepare("UPDATE export_attempts SET status='validated',progress_json=?,output_digest=?,receipt_digest=?,retention_json=?,stop_reason=NULL,updated_at=? WHERE id=? AND job_id=? AND cancel_requested_at IS NULL AND status IN ('validating','recovering')").run(canonicalJson({ stage: "complete", completed: 6, total: 6 }), input.outputDigest, input.receiptDigest, canonicalJson({ retained_until: now + RETENTION_MS, output_available: true }), now, input.attemptId, input.jobId);
    if (attempt.changes !== 1) throw new ExportLifecycleError("transition_conflict");
    const job = db.prepare("UPDATE exports SET status='succeeded',output_path=?,error_message=NULL,size_bytes=?,completed_at=? WHERE id=?").run(input.outputPath, input.size, now, input.jobId);
    if (job.changes !== 1) throw new ExportLifecycleError("transition_conflict");
  })();
}

export function failExportAttempt(db: Database, input: { readonly jobId: string; readonly attemptId: string; readonly status: "failed" | "cancelled" | "corrupt"; readonly reason: ExportStopReason; readonly message: string }): void {
  const now = Date.now();
  db.transaction(() => {
    db.prepare("UPDATE export_attempts SET status=?,stop_reason=?,retention_json=?,updated_at=? WHERE id=? AND status NOT IN ('validated','failed','cancelled','corrupt','expired')").run(input.status, input.reason, canonicalJson({ retained_until: now + RETENTION_MS, output_available: false }), now, input.attemptId);
    db.prepare("UPDATE exports SET status='failed',output_path=NULL,error_message=?,size_bytes=NULL,completed_at=? WHERE id=? AND status!='succeeded'").run(input.message, now, input.jobId);
  })();
}

export function markExportAttemptCorrupt(db: Database, input: { readonly jobId: string; readonly attemptId: string; readonly message: string }): void {
  const now = Date.now();
  db.transaction(() => {
    db.prepare("UPDATE export_attempts SET status='corrupt',stop_reason='receipt_corrupt',retention_json=?,updated_at=? WHERE id=? AND job_id=? AND status IN ('pending','running','validating','validated','retrying','recovering')").run(canonicalJson({ retained_until: now, output_available: false }), now, input.attemptId, input.jobId);
    db.prepare("UPDATE exports SET status='failed',output_path=NULL,error_message=?,size_bytes=NULL,completed_at=? WHERE id=?").run(input.message, now, input.jobId);
  })();
}

export function recordExportAuditFindings(db: Database, attemptId: string, findings: readonly { readonly code: string; readonly path: string | null }[]): void {
  if (findings.length > 200 || findings.some((finding) => finding.code.length === 0 || finding.code.length > 100 || finding.path !== null && finding.path.length > 512)) throw new ExportLifecycleError("invalid_findings");
  const changed = db.prepare("UPDATE export_attempts SET findings_json=?,updated_at=? WHERE id=? AND status IN ('running','validating')").run(canonicalJson(findings), Date.now(), attemptId);
  if (changed.changes !== 1) throw new ExportLifecycleError("transition_conflict");
}

export function requestExportCancellation(db: Database, attemptId: string): boolean {
  const changed = db.prepare("UPDATE export_attempts SET cancel_requested_at=COALESCE(cancel_requested_at,?),updated_at=? WHERE id=? AND status IN ('pending','retrying','running','validating','recovering')").run(Date.now(), Date.now(), attemptId);
  return changed.changes === 1;
}

function insertAttempt(db: Database, input: { readonly attemptId: string; readonly jobId: string; readonly parentAttemptId: string | null; readonly identity: ExportIdentity; readonly optionsJson: string; readonly status: "pending" | "retrying"; readonly now: number; readonly rendererDigest: string; readonly captureDigest: string }): void {
  db.prepare(`INSERT INTO export_attempts(id,job_id,parent_attempt_id,status,progress_json,project_revision,project_digest,canonical_options_json,options_digest,input_closure_digest,design_system_digest,renderer_digest,capture_digest,output_digest,receipt_digest,findings_json,retention_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?,?,NULL,NULL,'[]',?,?,?)`).run(input.attemptId, input.jobId, input.parentAttemptId, input.status, canonicalJson({ stage: "queued", completed: 0, total: 6 }), input.identity.revision, input.identity.digest, input.optionsJson, sha256(input.optionsJson), input.identity.designSystemDigest, input.rendererDigest, input.captureDigest, canonicalJson({ retained_until: input.now + RETENTION_MS, output_available: false }), input.now, input.now);
}
function progressCompleted(stage: ExportProgressStage): number { switch (stage) { case "queued": return 0; case "snapshotting": return 1; case "rendering": return 2; case "validating": return 3; case "publishing": return 4; case "complete": return 6; } }
export class ExportLifecycleError extends Error { readonly name = "ExportLifecycleError"; constructor(readonly code: "invalid_retry" | "transition_conflict" | "invalid_findings") { super(code); } }
