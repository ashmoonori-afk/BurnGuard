import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { parseThreeScene, type ThreeSceneDocumentV1 } from "@bg/shared";
import { resolveProjectFile } from "../services/managed-project-files";
import { inspectCanonicalTree } from "../services/canonical-tree-manifest";
import { getSqlite } from "../db/sqlite-client";
import { getProjectDetail } from "../db/project-read-repository";
import { ArtifactCoordinator, ArtifactOperationError } from "../services/artifact-coordinator";
import { readThreeScene, saveThreeScene } from "../services/three-scene";

export const threeSceneRoutes = new Hono();
threeSceneRoutes.all("/api/projects/:id/three-scene", async (c) => {
  const fail = (code: string, status: 400 | 404 | 409 | 422 | 500) => c.json({ error: { code, message: "3D scene request could not be completed" } }, status);
  if (c.req.method !== "GET" && c.req.method !== "PUT") return fail("invalid_method", 400);
  const relPath = c.req.query("path") ?? "";
  if (!/\.html?$/i.test(relPath)) return fail("invalid_scene_path", 400);
  const resolved = await resolveProjectFile(c.req.param("id"), relPath);
  if (!resolved) return fail("file_not_found", 404);
  try {
    const coordinator = new ArtifactCoordinator(getSqlite());
    if (c.req.method === "GET") {
      await coordinator.observeExternal(resolved.project.id, resolved.project.dir_path);
      const project = await getProjectDetail(resolved.project.id);
      const tree = await inspectCanonicalTree(resolved.project.dir_path);
      const file = tree.files.find((entry) => entry.path === resolved.relPath);
      if (!project?.current_digest || !file || file.size > 16 * 1024 * 1024) return fail("artifact_identity_unavailable", 409);
      const scene = readThreeScene(await readFile(resolved.absolutePath, "utf8"));
      return c.json({ data: { schema_version: 1, scene, revision: project.current_revision, artifact_digest: project.current_digest, file_hash: file.sha256 } satisfies ThreeSceneDocumentV1 });
    }
    const body: unknown = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("invalid_three_scene", 400);
    const fields = body as Record<string, unknown>;
    if (Object.keys(fields).some((key) => !["scene", "expected_revision", "expected_artifact_digest", "expected_file_hash"].includes(key)) || !Number.isSafeInteger(fields.expected_revision) || Number(fields.expected_revision) < 0 || typeof fields.expected_artifact_digest !== "string" || !/^[a-f0-9]{64}$/.test(fields.expected_artifact_digest) || typeof fields.expected_file_hash !== "string" || !/^[a-f0-9]{64}$/.test(fields.expected_file_hash)) return fail("invalid_artifact_identity", 400);
    let scene;
    try { scene = parseThreeScene(fields.scene); } catch { return fail("invalid_three_scene", 400); }
    const result = await saveThreeScene(coordinator, { projectId: resolved.project.id, projectDir: resolved.project.dir_path, relPath: resolved.relPath, expectedRevision: fields.expected_revision as number, expectedArtifactDigest: fields.expected_artifact_digest, expectedFileHash: fields.expected_file_hash, scene });
    return c.json({ data: { operation_id: result.id, result_revision: result.resultRevision, result_digest: result.resultDigest } });
  } catch (error) { return fail(error instanceof ArtifactOperationError ? error.code : "three_scene_unavailable", error instanceof ArtifactOperationError && error.code.startsWith("stale_") ? 409 : 422); }
});
