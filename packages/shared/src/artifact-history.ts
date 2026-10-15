import type { RevisionComparison } from "./edit-scope";

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
/** A generation that failed its design review but whose retained output can still be opened as a separate draft. No paths. */
export interface ReviewFailedDraftOffer {
  operation_id: string;
  failed_at: number;
  retained_until: number;
  incomplete_checks: string[];
}
/** Attached to a recovered draft: its bytes never passed review. Applies only while the draft still holds the recovered bytes. */
export interface UnverifiedDraftStateV1 {
  schema_version: 1;
  reason: "design_review_failed";
  incomplete_checks: string[];
  retained_until: number;
  recovered_at: number;
  source_project_id: string;
  source_operation_id: string;
}
export interface RecoverReviewFailedDraftResponse {
  project_id: string;
  session_id: string;
  entrypoint: string;
}
export interface ArtifactHistoryV1 {
  schema_version: 1;
  current_revision: number;
  current_digest: string;
  undo_operation_id: string | null;
  entries: ArtifactHistoryEntry[];
  external_captures: ArtifactExternalCapture[];
  review_failed_drafts: ReviewFailedDraftOffer[];
  latest_comparison?: RevisionComparison | null;
  scope_violation?: { readonly operation_id: string; readonly comparison: RevisionComparison } | null;
}
