import { Hono } from "hono";
import type { ApiErrorBody, ApiSuccess, PatchFileResponse, ProjectPalette, PatchProjectPaletteResponse } from "@bg/shared";
import { getSqlite } from "../db/sqlite-client";
import { getArtifactOperation, listArtifactOperations } from "../db/artifact-operation-query";
import { getProjectDetail } from "../db/project-read-repository";
import { ArtifactCoordinator, ArtifactOperationError } from "../services/artifact-coordinator";
import { PersistedArtifactOperationError } from "../services/artifact-operation-record";
import { FilePatchError } from "../services/file-patch";
import { readProjectPalette, replaceProjectPalette } from "../services/project-palette";
import { inspectCanonicalTree } from "../services/canonical-tree-manifest";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { artifactHistory } from "../services/artifact-history";

function ok<T>(data: T): ApiSuccess<T> { return { data }; }
function fail(code: string, message: string, details?: unknown): ApiErrorBody { return { error: { code, message, details } }; }

export const artifactOperationRoutes = new Hono();

artifactOperationRoutes.get("/api/projects/:id/history", async c => {
  const project = await getProjectDetail(c.req.param("id"));
  if (!project) return c.json(fail("project_not_found", "Project not found"), 404);
  if (!project.current_digest) return c.json(fail("artifact_identity_unavailable", "Artifact is not initialized"), 409);
  try { return c.json(ok(artifactHistory(getSqlite(), project.id, project.current_revision, project.current_digest))); }
  catch (error) { if (error instanceof PersistedArtifactOperationError) return c.json(fail(error.code, "History could not be read"), 409); throw error; }
});

artifactOperationRoutes.get("/api/projects/:id/palette", async (c) => {
  const project = await getProjectDetail(c.req.param("id"));
  if (!project) return c.json(fail("project_not_found", "Project not found"), 404);
  const relPath = c.req.query("path") ?? project.entrypoint;
  try {
    const root = resolveManagedPath(projectsDir, project.dir_path);
    const palette = await readProjectPalette(root, relPath);
    if (project.current_digest === null || (await inspectCanonicalTree(root)).tree_digest !== project.current_digest) {
      return c.json(fail("stale_artifact_digest", "Artifact changed; reload the page"), 409);
    }
    return c.json(ok({ ...palette, rel_path: relPath, revision: project.current_revision, artifact_digest: project.current_digest } satisfies ProjectPalette));
  } catch (error) {
    if (error instanceof ArtifactOperationError) return c.json(fail(error.code, error.message), 422);
    return c.json(fail("palette_unavailable", "Page colors could not be read"), 422);
  }
});

artifactOperationRoutes.patch("/api/projects/:id/palette", async (c) => {
  const projectId = c.req.param("id");
  const project = await getProjectDetail(projectId);
  if (!project) return c.json(fail("project_not_found", "Project not found"), 404);
  const body: unknown = await c.req.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) return c.json(fail("invalid_palette", "Expected palette change"), 400);
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !["rel_path", "expected_revision", "expected_artifact_digest", "color", "value"].includes(key))) return c.json(fail("invalid_palette", "Unknown palette field"), 400);
  const { rel_path, expected_revision, expected_artifact_digest, color, value } = fields;
  if (typeof rel_path !== "string" || typeof expected_revision !== "number" || !Number.isSafeInteger(expected_revision) || expected_revision < 0 || typeof expected_artifact_digest !== "string" || !/^[a-f0-9]{64}$/.test(expected_artifact_digest) || typeof color !== "string" || !/^#[a-f0-9]{6}$/i.test(color) || typeof value !== "string" || !/^#[a-f0-9]{6}$/i.test(value)) return c.json(fail("invalid_palette", "Page identity and six-digit colors are required"), 400);
  try {
    const root = resolveManagedPath(projectsDir, project.dir_path);
    const result = await new ArtifactCoordinator(getSqlite()).run({ projectId, projectDir: root, kind: "palette", expectedRevision: expected_revision, expectedArtifactDigest: expected_artifact_digest, mutate: (stage) => replaceProjectPalette(stage, rel_path, color.toLowerCase(), value.toLowerCase()) });
    return c.json(ok({ rel_path, operation_id: result.id, result_revision: result.resultRevision, result_digest: result.resultDigest, diff: result.diff, updated_at: Date.now() } satisfies PatchProjectPaletteResponse));
  } catch (error) {
    if (error instanceof ArtifactOperationError) return c.json(fail(error.code, "Page colors could not be changed; reload and try again"), error.code.startsWith("stale_") || error.code === "operation_conflict" ? 409 : 422);
    return c.json(fail("palette_unavailable", "Page colors could not be changed"), 422);
  }
});

