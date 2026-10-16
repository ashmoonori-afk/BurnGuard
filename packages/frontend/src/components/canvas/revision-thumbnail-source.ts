import type { ArtifactHistoryEntry, ArtifactHistoryV1 } from "@bg/shared";

export type RevisionThumbnailUrls = { readonly before: string | null; readonly after: string | null };

/** Both sides belong to one retained operation, never to the mutable live artifact. */
export function revisionThumbnailUrls(projectId: string, entry: Pick<ArtifactHistoryEntry, "operation_id" | "available"> | undefined): RevisionThumbnailUrls {
  if (!entry?.available) return { before: null, after: null };
  const url = `/api/projects/${encodeURIComponent(projectId)}/thumbnail?operation=${encodeURIComponent(entry.operation_id)}`;
  return { before: `${url}&side=before`, after: `${url}&side=after` };
}

/** A committed operation advances exactly one revision. Refused edits have no published after image. */
export function comparisonThumbnailUrls(projectId: string, history: ArtifactHistoryV1 | null | undefined): RevisionThumbnailUrls {
  if (!history?.latest_comparison || history.scope_violation || history.latest_comparison.result_digest !== history.current_digest) return { before: null, after: null };
  return revisionThumbnailUrls(projectId, history.entries.find(entry => entry.revision === history.current_revision - 1));
}
