export interface ArtifactHistoryEntry {
  operation_id: string;
  revision: number;
  created_at: number;
  kind: string;
  files: string[];
  available: boolean;
}
export interface ArtifactHistoryV1 {
  schema_version: 1;
  current_revision: number;
  current_digest: string;
  undo_operation_id: string | null;
  entries: ArtifactHistoryEntry[];
}
