import { and, asc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type {
  Comment,
  CreateCommentRequest,
  UpdateCommentRequest,
} from "@bg/shared";
import { getDb } from "./client";
import { commentsTable } from "./schema";
import { parseCommentAnchor } from "@bg/shared";

type CommentRow = typeof commentsTable.$inferSelect;

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    project_id: row.projectId,
    rel_path: row.relPath,
    node_selector: row.nodeSelector,
    x_pct: row.xPct,
    y_pct: row.yPct,
    anchor: row.anchorJson === null ? null : parseCommentAnchor(JSON.parse(row.anchorJson)),
    slide_index: row.slideIndex,
    body: row.body,
    author_id: row.authorId,
    artifact_revision: row.artifactRevision,
    artifact_digest: row.artifactDigest,
    resolved_at: row.resolvedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function listProjectComments(projectId: string): Promise<Comment[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(commentsTable)
    .where(eq(commentsTable.projectId, projectId))
    .orderBy(asc(commentsTable.createdAt));
  return rows.map(toComment);
}

export async function createProjectComment(
  projectId: string,
  input: CreateCommentRequest,
): Promise<Comment> {
  const db = getDb();
  const now = Date.now();
  const row: CommentRow = {
    id: ulid(),
    projectId,
    relPath: input.rel_path,
    nodeSelector: input.node_selector ?? "",
    xPct: input.x_pct,
    yPct: input.y_pct,
    anchorJson: input.anchor ? JSON.stringify(input.anchor) : null,
    slideIndex: input.slide_index ?? null,
    body: input.body ?? "",
    authorId: "local",
    artifactRevision: input.artifact_revision ?? null,
    artifactDigest: input.artifact_digest ?? null,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(commentsTable).values(row);
  return toComment(row);
}

export async function updateProjectComment(
  projectId: string,
  commentId: string,
  patch: UpdateCommentRequest,
): Promise<Comment | null> {
  const db = getDb();
  const now = Date.now();
  const updates: Partial<typeof commentsTable.$inferInsert> = {
    updatedAt: now,
  };
  if (patch.body !== undefined) updates.body = patch.body;
  if (patch.resolved !== undefined) {
    updates.resolvedAt = patch.resolved ? now : null;
  }

  await db
    .update(commentsTable)
    .set(updates)
    .where(
      and(
        eq(commentsTable.id, commentId),
        eq(commentsTable.projectId, projectId),
      ),
    );

  const rows = await db
    .select()
    .from(commentsTable)
    .where(
      and(
        eq(commentsTable.id, commentId),
        eq(commentsTable.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ? toComment(rows[0]) : null;
}
