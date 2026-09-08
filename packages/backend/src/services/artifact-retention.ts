import type { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import path from "node:path";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import { parsePersistedArtifactOperation, type PersistedArtifactOperationRow } from "./artifact-operation-record";

/** Terminal operation copies expire after their recorded 30-day retention period. */
export async function pruneExpiredArtifactOperations(db: Database, options: { readonly now?: number; readonly projectId?: string; readonly preserveOperationId?: string; readonly projectsRoot?: string } = {}): Promise<number> {
  const now = options.now ?? Date.now();
  const rows = db.query<PersistedArtifactOperationRow & { dir_path: string }, [number, string | null, string | null, string | null]>(`SELECT o.*,p.dir_path FROM artifact_operations o JOIN projects p ON p.id=o.project_id
    WHERE o.status IN ('committed','cancelled','failed','conflicted','recovered') AND json_extract(o.retention_json,'$.retained_until')<=?
    AND COALESCE(json_extract(o.retention_json,'$.prune_reason'),'')!='retention_expired_removed'
    AND (? IS NULL OR o.project_id=?) AND o.id!=COALESCE(?, '')
    AND NOT EXISTS (SELECT 1 FROM artifact_operations active WHERE active.project_id=o.project_id AND active.status IN ('pending','working','recovering'))
    AND o.id!=COALESCE((SELECT latest.id FROM artifact_operations latest WHERE latest.project_id=p.id AND latest.status IN ('committed','cancelled')
      AND latest.result_revision=p.current_revision AND latest.result_digest=p.current_digest ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1),'')
    ORDER BY o.created_at,o.id LIMIT 100`).all(now, options.projectId ?? null, options.projectId ?? null, options.preserveOperationId ?? null);
  let removed = 0;
  for (const row of rows) {
    try {
      const operation = parsePersistedArtifactOperation(row);
      const projectRoot = resolveManagedPath(options.projectsRoot ?? projectsDir, row.dir_path);
      const root = resolveWithin(projectRoot, ".meta", "artifact-operations", assertSafeName(operation.id));
      if (path.resolve(operation.snapshot.snapshot_path) !== path.join(root, "snapshot") || path.resolve(operation.snapshot.stage_path) !== path.join(root, "stage")) throw new Error("Artifact retention receipt is outside operation storage");
      // Mark unavailable first. A crash before unlink is retried on the next sweep.
      const changed = db.prepare(`UPDATE artifact_operations SET retention_json=json_set(retention_json,'$.replayable',json('false'),'$.pruned_at',?,'$.prune_reason','retention_expired'),updated_at=?
        WHERE id=? AND status IN ('committed','cancelled','failed','conflicted','recovered') AND json_extract(retention_json,'$.retained_until')<=?`).run(now, now, operation.id, now);
      if (changed.changes !== 1) continue;
      await rm(root, { recursive: true, force: true });
      db.prepare("UPDATE artifact_operations SET retention_json=json_set(retention_json,'$.prune_reason','retention_expired_removed') WHERE id=? AND json_extract(retention_json,'$.prune_reason')='retention_expired'").run(operation.id);
      removed += 1;
    } catch {
      // Corrupt receipts or held handles retain their bytes; other candidates can proceed.
      console.warn("[artifact] retained operation cleanup deferred", row.id);
    }
  }
  return removed;
}