// Hono matches routes in declaration order. Keep the specific undo-info
// route before the generic file route so its suffix is not treated as part
// of the relative file path.
artifactOperationRoutes.get("/api/projects/:id/fs/*/undo-info", async (c) => {
  const projectId = c.req.param("id");
  const project = await getProjectDetail(projectId);
  if (!project) {
    return c.json(
      fail("project_not_found", "Project not found", { projectId }),
      404,
    );
  }
  const prefix = `/api/projects/${projectId}/fs/`;
  const rawPath = c.req.path.replace(/\/undo-info$/, "");
  const relPath = rawPath.startsWith(prefix)
    ? decodeURIComponent(rawPath.slice(prefix.length))
    : "";
  if (!relPath) {
    return c.json(fail("invalid_path", "File path is required"), 400);
  }
  try {
    const operationId = project.current_digest ? artifactHistory(getSqlite(), projectId, project.current_revision, project.current_digest).undo_operation_id : null;
    return c.json(ok({ can_undo: operationId !== null, operation_id: operationId }));
  } catch (error) {
    if (error instanceof PersistedArtifactOperationError) return c.json(fail(error.code, error.message), 409);
    throw error;
  }
});

artifactOperationRoutes.patch("/api/projects/:id/fs/*", async (c) => {
  const projectId = c.req.param("id");
  const project = await getProjectDetail(projectId);
  if (!project) {
    return c.json(fail("project_not_found", "Project not found", { projectId }), 404);
  }

  const prefix = `/api/projects/${projectId}/fs/`;
  const rawPath = c.req.path;
  const relPath = rawPath.startsWith(prefix)
    ? decodeURIComponent(rawPath.slice(prefix.length))
    : "";
  if (!relPath) {
    return c.json(fail("invalid_path", "File path is required"), 400);
  }

  const body = await c.req.json<unknown>().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json(fail("invalid_body", "Expected a JSON object"), 400);
  }
  const { expected_revision, expected_artifact_digest, expected_file_hash, node_bg_id, node_fingerprint, text, attributes, styles } = body as Record<string, unknown>;
  if (typeof expected_revision !== "number" || !Number.isSafeInteger(expected_revision) || expected_revision < 0 || typeof expected_artifact_digest !== "string" || typeof expected_file_hash !== "string" || typeof node_fingerprint !== "string") {
    return c.json(fail("invalid_artifact_identity", "expected_revision, expected_artifact_digest, expected_file_hash, and node_fingerprint are required"), 400);
  }
  if (typeof node_bg_id !== "string" || !node_bg_id.trim()) {
    return c.json(
      fail("invalid_node_bg_id", "node_bg_id is required", { node_bg_id }),
      400,
    );
  }
  if (text !== undefined && typeof text !== "string") {
    return c.json(fail("invalid_text", "text must be a string"), 400);
  }
  let validatedAttributes: Record<string, string | null> | undefined;
  if (attributes !== undefined) {
    if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
      return c.json(fail("invalid_attributes", "attributes must be an object"), 400);
    }
    const entries: Array<[string, string | null]> = [];
    for (const [name, value] of Object.entries(attributes)) {
      if (value !== null && typeof value !== "string") {
        return c.json(
          fail("invalid_attr_value", `attributes.${name} must be string or null`),
          400,
        );
      }
      entries.push([name, value]);
    }
    validatedAttributes = Object.fromEntries(entries);
  }
  let validatedStyles: Record<string, string | null> | undefined;
  if (styles !== undefined) {
    if (!styles || typeof styles !== "object" || Array.isArray(styles)) {
      return c.json(fail("invalid_styles", "styles must be an object"), 400);
    }
    const entries: Array<[string, string | null]> = [];
    for (const [name, value] of Object.entries(styles)) {
      if (value !== null && typeof value !== "string") {
        return c.json(
          fail("invalid_style_value", `styles.${name} must be string or null`),
          400,
        );
      }
      entries.push([name, value]);
    }
    validatedStyles = Object.fromEntries(entries);
  }

  try {
    const result = await new ArtifactCoordinator(getSqlite()).patch({
      projectId,
      projectDir: project.dir_path,
      relPath,
      expectedRevision: expected_revision,
      expectedArtifactDigest: expected_artifact_digest,
      expectedFileHash: expected_file_hash,
      nodeBgId: node_bg_id,
      nodeFingerprint: node_fingerprint,
      patch: { node_bg_id, text, attributes: validatedAttributes, styles: validatedStyles },
    });
    return c.json(ok({ rel_path: relPath, node_bg_id, operation_id: result.id, result_revision: result.resultRevision, result_digest: result.resultDigest, diff: result.diff, updated_at: Date.now() } satisfies PatchFileResponse));
  } catch (err) {
    if (err instanceof FilePatchError) {
      const status = err.code === "file_not_found" || err.code === "node_not_found" ? 404 : 422;
      return c.json(fail(err.code, err.message), status);
    }
    if (err instanceof ArtifactOperationError) {
      const status = err.code.startsWith("stale_") || err.code === "operation_conflict" ? 409 : 422;
      return c.json(fail(err.code, err.message), status);
    }
    throw err;
  }
});

