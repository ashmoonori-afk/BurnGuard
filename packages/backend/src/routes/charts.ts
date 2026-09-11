import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { parseChart, type ChartDocumentV1 } from "@bg/shared";
import { resolveProjectFile } from "../services/managed-project-files";
import { inspectCanonicalTree } from "../services/canonical-tree-manifest";
import { getSqlite } from "../db/sqlite-client";
import { getProjectDetail } from "../db/project-read-repository";
import { ArtifactCoordinator, ArtifactOperationError } from "../services/artifact-coordinator";
import { readCharts, saveChart } from "../services/charts";

export const chartRoutes = new Hono();
chartRoutes.all("/api/projects/:id/charts", async c => {
  const fail = (code: string, status: 400 | 404 | 409 | 422) => c.json({ error: { code, message: "차트를 처리하지 못했어요. 데이터와 저장본을 확인해 주세요." } }, status);
  if (c.req.method !== "GET" && c.req.method !== "PUT") return fail("invalid_method", 400);
  const relPath = c.req.query("path") ?? "";
  if (!/\.html?$/i.test(relPath)) return fail("invalid_chart_path", 400);
  const resolved = await resolveProjectFile(c.req.param("id"), relPath);
  if (!resolved) return fail("file_not_found", 404);
  try {
    const coordinator = new ArtifactCoordinator(getSqlite());
    if (c.req.method === "GET") {
      await coordinator.observeExternal(resolved.project.id, resolved.project.dir_path);
      const project = await getProjectDetail(resolved.project.id), tree = await inspectCanonicalTree(resolved.project.dir_path);
      const file = tree.files.find(entry => entry.path === resolved.relPath);
      if (!project?.current_digest || !file || file.size > 16 * 1024 * 1024) return fail("artifact_identity_unavailable", 409);
      return c.json({ data: { schema_version: 1, charts: readCharts(await readFile(resolved.absolutePath, "utf8")), revision: project.current_revision, artifact_digest: project.current_digest, file_hash: file.sha256 } satisfies ChartDocumentV1 });
    }
    const body: unknown = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("invalid_chart", 400);
    const fields = body as Record<string, unknown>;
    if (Object.keys(fields).some(key => !["chart", "expected_revision", "expected_artifact_digest", "expected_file_hash"].includes(key)) || !Number.isSafeInteger(fields.expected_revision) || Number(fields.expected_revision) < 0 || typeof fields.expected_artifact_digest !== "string" || !/^[a-f0-9]{64}$/.test(fields.expected_artifact_digest) || typeof fields.expected_file_hash !== "string" || !/^[a-f0-9]{64}$/.test(fields.expected_file_hash)) return fail("invalid_artifact_identity", 400);
    let chart;
    try { chart = parseChart(fields.chart); } catch { return fail("invalid_chart", 400); }
    const result = await saveChart(coordinator, { projectId: resolved.project.id, projectDir: resolved.project.dir_path, relPath: resolved.relPath, expectedRevision: fields.expected_revision as number, expectedArtifactDigest: fields.expected_artifact_digest, expectedFileHash: fields.expected_file_hash, chart });
    return c.json({ data: { operation_id: result.id, result_revision: result.resultRevision, result_digest: result.resultDigest } });
  } catch (error) { return fail(error instanceof ArtifactOperationError ? error.code : "chart_unavailable", error instanceof ArtifactOperationError && error.code.startsWith("stale_") ? 409 : 422); }
});
