import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Database } from "bun:sqlite";
import { ulid } from "ulid";
import { parseExportOptions, type ExportFormat, type NormalizedEvent } from "@bg/shared";
import { advanceExportAttempt, failExportAttempt, markExportAttemptCorrupt } from "../db/export-lifecycle-repository";
import { completeExportAttemptWithEvent } from "./export-events";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import { insertSequencedEvent } from "../db/sequenced-event-writer";
import { parseExportReceipt, receiptDigest, requireReceiptIdentity, sha256 } from "./export-receipt";
import { formatExtension } from "./export-naming";

export async function reconcileExportState(db: Database, root?: string): Promise<void> {
  const exportRoot = root ?? (await import("../lib/paths")).exportsDir;
  const rows = db.query<RecoveryRow, []>(`SELECT a.id attempt_id,a.job_id,a.parent_attempt_id,a.status,a.project_revision,a.project_digest,a.canonical_options_json,a.options_digest,a.input_closure_digest,a.design_system_digest,a.renderer_digest,a.capture_digest,a.output_digest,a.receipt_digest,e.format,e.project_id
    FROM export_attempts a JOIN exports e ON e.id=a.job_id WHERE a.status IN ('pending','running','validating','validated','retrying','recovering')`).all();
  for (const row of rows) await recoverAttempt(db, exportRoot, row);
  db.prepare("UPDATE exports SET status='failed',output_path=NULL,error_message='Legacy export has no validated receipt' WHERE status='succeeded' AND NOT EXISTS (SELECT 1 FROM export_attempts a WHERE a.job_id=exports.id AND a.status='validated')").run();
  await cleanOrphanTrees(db, exportRoot);
}

type RecoveryRow = { readonly attempt_id: string; readonly job_id: string; readonly parent_attempt_id: string | null; readonly status: string; readonly project_revision: number; readonly project_digest: string; readonly canonical_options_json: string; readonly options_digest: string; readonly input_closure_digest: string | null; readonly design_system_digest: string | null; readonly renderer_digest: string; readonly capture_digest: string; readonly output_digest: string | null; readonly receipt_digest: string | null; readonly format: ExportFormat; readonly project_id: string };
async function recoverAttempt(db: Database, root: string, row: RecoveryRow): Promise<void> {
  const safeId = assertSafeName(row.attempt_id); const stage = resolveWithin(root, ".staging", safeId); const published = resolveWithin(root, "attempts", safeId);
  const cancelRequested = () => db.query<{ readonly requested: number }, [string]>("SELECT cancel_requested_at IS NOT NULL requested FROM export_attempts WHERE id=?").get(row.attempt_id)?.requested === 1;
  const cancel = async () => {
    // Cleanup is best-effort: a held handle must not block the terminal transition or startup.
    await rm(stage, { recursive: true, force: true }).catch(() => undefined); await rm(published, { recursive: true, force: true }).catch(() => undefined);
    failExportAttempt(db, { jobId: row.job_id, attemptId: row.attempt_id, status: "cancelled", reason: "user_cancelled", message: "Export cancelled" });
    emitRecovery(db, row, "cancelled", "user_cancelled");
  };
  if (row.status !== "validated" && cancelRequested()) { await cancel(); return; }
  const source = await directoryExists(published) ? published : await directoryExists(stage) ? stage : null;
  // A stage without a receipt is a render interrupted before validation, not corrupt output.
  const interrupted = source === stage && row.status !== "validated" && await stat(path.join(stage, "receipt.json")).then(() => false, (error: unknown) => Reflect.get(Object(error), "code") === "ENOENT");
  if (source === null || interrupted) {
    if (row.status === "validated") {
      markExportAttemptCorrupt(db, { jobId: row.job_id, attemptId: row.attempt_id, message: "Export recovery found no owned output" });
      emitRecovery(db, row, "corrupt", "receipt_corrupt");
    } else {
      await rm(stage, { recursive: true, force: true }).catch(() => undefined);
      failExportAttempt(db, { jobId: row.job_id, attemptId: row.attempt_id, status: "failed", reason: "recovery_failed", message: "Export recovery found no owned output" });
      emitRecovery(db, row, "failed", "recovery_failed");
    }
    return;
  }
  let completion: Parameters<typeof completeExportAttemptWithEvent>[1];
  try {
    const receiptSource = await readFile(path.join(source, "receipt.json"), "utf8"); const receipt = parseExportReceipt(JSON.parse(receiptSource));
    const outputPath = resolveWithin(source, receipt.output_file); const output = new Uint8Array(await readFile(outputPath)); const outputDigest = sha256(output);
    requireReceiptIdentity(receipt, { jobId: row.job_id, attemptId: row.attempt_id, parentAttemptId: row.parent_attempt_id, projectId: row.project_id, projectRevision: row.project_revision, projectDigest: row.project_digest, format: row.format, options: parseExportOptions(row.format, row.canonical_options_json), optionsDigest: row.options_digest, inputClosureDigest: row.input_closure_digest, designSystemDigest: row.design_system_digest, rendererDigest: row.renderer_digest, captureDigest: row.capture_digest, outputFile: `artifact.${formatExtension(row.format)}`, outputDigest, outputSize: output.byteLength });
    const expectedReceipt = receiptDigest(receipt);
    if (row.output_digest !== null && row.output_digest !== outputDigest || row.receipt_digest !== null && row.receipt_digest !== expectedReceipt || receipt.output_size !== output.byteLength) throw new TypeError("Recovery digest or size mismatch");
    if (row.status === "validated") return;
    if (cancelRequested()) { await cancel(); return; }
    if (source === stage) { for (const scratch of ["render", "handoff", "platform", "frames"] as const) await rm(path.join(stage, scratch), { recursive: true, force: true }); await mkdir(path.dirname(published), { recursive: true }); await rm(published, { recursive: true, force: true }); await rename(stage, published); }
    const finalOutput = resolveWithin(published, receipt.output_file); const info = await stat(finalOutput);
    if (cancelRequested()) { await cancel(); return; }
    advanceExportAttempt(db, { attemptId: row.attempt_id, status: "recovering", stage: "publishing" });
    completion = { jobId: row.job_id, attemptId: row.attempt_id, outputPath: finalOutput, size: info.size, outputDigest, receiptDigest: expectedReceipt, projectId: row.project_id, projectRevision: row.project_revision, projectDigest: row.project_digest };
  } catch {
    if (cancelRequested()) { await cancel(); return; }
    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
    // Fixed copy: fs errors carry absolute private paths, and this message reaches the job DTO.
    markExportAttemptCorrupt(db, { jobId: row.job_id, attemptId: row.attempt_id, message: "Export receipt or output is corrupt" }); emitRecovery(db, row, "corrupt", "receipt_corrupt");
    return;
  }
  // Persistence failure leaves verified bytes and a recovering attempt intact.
  // It must not classify a valid receipt as corrupt or delete the recoverable output.
  completeExportAttemptWithEvent(db, completion);
}
/**
 * Startup only, before serving: every attempt row is inserted before its directories exist, so a directory
 * without a row is a crash leftover or the output of a project whose export rows were cascaded away.
 * A terminal attempt's directory is a tree an earlier best-effort cleanup failed to remove; validated,
 * corrupt and expired outputs under `attempts` stay for their own lifecycle.
 */
