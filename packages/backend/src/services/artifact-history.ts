import type { Database } from "bun:sqlite";
import type { ArtifactHistoryV1 } from "@bg/shared";
import { listArtifactOperations } from "../db/artifact-operation-query";

/** Follow undo ancestry, not the most recent write: undoing an undo must not toggle two states. */
export function artifactHistory(db: Database, projectId: string, revision: number, digest: string, now = Date.now()): ArtifactHistoryV1 {
  const operations = listArtifactOperations(db, projectId);
  const rows = operations.filter(row => row.status === "committed");
  const reapplied = new Set(rows.filter(row => row.replay.kind === "reapply_external").map(row => row.replay.parent_operation_id));
  // Imported Figma references are immutable: no revision before the latest import can be restored.
  const importFloor = Math.max(-1, ...rows.filter(row => row.replay.kind === "figma_import").map(row => row.result_revision ?? -1));
  const restorable = (row: (typeof rows)[number]) => row.retention.replayable && row.base_revision >= importFloor;
  const byId = new Map(rows.map(row => [row.id, row]));
  const byRevision = new Map(rows.map(row => [row.result_revision, row]));
  let next = byRevision.get(revision);
  if (next?.result_digest !== digest) next = undefined;
  const seen = new Set<string>();
  while (next?.replay.kind === "undo") {
    if (seen.has(next.id)) { next = undefined; break; }
    seen.add(next.id);
    const target = byId.get(next.replay.parent_operation_id ?? "");
    next = target ? byRevision.get(target.base_revision) : undefined;
  }
  return { schema_version: 1, current_revision: revision, current_digest: digest,
    undo_operation_id: next && next.replay.kind !== "initialize" && restorable(next) ? next.id : null,
    entries: rows.filter(row => row.replay.kind !== "initialize" && row.base_digest !== digest).map(row => {
      const previous = byRevision.get(row.base_revision);
      return { operation_id: row.id, revision: row.base_revision, created_at: previous?.updated_at ?? row.created_at, kind: previous?.replay.kind ?? "initialize", files: row.diff.map(file => file.path), available: restorable(row) };
    }),
    // External saves reverted while an operation ran, still retained and not yet re-applied.
    external_captures: operations.filter(row => row.status === "conflicted" && row.replay.kind === "external" && row.retention.replayable && row.retention.retained_until > now && !reapplied.has(row.id))
      .map(row => ({ operation_id: row.id, captured_at: row.created_at, file_count: row.diff.length })),
  };
}
