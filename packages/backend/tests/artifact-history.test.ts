import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, symlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrationsFrom } from "../src/db/migrate";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { artifactHistory } from "../src/services/artifact-history";
import { classifyApiRoute } from "../src/server";

test("Given three saves When undoing repeatedly, reopening and choosing a point Then history walks backwards without toggling and retains documents", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "burnguard-history-")), db = new Database(":memory:");
  try {
    await runMigrationsFrom(db, path.join(import.meta.dir, "../src/db/migrations"));
    await writeFile(path.join(root, "index.html"), "initial");
    await mkdir(path.join(root, "docs/attachments"), { recursive: true });
    await writeFile(path.join(root, "docs/attachments/original.pdf"), "immutable source");
    db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES ('p','P','prototype',?,'index.html','codex',1,1)").run(root);
    db.exec("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('s','p','codex','idle',1,1,1)");
    let coordinator = new ArtifactCoordinator(db);
    const initial = await coordinator.initialize("p", root);
    let revision = 0, digest = initial.tree_digest;
    for (const value of ["first", "second", "third"]) {
      const result = await coordinator.run({ projectId: "p", projectDir: root, kind: "turn", expectedRevision: revision, expectedArtifactDigest: digest, mutate: async stage => { await writeFile(path.join(stage, "index.html"), value); } });
      revision = result.resultRevision; digest = result.resultDigest;
    }
    const originalHistory = artifactHistory(db, "p", revision, digest);
    expect(originalHistory.entries.map(entry => entry.revision)).toEqual([2, 1, 0]);
    for (const expected of ["second", "first", "initial"]) {
      coordinator = new ArtifactCoordinator(db); // No process-local cursor is needed.
      const history = artifactHistory(db, "p", revision, digest);
      const result = await coordinator.undo({ projectId: "p", projectDir: root, operationId: history.undo_operation_id!, expectedRevision: revision, expectedArtifactDigest: digest });
      revision = result.resultRevision; digest = result.resultDigest;
      expect(await readFile(path.join(root, "index.html"), "utf8")).toBe(expected);
    }
    expect(artifactHistory(db, "p", revision, digest).undo_operation_id).toBeNull();
    const choice = artifactHistory(db, "p", revision, digest).entries.find(entry => entry.revision === 3)!;
    const restored = await coordinator.undo({ projectId: "p", projectDir: root, operationId: choice.operation_id, expectedRevision: revision, expectedArtifactDigest: digest });
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("third");
    expect(artifactHistory(db, "p", restored.resultRevision, restored.resultDigest).undo_operation_id).toBe(originalHistory.undo_operation_id);
    await expect(coordinator.undo({ projectId: "p", projectDir: root, operationId: choice.operation_id, expectedRevision: revision, expectedArtifactDigest: digest })).rejects.toMatchObject({ code: "stale_revision" });
    await expect(coordinator.undo({ projectId: "foreign", projectDir: root, operationId: choice.operation_id, expectedRevision: revision, expectedArtifactDigest: digest })).rejects.toThrow();
    expect(await readFile(path.join(root, "docs/attachments/original.pdf"), "utf8")).toBe("immutable source");
    expect(classifyApiRoute("/api/projects/p/history", "GET")).toBe("artifact-operations");
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test("Given an external save reverted while a turn ran When history lists it and the user re-applies it Then the live tree equals the capture, a committed operation exists and undo works", async () => {
  const { getSqlite } = await import("../src/db/sqlite-client");
  const { artifactOperationRoutes } = await import("../src/routes/artifact-operations");
  const { getArtifactOperation } = await import("../src/db/artifact-operation-query");
  const { inspectCanonicalTree } = await import("../src/services/canonical-tree-manifest");
  const db = getSqlite(), projectId = `reapply-external-${process.pid}`;
  const root = await mkdtemp(path.join(tmpdir(), "burnguard-reapply-"));
  const json = async (response: Response) => ({ status: response.status, body: await response.json() as { data?: any; error?: { code: string } } });
  const history = async () => json(await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/history`));
  const post = async (url: string, identity: { revision: number; digest: string }) => json(await artifactOperationRoutes.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected_revision: identity.revision, expected_artifact_digest: identity.digest }) }));
  const gatedTurn = async (identity: { revision: number; digest: string }) => {
    let release!: () => void, prepared!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { prepared = resolve; });
    const run = new ArtifactCoordinator(db).run({ projectId, projectDir: root, kind: "turn", expectedRevision: identity.revision, expectedArtifactDigest: identity.digest, onPrepared: prepared, mutate: async stage => { await gate; await writeFile(path.join(stage, "index.html"), "generated"); } });
    await ready;
    return { run, release };
  };
  try {
    await writeFile(path.join(root, "index.html"), "base");
    db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, root);
    const base = await new ArtifactCoordinator(db).initialize(projectId, root);
    const turn = await gatedTurn({ revision: 0, digest: base.tree_digest });
    await writeFile(path.join(root, "index.html"), "my external save");
    await writeFile(path.join(root, "notes.html"), "new file");
    const capture = await new ArtifactCoordinator(db).observeExternal(projectId, root);
    expect(capture).toMatchObject({ status: "conflicted" });
    turn.release();
    await expect(turn.run).rejects.toThrow();
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("base");

    const listed = await history();
    expect(listed.status).toBe(200);
    expect(listed.body.data.external_captures).toEqual([{ operation_id: capture!.id, captured_at: expect.any(Number), file_count: 2 }]);
    expect(JSON.stringify(listed.body)).not.toContain(root);

    const busy = await gatedTurn({ revision: 0, digest: base.tree_digest });
    expect(await post(`http://local/api/projects/${projectId}/operations/${capture!.id}/reapply`, { revision: 0, digest: base.tree_digest })).toMatchObject({ status: 409, body: { error: { code: "operation_conflict" } } });
    busy.release();
    const generated = await busy.run;
    await new ArtifactCoordinator(db).undo({ projectId, projectDir: root, operationId: generated.id, expectedRevision: generated.resultRevision, expectedArtifactDigest: generated.resultDigest });
    const identity = { revision: generated.resultRevision + 1, digest: base.tree_digest };

    const reapplied = await post(`http://local/api/projects/${projectId}/operations/${capture!.id}/reapply`, identity);
    expect(reapplied.status).toBe(200);
    const captured = await inspectCanonicalTree(path.join(root, ".meta", "artifact-operations", capture!.id, "stage"));
    expect((await inspectCanonicalTree(root)).tree_digest).toBe(captured.tree_digest);
    expect(reapplied.body.data.result_digest).toBe(captured.tree_digest);
    expect(getArtifactOperation(db, projectId, reapplied.body.data.operation_id)).toMatchObject({ status: "committed", replay: { kind: "reapply_external", parent_operation_id: capture!.id } });
    const after = await history();
    expect(after.body.data.external_captures).toEqual([]);
    expect(after.body.data.undo_operation_id).toBe(reapplied.body.data.operation_id);

    const undone = await post(`http://local/api/projects/${projectId}/operations/${reapplied.body.data.operation_id}/undo`, { revision: reapplied.body.data.result_revision, digest: reapplied.body.data.result_digest });
    expect(undone.status).toBe(200);
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("base");
    expect(await Bun.file(path.join(root, "notes.html")).exists()).toBe(false);

    db.prepare("UPDATE artifact_operations SET retention_json=json_set(retention_json,'$.retained_until',?) WHERE id=?").run(Date.now() - 1, capture!.id);
    expect(await post(`http://local/api/projects/${projectId}/operations/${capture!.id}/reapply`, { revision: undone.body.data.result_revision, digest: undone.body.data.result_digest })).toMatchObject({ status: 410, body: { error: { code: "capture_expired" } } });
    expect(classifyApiRoute(`/api/projects/${projectId}/operations/${capture!.id}/reapply`, "POST")).toBe("artifact-operations");
  } finally { db.prepare("DELETE FROM projects WHERE id=?").run(projectId); await rm(root, { recursive: true, force: true }); }
});

/** Captures an external save that a gated turn then reverts; returns the identity of the restored base tree. */
async function revertedExternalCapture(projectId: string, root: string) {
  const { getSqlite } = await import("../src/db/sqlite-client");
  const db = getSqlite();
  await writeFile(path.join(root, "index.html"), "base");
  db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, root);
  const base = await new ArtifactCoordinator(db).initialize(projectId, root);
  let release!: () => void, prepared!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { prepared = resolve; });
  const turn = new ArtifactCoordinator(db).run({ projectId, projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, onPrepared: prepared, mutate: async stage => { await gate; await writeFile(path.join(stage, "index.html"), "generated"); } });
  await ready;
  await writeFile(path.join(root, "index.html"), "my external save");
  const capture = await new ArtifactCoordinator(db).observeExternal(projectId, root);
  release();
  await expect(turn).rejects.toThrow();
  return { db, capture: capture!, identity: { revision: 0, digest: base.tree_digest } };
}

