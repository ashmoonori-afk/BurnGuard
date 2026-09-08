import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrationsFrom } from "../src/db/migrate";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { deleteProject, reconcileProjectDeletions } from "../src/services/project-deletion";
import { reconcileArtifactState } from "../src/services/artifact-recovery";
import { scheduleProjectSignal } from "../src/services/watchers";
import { releaseUserTurnReservation, reserveUserTurn } from "../src/services/turns";
import { pruneExpiredArtifactOperations } from "../src/services/artifact-retention";

let db: Database;
let root: string;
let projectDir: string;
beforeEach(async () => {
  db = new Database(":memory:");
  await runMigrationsFrom(db, path.join(import.meta.dir, "../src/db/migrations"));
  root = await mkdtemp(path.join(tmpdir(), "bg-review-artifact-"));
  projectDir = path.join(root, "p");
  await mkdir(projectDir);
  await writeFile(path.join(projectDir, "index.html"), "base");
  db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES ('p','P','prototype',?,'index.html','codex',1,1)").run(projectDir);
  db.exec("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('review-s','p','codex','idle',1,1,1)");
});
afterEach(async () => { db.close(); await rm(root, { recursive: true, force: true }); });

test("Given a stale observer receipt left by an older process When startup recovers Then the newer committed identity stays intact", async () => {
  const coordinator = new ArtifactCoordinator(db);
  await coordinator.initialize("p", projectDir);
  await writeFile(path.join(projectDir, "index.html"), "External");
  const committed = await coordinator.observeExternal("p", projectDir);
  if (committed === null) throw new Error("missing external operation");
  db.prepare("UPDATE artifact_operations SET status='working' WHERE id=?").run(committed.id);
  await reconcileArtifactState(db);
  expect(db.query<{ count: number }, []>("SELECT COUNT(*) count FROM artifact_operations WHERE status IN ('working','pending','recovering')").get()?.count).toBe(0);
  expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("External");
  expect(db.query("SELECT current_revision,current_digest FROM projects WHERE id='p'").get()).toEqual({ current_revision: 1, current_digest: committed.resultDigest });
}, 30_000);

test("Given retained learning When deleting Then neither files nor database rows change", async () => {
  db.exec(`INSERT INTO learning_items(id,kind,title,content_json,created_at,updated_at) VALUES ('i','lesson','I','{}',1,1);
    INSERT INTO learning_checkpoints(id,item_id,project_id,artifact_revision,artifact_digest,feedback,next_context_json,created_at) VALUES ('c','i','p',0,'digest','feedback','{}',1);`);
  await expect(deleteProject(db, "p", { projectsRoot: root })).rejects.toMatchObject({ code: "project_in_use" });
  expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("base");
  expect(db.query("SELECT id FROM projects WHERE id='p'").get()).toEqual({ id: "p" });
});

test("Given a database delete failure after staging When deleting Then exact original files are restored", async () => {
  await expect(deleteProject(db, "p", { projectsRoot: root, beforeDatabaseDelete: () => { throw new Error("injected failure"); } })).rejects.toMatchObject({ code: "project_delete_failed" });
  expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("base");
  expect(db.query("SELECT id FROM projects WHERE id='p'").get()).not.toBeNull();
  expect(existsSync(path.join(root, ".deletions", "p"))).toBe(false);
});

test("Given a reserved turn When deleting Then project stays intact before the process starts", async () => {
  const reservation = reserveUserTurn("review-s");
  if (reservation === null) throw new Error("reservation unavailable");
  try { await expect(deleteProject(db, "p", { projectsRoot: root })).rejects.toMatchObject({ code: "project_in_use" }); }
  finally { releaseUserTurnReservation(reservation); }
  expect(existsSync(projectDir)).toBe(true);
});

test("Given an ordinary project When deleting Then its row and managed bytes are removed", async () => {
  await deleteProject(db, "p", { projectsRoot: root });
  expect(db.query("SELECT id FROM projects WHERE id='p'").get()).toBeNull();
  expect(existsSync(projectDir)).toBe(false);
});

test("Given a crash after rename When startup reconciles Then a rolled back row restores its files", async () => {
  const tombstone = path.join(root, ".deletions", "p");
  const stageDeletion = async () => {
    await mkdir(tombstone, { recursive: true });
    await writeFile(path.join(tombstone, "receipt.json"), JSON.stringify({ schema_version: 1, project_id: "p", source_relative_path: "p" }));
    await rename(projectDir, path.join(tombstone, "files"));
  };
  await stageDeletion();
  await reconcileProjectDeletions(db, root);
  expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("base");
  await stageDeletion();
  db.exec("DELETE FROM projects WHERE id='p'");
  await reconcileProjectDeletions(db, root);
  expect(existsSync(path.join(root, ".deletions", "p"))).toBe(false);
});