// Compatibility route: one step along durable project history, including repeated undo.
artifactOperationRoutes.post("/api/projects/:id/fs/*/undo", async (c) => {
  const projectId = c.req.param("id");
  const project = await getProjectDetail(projectId);
  if (!project) {
    return c.json(
      fail("project_not_found", "Project not found", { projectId }),
      404,
    );
  }
  const prefix = `/api/projects/${projectId}/fs/`;
  const rawPath = c.req.path.replace(/\/undo$/, "");
  const relPath = rawPath.startsWith(prefix)
    ? decodeURIComponent(rawPath.slice(prefix.length))
    : "";
  if (!relPath) {
    return c.json(fail("invalid_path", "File path is required"), 400);
  }
  let operationId: string | null = null;
  try { operationId = project.current_digest ? artifactHistory(getSqlite(), projectId, project.current_revision, project.current_digest).undo_operation_id : null; }
  catch (error) { if (error instanceof PersistedArtifactOperationError) return c.json(fail(error.code, error.message), 409); throw error; }
  if (operationId === null || project.current_digest === null) return c.json(fail("no_undo_available", "No prior patch is available to undo", { relPath }), 404);
  try {
    const result = await new ArtifactCoordinator(getSqlite()).undo({ projectId, projectDir: project.dir_path, operationId, expectedRevision: project.current_revision, expectedArtifactDigest: project.current_digest });
    return c.json(ok({ rel_path: relPath, operation_id: result.id, result_revision: result.resultRevision, result_digest: result.resultDigest, diff: result.diff, updated_at: Date.now() }));
  } catch (error) {
    if (error instanceof ArtifactOperationError) return c.json(fail(error.code, error.message), error.code === "undo_pruned" ? 410 : 409);
    throw error;
  }
});

artifactOperationRoutes.get("/api/projects/:id/operations", async (c) => {
  const projectId = c.req.param("id");
  if (await getProjectDetail(projectId) === null) return c.json(fail("project_not_found", "Project not found", { projectId }), 404);
  try { return c.json(ok(listArtifactOperations(getSqlite(), projectId))); }
  catch (error) { if (error instanceof PersistedArtifactOperationError) return c.json(fail(error.code, error.message), 409); throw error; }
});

artifactOperationRoutes.get("/api/projects/:id/operations/:operationId", async (c) => {
  const projectId = c.req.param("id");
  const operationId = c.req.param("operationId");
  try {
    const row = getArtifactOperation(getSqlite(), projectId, operationId);
    return row === null ? c.json(fail("operation_not_found", "Artifact operation not found", { operationId }), 404) : c.json(ok(row));
  } catch (error) {
    if (error instanceof PersistedArtifactOperationError) return c.json(fail(error.code, error.message), 409);
    throw error;
  }
});

artifactOperationRoutes.post("/api/projects/:id/operations/:operationId/undo", async (c) => {
  const projectId = c.req.param("id");
  const project = await getProjectDetail(projectId);
  if (project === null) return c.json(fail("project_not_found", "Project not found", { projectId }), 404);
  const body = await c.req.json<unknown>().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).some(key => !["expected_revision", "expected_artifact_digest"].includes(key)) || !("expected_revision" in body) || !("expected_artifact_digest" in body) || typeof body.expected_revision !== "number" || !Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0 || typeof body.expected_artifact_digest !== "string" || !/^[a-f0-9]{64}$/.test(body.expected_artifact_digest)) return c.json(fail("invalid_artifact_identity", "Expected artifact identity is required"), 400);
  try {
    const result = await new ArtifactCoordinator(getSqlite()).undo({ projectId, projectDir: project.dir_path, operationId: c.req.param("operationId"), expectedRevision: body.expected_revision, expectedArtifactDigest: body.expected_artifact_digest });
    return c.json(ok({ operation_id: result.id, status: result.status, base_revision: result.baseRevision, base_digest: result.baseDigest, result_revision: result.resultRevision, result_digest: result.resultDigest, diff: result.diff }));
  } catch (error) {
    if (error instanceof ArtifactOperationError) return c.json(fail(error.code, error.message), error.code === "undo_pruned" ? 410 : 409);
    throw error;
  }
});