test("Given a retained external edit and a later generation that rewrote the same file When re-applying Then it is refused with reapply_conflict and nothing is written", async () => {
  const { getSqlite } = await import("../src/db/sqlite-client");
  const { artifactOperationRoutes } = await import("../src/routes/artifact-operations");
  const projectId = `reapply-conflict-${process.pid}`, root = await mkdtemp(path.join(tmpdir(), "burnguard-reapply-conflict-"));
  try {
    const { db, capture, identity } = await revertedExternalCapture(projectId, root);
    const later = await new ArtifactCoordinator(db).run({ projectId, projectDir: root, kind: "turn", expectedRevision: identity.revision, expectedArtifactDigest: identity.digest, mutate: async stage => { await writeFile(path.join(stage, "index.html"), "later generation"); } });
    const response = await artifactOperationRoutes.request(`http://local/api/projects/${projectId}/operations/${capture.id}/reapply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected_revision: later.resultRevision, expected_artifact_digest: later.resultDigest }) });
    expect(response.status).toBe(409);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("reapply_conflict");
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("later generation");
    expect(await Bun.file(path.join(root, "notes.html")).exists()).toBe(false);
    expect(getSqlite().query("SELECT COUNT(*) AS n FROM artifact_operations WHERE project_id=? AND status='committed' AND json_extract(replay_json,'$.kind')='reapply_external'").get(projectId)).toEqual({ n: 0 });
  } finally { (await import("../src/db/sqlite-client")).getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId); await rm(root, { recursive: true, force: true }); }
});

test("Given a retained external edit captured through a symlinked or junctioned parent directory When re-applying through the real path Then the stored storage path still matches and the edit is restored", async () => {
  const projectId = `reapply-link-${process.pid}`, parent = await mkdtemp(path.join(tmpdir(), "burnguard-reapply-link-")), link = `${parent}-link`, root = path.join(parent, "project");
  try {
    await mkdir(root);
    await symlink(parent, link, process.platform === "win32" ? "junction" : "dir");
    const { db, capture, identity } = await revertedExternalCapture(projectId, path.join(link, "project"));
    const operation = await new ArtifactCoordinator(db).reapplyExternal({ projectId, projectDir: root, operationId: capture.id, expectedRevision: identity.revision, expectedArtifactDigest: identity.digest });
    expect(operation.status).toBe("committed");
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("my external save");
  } finally { (await import("../src/db/sqlite-client")).getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId); await rm(link, { recursive: true, force: true }); await rm(parent, { recursive: true, force: true }); }
});
