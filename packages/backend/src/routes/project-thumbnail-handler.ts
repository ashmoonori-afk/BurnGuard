import type { ApiErrorBody } from "@bg/shared";
import type { Context } from "hono";
import { loadProjectThumbnail } from "../services/project-thumbnails";
import { assertSafeName, PathBoundaryError } from "../security/path-boundary";

const THUMBNAIL_FAILURES = {
  artifact_unavailable: {
    status: 409,
    message: "Project has no rendered artifact yet",
  },
  thumbnail_unavailable: {
    status: 503,
    message: "Thumbnail could not be rendered",
  },
} as const;

export async function serveProjectThumbnail(context: Context) {
  const id = context.req.param("id") ?? "";
  const operationId = context.req.query("operation");
  const side = context.req.query("side");
  if (operationId !== undefined || side !== undefined) {
    if (operationId === undefined || (side !== "before" && side !== "after")) return context.json(fail("invalid_thumbnail_revision", "Expected operation and thumbnail side", id), 400);
    try { assertSafeName(operationId); }
    catch (error) {
      if (error instanceof PathBoundaryError) return context.json(fail("invalid_thumbnail_revision", "Invalid operation identity", id), 400);
      throw error;
    }
  }
  const outcome = await loadProjectThumbnail(id, undefined, undefined, operationId !== undefined && (side === "before" || side === "after") ? { operationId, side } : undefined);
  switch (outcome.kind) {
    case "not_found":
      return context.json(fail("project_not_found", "Project not found", id), 404);
    case "unavailable": {
      const failure = THUMBNAIL_FAILURES[outcome.code];
      return context.json(
        fail(outcome.code, failure.message, id),
        failure.status,
      );
    }
    case "ready": {
      const headers = {
        "Content-Type": "image/png",
        ETag: outcome.etag,
        "Cache-Control": "private, no-cache",
      };
      if (context.req.header("if-none-match") === outcome.etag) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(outcome.bytes, { status: 200, headers });
    }
  }
}

function fail(code: string, message: string, id: string): ApiErrorBody {
  return { error: { code, message, details: { id } } };
}
