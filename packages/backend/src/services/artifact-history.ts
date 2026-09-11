import type { Database } from "bun:sqlite";
import type { ArtifactHistoryV1 } from "@bg/shared";
import { listArtifactOperations } from "../db/artifact-operation-query";

/** Follow undo ancestry, not the most recent write: undoing an undo must not toggle two states. */
export function artifactHistory(db: Database, projectId: string, revision: number, digest: string): ArtifactHistoryV1 {
  const rows = listArtifactOperations(db, projectId).filter(row => row.status === "committed");
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
    undo_operation_id: next && next.replay.kind !== "initialize" && next.retention.replayable ? next.id : null,
    entries: rows.filter(row => row.replay.kind !== "initialize" && row.base_digest !== digest).map(row => {
      const previous = byRevision.get(row.base_revision);
      return { operation_id: row.id, revision: row.base_revision, created_at: previous?.updated_at ?? row.created_at, kind: previous?.replay.kind ?? "initialize", files: row.diff.map(file => file.path), available: row.retention.replayable };
    }),
  };
}