test("Given an unrecognized deletion directory When startup reconciles Then unrelated bytes are preserved", async () => {
  const unknown = path.join(root, ".deletions", "unknown");
  await mkdir(unknown, { recursive: true });
  await writeFile(path.join(unknown, "keep.txt"), "keep");
  await expect(reconcileProjectDeletions(db, root)).rejects.toThrow();
  expect(await readFile(path.join(unknown, "keep.txt"), "utf8")).toBe("keep");
});

test("Given a legacy path outside managed storage When deleting Then external bytes remain", async () => {
  const managed = path.join(root, "managed");
  await mkdir(managed);
  await deleteProject(db, "p", { projectsRoot: managed });
  expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("base");
});

test("Given two external saves during commit When observing Then live database and baseline converge and recover", async () => {
  await new ArtifactCoordinator(db).initialize("p", projectDir);
  await writeFile(path.join(projectDir, "index.html"), "first external save");
  let changed = false;
  const coordinator = new ArtifactCoordinator(db, { beforeFileIndex: () => {
    if (!changed) { changed = true; writeFileSync(path.join(projectDir, "index.html"), "second external save"); }
  } });
  await coordinator.observeExternal("p", projectDir);
  const live = await inspectCanonicalTree(projectDir);
  const baseline = await inspectCanonicalTree(path.join(projectDir, ".meta", "artifact-baseline", "current"));
  expect(db.query("SELECT current_digest FROM projects WHERE id='p'").get()).toEqual({ current_digest: live.tree_digest });
  expect(baseline.tree_digest).toBe(live.tree_digest);
  await reconcileArtifactState(db);
  expect(await coordinator.observeExternal("p", projectDir)).toBeNull();
  expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("second external save");
});

test("Given a signal during an active scan When the scan ends Then one final scan runs", async () => {
  let release: () => void = () => {};
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const processSignal = async () => { calls += 1; if (calls === 1) await barrier; return null; };
  const first = scheduleProjectSignal("queued-signal-review", projectDir, processSignal);
  const second = scheduleProjectSignal("queued-signal-review", projectDir, processSignal);
  release();
  await Promise.all([first, second]);
  expect(calls).toBe(2);
});

test("Given a save invalidates an unpublished capture When retrying Then no unregistered operation directory remains", async () => {
  await new ArtifactCoordinator(db).initialize("p", projectDir);
  await writeFile(path.join(projectDir, "index.html"), "first save");
  let changed = false;
  await new ArtifactCoordinator(db, { afterExternalCapture: () => {
    if (!changed) { changed = true; writeFileSync(path.join(projectDir, "index.html"), "second save"); }
  } }).observeExternal("p", projectDir);
  const directories = (await readdir(path.join(projectDir, ".meta", "artifact-operations"))).sort();
  const operationIds = db.query<{ id: string }, []>("SELECT id FROM artifact_operations ORDER BY id").all().map((row) => row.id);
  expect(directories).toEqual(operationIds);
  expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("second save");
});

test("Given rollback itself fails after a partial publication When startup recovers Then the pending receipt restores original bytes", async () => {
  const base = await new ArtifactCoordinator(db).initialize("p", projectDir);
  const coordinator = new ArtifactCoordinator(db, { afterPublishWrite: () => { throw new Error("publication failure"); }, beforeRollback: () => { throw new Error("temporary rollback failure"); } });
  await expect(coordinator.run({ projectId: "p", projectDir, kind: "turn", operationId: "rollback-failure", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, mutate: async (stage) => {
    await writeFile(path.join(stage, "a.txt"), "partial");
    await writeFile(path.join(stage, "index.html"), "new entrypoint");
  } })).rejects.toThrow("temporary rollback failure");
  expect(db.query("SELECT status FROM artifact_operations WHERE id='rollback-failure'").get()).toEqual({ status: "working" });
  await reconcileArtifactState(db);
  expect((await inspectCanonicalTree(projectDir)).tree_digest).toBe(base.tree_digest);
  expect(db.query("SELECT status FROM artifact_operations WHERE id='rollback-failure'").get()).toEqual({ status: "recovered" });
});

