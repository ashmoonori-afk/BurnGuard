export interface ArtifactHistoryEntry {
  operation_id: string;
  revision: number;
  created_at: number;
  kind: string;
  files: string[];
  available: boolean;
}
/** An external save reverted while an operation ran; no paths, only enough to offer re-applying it. */
export interface ArtifactExternalCapture {
  operation_id: string;
  captured_at: number;
  file_count: number;
}
export interface ArtifactHistoryV1 {
  schema_version: 1;
  current_revision: number;
  current_digest: string;
  undo_operation_id: string | null;
  entries: ArtifactHistoryEntry[];
  external_captures: ArtifactExternalCapture[];
}
