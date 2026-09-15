import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { commentRoutes } from "../src/routes/comments";
import { managedFileRoutes } from "../src/routes/managed-files";
import type { Comment } from "@bg/shared";

const projectId = `anchor-routes-${process.pid}`;
let root = "";
let digest = "";
const headers = { "content-type": "application/json" };

beforeAll(async () => {
  await runMigrations(); root = await mkdtemp(path.join(tmpdir(), "burnguard-anchor-routes-"));
  await writeFile(path.join(root, "index.html"), '<h1 data-bg-node-id="hero">Base</h1>');
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, root);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(`${projectId}-session`, projectId);
  digest = (await new ArtifactCoordinator(getSqlite()).initialize(projectId, root)).tree_digest;
});
afterAll(async () => { getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId); await rm(root, { recursive: true, force: true }); });

function comment(body: unknown): Promise<Response> { return commentRoutes.request(`http://local/api/projects/${projectId}/comments`, { method: "POST", headers, body: JSON.stringify(body) }); }

describe("production artifact anchor routes", () => {
  test("Given node-relative comment coordinates When saved and read again Then exact anchors survive and malformed versions reject", async () => {
    const input = { rel_path: "index.html", node_selector: '[data-bg-node-id="hero"]', x_pct: 12, y_pct: 8, artifact_revision: 0, artifact_digest: digest };
    const anchor = { version: 1, x_pct: 37.5, y_pct: 64.25 };
    const response = await comment({ ...input, anchor });
    expect(response.status).toBe(201);
    const created: { data: Comment } = await response.json();
    const listed: { data: Comment[] } = await (await commentRoutes.request(`http://local/api/projects/${projectId}/comments`)).json();
    expect(listed.data.find(row => row.id === created.data.id)?.anchor).toEqual(anchor);
    for (const invalid of [{ ...anchor, version: 2 }, { ...anchor, x_pct: -1 }, { ...anchor, y_pct: 101 }, { ...anchor, x_pct: "37.5" }, { version: 1 }, { ...anchor, selector: "body" }, []]) {
      const rejected = await comment({ ...input, anchor: invalid });
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({ error: { code: "invalid_comment_anchor" } });
    }
    const legacy: { data: Comment } = await (await comment(input)).json();
    expect(legacy.data.anchor).toBeNull();
  });
  test("Given source and draw boundaries When identity is exact Then headers and sidecar anchors are authoritative", async () => {
    expect((await managedFileRoutes.request("http://local/api/projects/missing/fs/index.html")).status).toBe(404);
    expect((await managedFileRoutes.request(`http://local/api/projects/${projectId}/fs/missing.html`)).status).toBe(404);
    const source = await managedFileRoutes.request(`http://local/api/projects/${projectId}/fs/index.html?node_bg_id=hero`);
    expect(source.status).toBe(200); expect(source.headers.get("x-burnguard-artifact-digest")).toBe(digest); expect(source.headers.get("x-burnguard-node-fingerprint")).toMatch(/^[0-9a-f]{64}$/);
    const draw = await managedFileRoutes.request(`http://local/api/projects/${projectId}/draws/index.html`, { method: "PUT", headers: { "content-type": "image/svg+xml", "x-burnguard-revision": "0", "if-match": digest }, body: "<svg/>" });
    expect(draw.status).toBe(200);
    expect((await managedFileRoutes.request(`http://local/api/projects/${projectId}/draws/index.html`, { method: "PUT", headers: { "content-type": "image/svg+xml", "x-burnguard-revision": "0", "if-match": "stale" }, body: "<svg/>" })).status).toBe(409);
  });

  test("Given comment payload boundaries When parsed Then invalid anchors reject and valid updates persist", async () => {
    expect((await comment(null)).status).toBe(400);
    expect((await comment({ x_pct: 1, y_pct: 2, artifact_revision: 0, artifact_digest: digest })).status).toBe(400);
    expect((await comment({ rel_path: "index.html", x_pct: -1, y_pct: 2, artifact_revision: 0, artifact_digest: digest })).status).toBe(400);
    expect((await comment({ rel_path: "index.html", x_pct: 1, y_pct: 101, artifact_revision: 0, artifact_digest: digest })).status).toBe(400);
    expect((await comment({ rel_path: "index.html", x_pct: 1, y_pct: 2, slide_index: -1, artifact_revision: 0, artifact_digest: digest })).status).toBe(400);
    expect((await comment({ rel_path: "index.html", x_pct: 1, y_pct: 2, artifact_revision: 0, artifact_digest: "stale" })).status).toBe(409);
    const created = await comment({ rel_path: "index.html", x_pct: 1, y_pct: 2, body: "anchor", artifact_revision: 0, artifact_digest: digest });
    expect(created.status).toBe(201);
    const body: { readonly data: { readonly id: string } } = await created.json();
    expect((await commentRoutes.request(`http://local/api/projects/${projectId}/comments`)).status).toBe(200);
    expect((await commentRoutes.request(`http://local/api/projects/${projectId}/comments/${body.data.id}`, { method: "PATCH", headers, body: JSON.stringify({ body: "updated", resolved: true }) })).status).toBe(200);
    expect((await commentRoutes.request(`http://local/api/projects/${projectId}/comments/missing`, { method: "PATCH", headers, body: JSON.stringify({ body: "x" }) })).status).toBe(404);
  });
});
