import { Hono } from "hono";
import type {
  ApiErrorBody,
  ApiSuccess,
  Comment,
  UpdateCommentRequest,
} from "@bg/shared";
import {
  createProjectComment,
  listProjectComments,
  updateProjectComment,
} from "../db/comments";
import { getProjectDetail } from "../db/project-read-repository";
import { ArtifactIdentityError, requireArtifactIdentity } from "../services/artifact-identity";
import { parseCommentAnchor } from "@bg/shared";

function ok<T>(data: T): ApiSuccess<T> {
  return { data };
}

function fail(
  code: string,
  message: string,
  details?: unknown,
): ApiErrorBody {
  return { error: { code, message, details } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export const commentRoutes = new Hono();

commentRoutes.get("/api/projects/:id/comments", async (c) => {
  const id = c.req.param("id");
  const project = await getProjectDetail(id);
  if (!project) {
    return c.json(fail("project_not_found", "Project not found", { id }), 404);
  }
  const rows = await listProjectComments(id);
  return c.json(ok(rows satisfies Comment[]));
});

commentRoutes.post("/api/projects/:id/comments", async (c) => {
  const id = c.req.param("id");
  const project = await getProjectDetail(id);
  if (!project) {
    return c.json(fail("project_not_found", "Project not found", { id }), 404);
  }

  const body = await c.req.json<unknown>().catch(() => null);
  if (!isRecord(body)) {
    return c.json(
      fail("invalid_body", "Expected a JSON object request body"),
      400,
    );
  }

  const {
    rel_path,
    node_selector,
    x_pct,
    y_pct,
    slide_index,
    body: commentBody,
    artifact_revision,
    artifact_digest,
  } = body;
  if (typeof rel_path !== "string" || rel_path.trim().length === 0) {
    return c.json(
      fail("invalid_rel_path", "rel_path is required", { rel_path }),
      400,
    );
  }
  // Pin coordinates are normalised percentages — values outside 0..100
  // would render off the canvas and be unclickable. Reject up front so
  // a misbehaving client can't poison the comments table with
  // unreachable pins (audit fix).
  if (
    typeof x_pct !== "number" ||
    !Number.isFinite(x_pct) ||
    x_pct < 0 ||
    x_pct > 100
  ) {
    return c.json(
      fail("invalid_x_pct", "x_pct must be a number in 0..100", { x_pct }),
      400,
    );
  }
  if (
    typeof y_pct !== "number" ||
    !Number.isFinite(y_pct) ||
    y_pct < 0 ||
    y_pct > 100
  ) {
    return c.json(
      fail("invalid_y_pct", "y_pct must be a number in 0..100", { y_pct }),
      400,
    );
  }
  let slideIndex: number | null | undefined;
  const positionAnchor = body.anchor == null ? null : parseCommentAnchor(body.anchor);
  if (body.anchor != null && !positionAnchor) return c.json(fail("invalid_comment_anchor", "Invalid comment position anchor"), 400);
  if (slide_index === undefined || slide_index === null) {
    slideIndex = slide_index;
  } else if (
    typeof slide_index === "number" &&
    Number.isInteger(slide_index) &&
    slide_index >= 0
  ) {
    slideIndex = slide_index;
  } else {
    return c.json(
      fail("invalid_slide_index", "slide_index must be a non-negative integer or null"),
      400,
    );
  }

  let anchor: { readonly revision: number; readonly digest: string };
  try { anchor = requireArtifactIdentity({ revision: artifact_revision, digest: artifact_digest }, { revision: project.current_revision, digest: project.current_digest }); }
  catch (error) {
    if (error instanceof ArtifactIdentityError) return c.json(fail(error.code, error.message, { current_revision: project.current_revision, current_digest: project.current_digest }), error.code === "invalid_artifact_identity" ? 400 : 409);
    throw error;
  }

  const created = await createProjectComment(id, {
    rel_path,
    node_selector: typeof node_selector === "string" ? node_selector : undefined,
    x_pct,
    y_pct,
    anchor: positionAnchor,
    slide_index: slideIndex,
    body: typeof commentBody === "string" ? commentBody : undefined,
    artifact_revision: anchor.revision,
    artifact_digest: anchor.digest,
  });

  return c.json(ok(created), 201);
});

commentRoutes.patch("/api/projects/:id/comments/:commentId", async (c) => {
  const id = c.req.param("id");
  const commentId = c.req.param("commentId");
  const project = await getProjectDetail(id);
  if (!project) {
    return c.json(fail("project_not_found", "Project not found", { id }), 404);
  }

  const body = await c.req.json<unknown>().catch(() => null);
  if (!isRecord(body)) {
    return c.json(
      fail("invalid_body", "Expected a JSON object request body"),
      400,
    );
  }

  const patch: UpdateCommentRequest = {};
  if ("body" in body) {
    if (typeof body.body !== "string") {
      return c.json(fail("invalid_body_field", "body must be a string"), 400);
    }
    patch.body = body.body;
  }
  if ("resolved" in body) {
    if (typeof body.resolved !== "boolean") {
      return c.json(fail("invalid_resolved", "resolved must be a boolean"), 400);
    }
    patch.resolved = body.resolved;
  }

  const updated = await updateProjectComment(id, commentId, patch);
  if (!updated) {
    return c.json(
      fail("comment_not_found", "Comment not found", { commentId }),
      404,
    );
  }
  return c.json(ok(updated));
});
