import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { fingerprintHtmlNode } from "../src/services/file-patch";
import { artifactOperationRoutes } from "../src/routes/artifact-operations";

const projectId = `artifact-routes-${process.pid}`;
const sessionId = `${projectId}-session`;
let root = "";

beforeAll(async () => {
  await runMigrations();
  root = await mkdtemp(path.join(tmpdir(), "burnguard-artifact-routes-"));
  await writeFile(path.join(root, "index.html"), '<h1 data-bg-node-id="hero">Base</h1>');
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, root);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
});
afterAll(async () => {
  getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
  await rm(root, { recursive: true, force: true });
});

type PatchRouteBody = { readonly data: { readonly operation_id: string; readonly result_revision: number; readonly result_digest: string } };

describe("production artifact mutation routes", () => {
  test("Given invalid or missing route inputs When production boundaries parse them Then stable statuses reject before mutation", async () => {
    const requests = [
      artifactOperationRoutes.request("http://local/api/projects/missing/fs/index.html/undo-info"),
      artifactOperationRoutes.request("http://local/api/projects/missing/fs/index.html", { method: "PATCH" }),
      artifactOperationRoutes.request("http://local/api/projects/missing/fs/index.html/undo", { method: "POST" }),
      artifactOperationRoutes.request("http://local/api/projects/missing/operations"),
      artifactOperationRoutes.request(`http://local/api/projects/${projectId}/operations/missing`),
      artifactOperationRoutes.request("http://local/api/projects/missing/operations/op/undo", { method: "POST" }),
    ];
    expect((await Promise.all(requests)).map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404]);
    expect((await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/fs/`, { method: "PATCH" })).status).toBe(400);
    expect((await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/fs/index.html`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "null" })).status).toBe(400);
    expect((await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/fs/index.html`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(400);
    expect((await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/operations/missing/undo`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(400);
    expect((await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/fs/index.html/undo`, { method: "POST" })).status).toBe(404);
  });

  test("Given unsafe URL attributes When PATCH is rejected Then bytes, identity and operation history remain unchanged", async () => {
    const db = getSqlite();
    const projectId = `unsafe-attribute-routes-${process.pid}`;
    const root = await mkdtemp(path.join(tmpdir(), "burnguard-unsafe-attribute-routes-"));
    try {
      await writeFile(path.join(root, "index.html"), '<a data-bg-node-id="hero" href="#safe">Base</a>');
      db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, root);
      db.prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(`${projectId}-session`, projectId);
      const base = await new ArtifactCoordinator(db).initialize(projectId, root);
      const source = await readFile(path.join(root, "index.html"), "utf8");
      const file = base.files[0];
      if (file === undefined) throw new Error("fixture file missing");
      const identity = { expected_revision: 0, expected_artifact_digest: base.tree_digest, expected_file_hash: file.sha256, node_bg_id: "hero", node_fingerprint: fingerprintHtmlNode(source, "hero").fingerprint };
      const projectBefore = db.query("SELECT current_revision,current_digest FROM projects WHERE id=?").get(projectId);
      const operationsBefore = db.query("SELECT * FROM artifact_operations WHERE project_id=? ORDER BY id").all(projectId);
      for (const attributes of [
        { href: "javascript:alert(1)" }, { src: "javascript:alert(1)" },
        { href: "data:text/html,<script>alert(1)</script>" },
        { HREF: "java&#x09;script&colon;alert(1)" }, { SRC: " \tJaVa\nScRiPt:alert(1)" },
      ]) {
        const response = await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/fs/index.html`, {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...identity, text: "Must not change", styles: { color: "red" }, attributes: { title: "Must not change", ...attributes } }),
        });
        expect(response.status).toBe(422);
        expect(await response.json()).toMatchObject({ error: { code: "invalid_attribute_url" } });
        expect(await readFile(path.join(root, "index.html"), "utf8")).toBe(source);
        expect(db.query("SELECT current_revision,current_digest FROM projects WHERE id=?").get(projectId)).toEqual(projectBefore);
        expect(db.query("SELECT * FROM artifact_operations WHERE project_id=? ORDER BY id").all(projectId)).toEqual(operationsBefore);
      }
    } finally {
      db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Given exact identity When patch, anchors, operation reads and undo use production routes Then durable receipts remain authoritative", async () => {
    const base = await new ArtifactCoordinator(getSqlite()).initialize(projectId, root);
    const source = await readFile(path.join(root, "index.html"), "utf8");
    const file = base.files[0];
    if (file === undefined) throw new Error("fixture file missing");
    const node = fingerprintHtmlNode(source, "hero");
    const identity = { expected_revision: 0, expected_artifact_digest: base.tree_digest, expected_file_hash: file.sha256, node_bg_id: "hero", node_fingerprint: node.fingerprint };
    const invalidPatches = [
      { ...identity, node_bg_id: "" }, { ...identity, text: 1 }, { ...identity, attributes: [] },
      { ...identity, attributes: { title: 1 } }, { ...identity, styles: [] }, { ...identity, styles: { color: 1 } },
    ];
    for (const body of invalidPatches) {
      const response = await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/fs/index.html`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(response.status).toBe(400);
    }
    const missingNode = await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/fs/index.html`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...identity, node_bg_id: "missing" }) });
    expect(missingNode.status).toBe(404);
    const patchResponse = await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/fs/index.html`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...identity, text: "Patched", attributes: { title: "changed" }, styles: { color: "red" } }),
    });
    expect(patchResponse.status).toBe(200);
    const patchBody: PatchRouteBody = await patchResponse.json();
    const operationId = patchBody.data.operation_id;
    expect(await readFile(path.join(root, "index.html"), "utf8")).toContain("Patched");

    const stale = await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/fs/index.html`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected_revision: 0, expected_artifact_digest: base.tree_digest, expected_file_hash: file.sha256, node_bg_id: "hero", node_fingerprint: node.fingerprint, text: "Stale" }) });
    expect(stale.status).toBe(409);
    expect((await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/operations`)).status).toBe(200);
    expect((await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/operations/${operationId}`)).status).toBe(200);
    expect((await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/fs/index.html/undo-info`)).status).toBe(200);
    const undo = await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/operations/${operationId}/undo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected_revision: patchBody.data.result_revision, expected_artifact_digest: patchBody.data.result_digest }) });
    expect(undo.status).toBe(200);
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe(source);
  });

  test("Given a corrupt persisted receipt When operation API reads Then it returns typed conflict without touching bytes", async () => {
    const before = await readFile(path.join(root, "index.html"));
    const initialization = getSqlite().query<{ readonly id: string }, [string]>("SELECT id FROM artifact_operations WHERE project_id=? AND json_extract(replay_json,'$.kind')='initialize' LIMIT 1").get(projectId);
    if (initialization === null) throw new Error("initialization receipt missing");
    getSqlite().prepare("UPDATE artifact_operations SET snapshot_json=json_set(snapshot_json,'$.unknown',1) WHERE id=?").run(initialization.id);
    const response = await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/operations`);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "corrupt_artifact_operation" } });
    expect((await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/fs/index.html/undo-info`)).status).toBe(409);
    expect((await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/operations/${initialization.id}`)).status).toBe(409);
    expect(await readFile(path.join(root, "index.html"))).toEqual(before);
  });
});