async function cleanOrphanTrees(db: Database, root: string): Promise<void> {
  for (const owner of [".staging", "attempts"] as const) {
    const parent = resolveWithin(root, owner);
    for (const entry of await readdir(parent, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      try { assertSafeName(entry.name); } catch { continue; }
      const row = db.query<{ readonly status: string }, [string]>("SELECT status FROM export_attempts WHERE id=?").get(entry.name);
      const stale = row === null || (owner === ".staging" ? ["failed", "cancelled", "corrupt", "expired"] : ["failed", "cancelled"]).includes(row.status);
      if (stale) await rm(resolveWithin(parent, entry.name), { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
function emitRecovery(db: Database, row: RecoveryRow, status: "validated" | "failed" | "corrupt" | "cancelled", stopReason: "recovery_failed" | "receipt_corrupt" | "user_cancelled" | null): void {
  const session = db.query<{ readonly id: string }, [string]>("SELECT id FROM sessions WHERE project_id=? ORDER BY updated_at DESC LIMIT 1").get(row.project_id); if (session === null) return;
  const event: NormalizedEvent = { id: ulid(), ts: Date.now(), type: "export.attempt", jobId: row.job_id, attemptId: row.attempt_id, status, progress: { stage: status === "validated" ? "complete" : "validating", completed: status === "validated" ? 6 : 3, total: 6 }, projectRevision: row.project_revision, projectDigest: row.project_digest, stopReason };
  insertSequencedEvent(db, { id: event.id, sessionId: session.id, direction: "down", type: event.type, payload: event, turnId: null, processedAt: event.ts, createdAt: event.ts });
}
async function directoryExists(target: string): Promise<boolean> { return (await stat(target).catch(() => null))?.isDirectory() === true; }