test("Given baseline finalization failed and later external bytes exist When startup recovers Then committed stage repairs the baseline", async () => {
  const base = await new ArtifactCoordinator(db).initialize("p", projectDir);
  await new ArtifactCoordinator(db, { beforeBaselineFinalize: () => { throw new Error("baseline unavailable"); } }).run({ projectId: "p", projectDir, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, mutate: async (stage) => { await writeFile(path.join(stage, "index.html"), "committed"); } });
  await writeFile(path.join(projectDir, "index.html"), "later external");
  await reconcileArtifactState(db);
  const live = await inspectCanonicalTree(projectDir);
  expect((await inspectCanonicalTree(path.join(projectDir, ".meta", "artifact-baseline", "current"))).tree_digest).toBe(live.tree_digest);
  expect(db.query("SELECT current_digest FROM projects WHERE id='p'").get()).toEqual({ current_digest: live.tree_digest });
});

test("Given a directory becoming a file When publishing and undoing Then both manifests remain valid", async () => {
  await mkdir(path.join(projectDir, "assets"));
  await writeFile(path.join(projectDir, "assets", "old.txt"), "old");
  const coordinator = new ArtifactCoordinator(db);
  const base = await coordinator.initialize("p", projectDir);
  const changed = await coordinator.run({ projectId: "p", projectDir, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, mutate: async (stage) => {
    await rm(path.join(stage, "assets"), { recursive: true });
    await writeFile(path.join(stage, "assets"), "replacement file");
  } });
  expect(await readFile(path.join(projectDir, "assets"), "utf8")).toBe("replacement file");
  const undone = await coordinator.undo({ projectId: "p", projectDir, operationId: changed.id, expectedRevision: changed.resultRevision, expectedArtifactDigest: changed.resultDigest });
  expect(undone.resultDigest).toBe(base.tree_digest);
  expect(await readFile(path.join(projectDir, "assets", "old.txt"), "utf8")).toBe("old");
});

test("Given directory replacement publication fails When rollback runs Then old directory bytes return", async () => {
  await mkdir(path.join(projectDir, "assets"));
  await writeFile(path.join(projectDir, "assets", "old.txt"), "old");
  const base = await new ArtifactCoordinator(db).initialize("p", projectDir);
  const coordinator = new ArtifactCoordinator(db, { afterPublishWrite: () => { throw new Error("write failed"); } });
  await expect(coordinator.run({ projectId: "p", projectDir, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, mutate: async (stage) => {
    await rm(path.join(stage, "assets"), { recursive: true });
    await writeFile(path.join(stage, "assets"), "partial");
  } })).rejects.toThrow();
  expect((await inspectCanonicalTree(projectDir)).tree_digest).toBe(base.tree_digest);
});

test("Given expired terminal operations When retention runs Then current recovery stage remains and older undo becomes unavailable", async () => {
  const coordinator = new ArtifactCoordinator(db);
  const base = await coordinator.initialize("p", projectDir);
  const first = await coordinator.run({ projectId: "p", projectDir, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, mutate: async (stage) => { await writeFile(path.join(stage, "index.html"), "first"); } });
  const current = await coordinator.run({ projectId: "p", projectDir, kind: "turn", expectedRevision: 1, expectedArtifactDigest: first.resultDigest, mutate: async (stage) => { await writeFile(path.join(stage, "index.html"), "current"); } });
  db.exec("UPDATE artifact_operations SET retention_json=json_set(retention_json,'$.retained_until',1)");
  // A legacy DB path outside the configured profile never authorizes GC there.
  expect(await pruneExpiredArtifactOperations(db)).toBe(0);
  expect(existsSync(path.join(projectDir, ".meta", "artifact-operations", first.id))).toBe(true);
  expect(await pruneExpiredArtifactOperations(db, { projectsRoot: root })).toBe(2);
  expect(await pruneExpiredArtifactOperations(db, { projectsRoot: root })).toBe(0);
  expect(existsSync(path.join(projectDir, ".meta", "artifact-operations", first.id))).toBe(false);
  expect(existsSync(path.join(projectDir, ".meta", "artifact-operations", current.id, "stage"))).toBe(true);
  await expect(coordinator.undo({ projectId: "p", projectDir, operationId: first.id, expectedRevision: current.resultRevision, expectedArtifactDigest: current.resultDigest })).rejects.toMatchObject({ code: "undo_pruned" });
  expect((await inspectCanonicalTree(projectDir)).tree_digest).toBe(current.resultDigest);
});
