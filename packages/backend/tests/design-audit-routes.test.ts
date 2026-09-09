import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseDesignAuditResult } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir } from "../src/lib/paths";
import { artifactOperationRoutes } from "../src/routes/artifact-operations";
import { artifactRoutes } from "../src/routes/artifacts";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { resetChromiumCapability, setChromiumCapabilityForTesting } from "../src/services/chromium-capability";

const projectId = `audit-route-${process.pid}`;
const root = path.join(projectsDir, projectId);
const html = `<!doctype html><html><head><style>:root{--text:#111}body{background:#fff;color:#111}</style></head><body><p data-bg-node-id="tiny" style="font-size:9px;color:var(--text)">Tiny</p></body></html>`;

beforeAll(async () => {
  await runMigrations(); await mkdir(root, { recursive: true }); await writeFile(path.join(root, "index.html"), html);
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, "Audit", root);
  await new ArtifactCoordinator(getSqlite()).initialize(projectId, root);
});
beforeEach(() => setChromiumCapabilityForTesting(true));
afterAll(async () => { resetChromiumCapability(); getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId); await rm(root, { recursive: true, force: true }); });

async function data(response: Response): Promise<unknown> { const value: unknown = await response.json(); return typeof value === "object" && value !== null ? Reflect.get(value, "data") : null; }

describe("design audit routes and safe fix", () => {
  test("Given a current project When fetched, fixed, rerun, and undone Then cache and coordinator identity remain coherent", async () => {
    const firstResponse = await artifactRoutes.request(`http://local/api/projects/${projectId}/design-audit`);
    expect(firstResponse.status).toBe(200); const first = parseDesignAuditResult(await data(firstResponse));
    const cached = parseDesignAuditResult(await data(await artifactRoutes.request(`http://local/api/projects/${projectId}/design-audit`)));
    expect(cached).toEqual(first);
    const cachePath = path.join(root, ".meta", "audits", `${first.artifact_revision}-${first.artifact_digest}.json`);
    await writeFile(cachePath, "{corrupt");
    const regenerated = parseDesignAuditResult(await data(await artifactRoutes.request(`http://local/api/projects/${projectId}/design-audit`)));
    expect(regenerated.artifact_digest).toBe(first.artifact_digest);
    const finding = first.checks[2]?.findings[0]; const fix = finding?.safe_fix;
    if (fix === undefined) throw new TypeError("minimum text safe fix missing");
    const patch = await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/fs/${fix.rel_path}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(fix.request) });
    expect(patch.status).toBe(200); const patched = await data(patch); const revision = typeof patched === "object" && patched !== null ? Reflect.get(patched, "result_revision") : null; const digest = typeof patched === "object" && patched !== null ? Reflect.get(patched, "result_digest") : null; const operationId = typeof patched === "object" && patched !== null ? Reflect.get(patched, "operation_id") : null;
    expect(revision).toBe(first.artifact_revision + 1); expect(digest).not.toBe(first.artifact_digest);
    const rerun = parseDesignAuditResult(await data(await artifactRoutes.request(`http://local/api/projects/${projectId}/design-audit/retry`, { method: "POST" })));
    expect(rerun.checks[2]?.findings).toHaveLength(0);
    const undo = await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/operations/${operationId}/undo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected_revision: revision, expected_artifact_digest: digest }) });
    expect(undo.status).toBe(200);
    const restored = parseDesignAuditResult(await data(await artifactRoutes.request(`http://local/api/projects/${projectId}/design-audit/retry`, { method: "POST" })));
    expect(restored.checks[2]?.findings).toHaveLength(1);
  }, 90_000);

  test("Given a nested audit-cache symlink When audited Then typed 503 prevents outside writes", async () => {
    const id = `${projectId}-cache-link`; const projectRoot = path.join(projectsDir, id); const outside = await mkdtemp(path.join(tmpdir(), "bg-audit-cache-outside-"));
    try {
      await mkdir(path.join(projectRoot, ".meta"), { recursive: true }); await writeFile(path.join(projectRoot, "index.html"), html); getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(id, "Cache link", projectRoot); await new ArtifactCoordinator(getSqlite()).initialize(id, projectRoot); await symlink(outside, path.join(projectRoot, ".meta", "audits"));
      const response = await artifactRoutes.request(`http://local/api/projects/${id}/design-audit`); const body = JSON.stringify(await response.json());
      expect(response.status).toBe(503); expect(body).toContain("project_path_unavailable"); expect(body).not.toContain(outside); expect((await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: outside }))).length).toBe(0);
    } finally { getSqlite().prepare("DELETE FROM projects WHERE id=?").run(id); await rm(projectRoot, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });

  test("Given escaped and symlinked DB project paths When audited Then typed 503 responses leak no private path", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "bg-audit-outside-")); const linked = path.join(projectsDir, `${projectId}-linked`); const ids = [`${projectId}-outside`, `${projectId}-linked`] as const;
    try {
      await writeFile(path.join(outside, "index.html"), html); await symlink(outside, linked);
      const insert = getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)"); insert.run(ids[0], "Outside", outside); insert.run(ids[1], "Linked", linked);
      for (const id of ids) { const response = await artifactRoutes.request(`http://local/api/projects/${id}/design-audit`); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain(outside); }
    } finally { for (const id of ids) getSqlite().prepare("DELETE FROM projects WHERE id=?").run(id); await rm(linked, { force: true }); await rm(outside, { recursive: true, force: true }); }
  });
});
