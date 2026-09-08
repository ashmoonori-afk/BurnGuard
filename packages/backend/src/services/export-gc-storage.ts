import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { getSqlite } from "../db/sqlite-client";
import { exportsDir } from "../lib/paths";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import { canonicalJson } from "./export-receipt";
import type { ExpiredAttempt, PruneDeps } from "./export-gc";

export const exportGcStorage = {
  listExpired: async (cutoff: number): Promise<readonly ExpiredAttempt[]> => {
    const rows = getSqlite().query<{ readonly attemptId: string; readonly jobId: string; readonly status: "expired" | "validated"; readonly retentionJson: string }, [number]>(`SELECT id attemptId,job_id jobId,status,retention_json retentionJson FROM export_attempts WHERE status='expired' OR status='validated' AND json_extract(retention_json,'$.retained_until')<=? ORDER BY created_at`).all(cutoff);
    const attempts = rows.map((row) => { const value: unknown = JSON.parse(row.retentionJson); if (!record(value) || typeof value["retained_until"] !== "number" || typeof value["output_available"] !== "boolean") throw new ExportGcStorageError("corrupt_retention"); return { row, value, attempt: { attemptId: row.attemptId, jobId: row.jobId, retainedUntil: value["retained_until"], outputAvailable: value["output_available"] } }; });
    const pending = await Promise.all(attempts.map(async ({ row }) => row.status === "validated" || (await stat(resolveWithin(exportsDir, "attempts", assertSafeName(row.attemptId))).catch(() => null))?.isDirectory() === true));
    return attempts.filter((_, index) => pending[index]).map(({ attempt }) => attempt);
  },
  claim: async (attemptId: string, now: number): Promise<boolean> => {
    const db = getSqlite(); return db.transaction(() => {
      const row = db.query<{ readonly job_id: string }, [string]>("SELECT job_id FROM export_attempts WHERE id=? AND status='validated'").get(attemptId); if (row === null) return true;
      const changed = db.prepare("UPDATE export_attempts SET status='expired',stop_reason='retention_expired',retention_json=?,updated_at=? WHERE id=? AND status='validated'").run(canonicalJson({ retained_until: now, output_available: false }), now, attemptId);
      if (changed.changes !== 1) return false;
      db.prepare("UPDATE exports SET status='failed',output_path=NULL,error_message='Export retention expired',completed_at=? WHERE id=?").run(now, row.job_id); return true;
    })();
  },
  removeDirectory: async (attemptId: string): Promise<number> => {
    const owned = resolveWithin(exportsDir, "attempts", assertSafeName(attemptId)); const bytes = await directoryBytes(owned); await rm(owned, { recursive: true, force: true }); return bytes;
  },
} as const satisfies Required<PruneDeps>;

async function directoryBytes(root: string): Promise<number> {
  const info = await stat(root).catch(() => null); if (info === null) return 0;
  if (!info.isDirectory()) throw new ExportGcStorageError("unsafe_attempt_directory");
  let bytes = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) { const target = path.join(root, entry.name); if (entry.isSymbolicLink()) throw new ExportGcStorageError("unsafe_attempt_directory"); bytes += entry.isDirectory() ? await directoryBytes(target) : entry.isFile() ? (await stat(target)).size : 0; }
  return bytes;
}
function record(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export class ExportGcStorageError extends Error { readonly name = "ExportGcStorageError"; constructor(readonly code: "corrupt_retention" | "unsafe_attempt_directory") { super(code); } }
