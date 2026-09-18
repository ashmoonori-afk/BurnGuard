import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { runMigrationsFrom } from "../src/db/migrate";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { reconcileArtifactState } from "../src/services/artifact-recovery";
import { digestEntries, inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { parsePersistedArtifactOperation, type PersistedArtifactOperationRow } from "../src/services/artifact-operation-record";

let db: Database, root: string, operationId: string, stage: string, baseDigest: string;
beforeEach(async () => {
  db = new Database(":memory:");
  await runMigrationsFrom(db, path.join(import.meta.dir, "../src/db/migrations"));
  root = await mkdtemp(path.join(tmpdir(), "burnguard-document-migration-"));
  await writeFile(path.join(root, "index.html"), "preserved output");
  db.prepare("INSERT INTO projects(id,name,type,dir_path,backend_id,created_at,updated_at) VALUES ('p','P','prototype',?,'codex',1,1)").run(root);
  const base = await new ArtifactCoordinator(db).initialize("p", root);
  baseDigest = base.tree_digest;
  const row = db.query<PersistedArtifactOperationRow, []>("SELECT * FROM artifact_operations").get()!;
  const operation = parsePersistedArtifactOperation(row);
  operationId = operation.id; stage = operation.snapshot.stage_path;
  const document = { path: "docs/attachments/original.png", size: 8, sha256: createHash("sha256").update("original").digest("hex") };
  for (const directory of [root, stage]) {
    await mkdir(path.join(directory, "docs/attachments"), { recursive: true });
    await writeFile(path.join(directory, document.path), "original");
  }
  const legacyDigest = digestEntries([...base.files, document].sort((a, b) => a.path < b.path ? -1 : 1));
  const diff = [{ path: document.path, action: "created", before_hash: null, after_hash: document.sha256, before_bytes: 0, after_bytes: 8 }];
  db.prepare("UPDATE artifact_operations SET status='committed',result_revision=1,result_digest=?,diff_json=?,replay_json=json_set(replay_json,'$.kind','external','$.publication','result') WHERE id=?").run(legacyDigest, JSON.stringify(diff), operationId);
  db.prepare("UPDATE projects SET current_revision=1,current_digest=? WHERE id='p'").run(legacyDigest);
});
afterEach(async () => { db.close(); await rm(root, { recursive: true, force: true }); });

test("Given a legacy attachment-only external revision When restarting twice Then authored bytes and originals remain and one verified forward identity is adopted", async () => {
  const oldReceipt = db.query("SELECT * FROM artifact_operations WHERE id=?").get(operationId);
  await reconcileArtifactState(db);
  await reconcileArtifactState(db);
  expect(db.query("SELECT current_revision,current_digest FROM projects WHERE id='p'").get()).toEqual({ current_revision: 2, current_digest: baseDigest });
  expect(db.query("SELECT * FROM artifact_operations WHERE id=?").get(operationId)).toEqual(oldReceipt);
  const rows = db.query<PersistedArtifactOperationRow, []>("SELECT * FROM artifact_operations").all();
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(() => parsePersistedArtifactOperation(row)).not.toThrow();
  expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("preserved output");
  expect(await readFile(path.join(root, "docs/attachments/original.png"), "utf8")).toBe("original");
  expect((await inspectCanonicalTree(path.join(root, ".meta/artifact-baseline/current"))).tree_digest).toBe(baseDigest);
});

test("Given altered authored bytes When a legacy document revision is reconciled Then corruption is not adopted", async () => {
  await writeFile(path.join(root, "index.html"), "unverified change");
  const before = db.query("SELECT * FROM projects WHERE id='p'").get();
  await expect(reconcileArtifactState(db)).rejects.toMatchObject({ code: "corrupt_receipt" });
  expect(db.query("SELECT * FROM projects WHERE id='p'").get()).toEqual(before);
  expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("unverified change");
});

test("Given a tampered legacy result hash When restarting Then normalization cannot bypass the recorded identity", async () => {
  db.prepare("UPDATE artifact_operations SET result_digest=? WHERE id=?").run("a".repeat(64), operationId);
  db.prepare("UPDATE projects SET current_digest=? WHERE id='p'").run("a".repeat(64));
  await expect(reconcileArtifactState(db)).rejects.toMatchObject({ code: "corrupt_receipt" });
  expect(db.query("SELECT COUNT(*) AS count FROM artifact_operations").get()).toEqual({ count: 1 });
});

test("Given a changed retained stage When restarting Then migration cannot adopt an unverified recovery tree", async () => {
  await writeFile(path.join(stage, "index.html"), "unverified retained change");
  const before = db.query("SELECT current_revision,current_digest FROM projects WHERE id='p'").get();
  await expect(reconcileArtifactState(db)).rejects.toMatchObject({ code: "tree_mismatch" });
  expect(db.query("SELECT current_revision,current_digest FROM projects WHERE id='p'").get()).toEqual(before);
  expect(db.query("SELECT COUNT(*) AS count FROM artifact_operations").get()).toEqual({ count: 1 });
});
