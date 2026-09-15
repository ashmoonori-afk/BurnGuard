export interface CommentAnchorV1 {
  readonly version: 1;
  readonly x_pct: number;
  readonly y_pct: number;
}

export function parseCommentAnchor(value: unknown): CommentAnchorV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const anchor = value as Record<string, unknown>;
  if (Object.keys(anchor).length !== 3 || anchor.version !== 1 ||
    ![anchor.x_pct, anchor.y_pct].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100)) return null;
  return { version: 1, x_pct: anchor.x_pct as number, y_pct: anchor.y_pct as number };
}

export interface Comment {
  id: string;
  project_id: string;
  rel_path: string;
  node_selector: string;
  x_pct: number;
  y_pct: number;
  /** Position within node_selector; absent for legacy viewport-only pins. */
  anchor?: CommentAnchorV1 | null;
  slide_index: number | null;
  body: string;
  author_id: string;
  artifact_revision: number | null;
  artifact_digest: string | null;
  resolved_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface CreateCommentRequest {
  rel_path: string;
  node_selector?: string;
  x_pct: number;
  y_pct: number;
  anchor?: CommentAnchorV1 | null;
  slide_index?: number | null;
  body?: string;
  artifact_revision?: number;
  artifact_digest?: string;
}

export interface UpdateCommentRequest {
  body?: string;
  resolved?: boolean;
}
