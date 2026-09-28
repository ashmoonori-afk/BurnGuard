import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, readFile, readdir, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { ArtifactCoordinator, ArtifactOperationError } from "../src/services/artifact-coordinator";
import { DEFAULT_CANONICAL_TREE_LIMITS, inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { parseArtifactReplay, parseArtifactRetention, parseArtifactSnapshot } from "../src/services/artifact-receipts";
import { fingerprintHtmlNode } from "../src/services/file-patch";
import { requireArtifactIdentity } from "../src/services/artifact-identity";
import { broker } from "../src/services/broker";
import { getArtifactOperation, listArtifactOperations } from "../src/db/artifact-operation-query";
import { PersistedArtifactOperationError } from "../src/services/artifact-operation-record";
import { isArtifactPublicationActive } from "../src/services/artifact-publication-registry";
import { runMigrationsFrom } from "../src/db/migrate";
import { ExtractionAcquisitionError } from "../src/services/extraction-acquisition";

const roots: string[] = [];
let db: Database;
let root: string;

async function projectRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "burnguard-artifact-red-"));
  roots.push(directory);
  return directory;
}

beforeEach(async () => {
  db = new Database(":memory:");
  await runMigrationsFrom(db, path.join(import.meta.dir, "../src/db/migrations"));
  root = await projectRoot();
  await writeFile(path.join(root, "index.html"), '<div data-bg-node-id="hero">Old</div>');
  db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES ('p','P','prototype',?,'index.html','codex',1,1)").run(root);
  db.exec("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('s','p','codex','idle',1,1,1)");
});

afterEach(async () => {
  db.close();
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("artifact coordinator", () => {
  test("Given a new empty project When initialized Then initial bytes are a revision-one coordinator receipt", async () => {
    const emptyRoot = await projectRoot();
    db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES ('new','New','prototype',?,'index.html','codex',1,1)").run(emptyRoot);
    db.exec("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('new-session','new','codex','idle',1,1,1)");
    const operation = await new ArtifactCoordinator(db).initializeProject("new", emptyRoot, async (stage) => { await writeFile(path.join(stage, "index.html"), "initial bytes"); });
    expect(operation).toMatchObject({ kind: "initialize", status: "committed", baseRevision: 0, resultRevision: 1 });
    expect(operation.diff).toEqual([{ path: "index.html", action: "created", before_hash: null, after_hash: operation.diff[0]?.after_hash, before_bytes: 0, after_bytes: 13 }]);
    expect(db.query("SELECT current_revision,current_digest FROM projects WHERE id='new'").get()).toEqual({ current_revision: 1, current_digest: operation.resultDigest });
    expect(await readFile(path.join(emptyRoot, "index.html"), "utf8")).toBe("initial bytes");
  });

  test("Given exact base identity When patching and undoing Then each is a committed receipt and undo restores the base digest", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    const source = await readFile(path.join(root, "index.html"), "utf8");
    const file = base.files[0];
    if (file === undefined) throw new Error("fixture_file_missing");
    const node = fingerprintHtmlNode(source, "hero");

    const patched = await coordinator.patch({ projectId: "p", projectDir: root, relPath: "index.html", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, expectedFileHash: file.sha256, nodeBgId: "hero", nodeFingerprint: node.fingerprint, patch: { text: "New" } });
    const undone = await coordinator.undo({ projectId: "p", projectDir: root, operationId: patched.id, expectedRevision: 1, expectedArtifactDigest: patched.resultDigest });

    expect(patched).toMatchObject({ status: "committed", resultRevision: 1 });
    expect(isArtifactPublicationActive("p")).toBe(false);
    expect(undone).toMatchObject({ status: "committed", resultRevision: 2, resultDigest: base.tree_digest });
    expect(await readFile(path.join(root, "index.html"), "utf8")).toContain("Old");
    expect(db.query("SELECT status,result_revision FROM artifact_operations WHERE json_extract(replay_json,'$.kind')!='initialize' ORDER BY created_at,id").all()).toEqual([{ status: "committed", result_revision: 1 }, { status: "committed", result_revision: 2 }]);
    expect(getArtifactOperation(db, "p", patched.id)?.diff).toEqual(patched.diff);
    expect(listArtifactOperations(db, "p").filter((operation) => operation.replay.kind !== "initialize").map((operation) => operation.id)).toEqual([undone.id, patched.id]);
  });

  test("Given stale revision digest file hash or fingerprint When patching Then typed conflicts make no live mutation", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    const source = await readFile(path.join(root, "index.html"), "utf8");
    const file = base.files[0];
    if (file === undefined) throw new Error("fixture_file_missing");
    const node = fingerprintHtmlNode(source, "hero");
    const cases = [
      { revision: 9, digest: base.tree_digest, hash: file.sha256, fingerprint: node.fingerprint, code: "stale_revision" },
      { revision: 0, digest: "0".repeat(64), hash: file.sha256, fingerprint: node.fingerprint, code: "stale_artifact_digest" },
      { revision: 0, digest: base.tree_digest, hash: "0".repeat(64), fingerprint: node.fingerprint, code: "stale_file_hash" },
      { revision: 0, digest: base.tree_digest, hash: file.sha256, fingerprint: "0".repeat(64), code: "stale_node_fingerprint" },
    ];
    for (const item of cases) {
      const action = coordinator.patch({ projectId: "p", projectDir: root, relPath: "index.html", expectedRevision: item.revision, expectedArtifactDigest: item.digest, expectedFileHash: item.hash, nodeBgId: "hero", nodeFingerprint: item.fingerprint, patch: { text: "Bad" } });
      await expect(action).rejects.toMatchObject<Partial<ArtifactOperationError>>({ code: item.code });
    }
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe(source);
    expect(db.query("SELECT COUNT(*) count FROM artifact_operations").get()).toEqual({ count: 1 });
  });

  test("Given retained bytes are pruned When undo is requested Then typed unavailability starts no operation", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    const source = await readFile(path.join(root, "index.html"), "utf8");
    const file = base.files[0];
    if (file === undefined) throw new Error("fixture_file_missing");
    const node = fingerprintHtmlNode(source, "hero");
    const patched = await coordinator.patch({ projectId: "p", projectDir: root, relPath: "index.html", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, expectedFileHash: file.sha256, nodeBgId: "hero", nodeFingerprint: node.fingerprint, patch: { text: "Prune" } });
    const retained = db.query<{ readonly path: string }, [string]>("SELECT json_extract(snapshot_json,'$.snapshot_path') path FROM artifact_operations WHERE id=?").get(patched.id);
    if (retained === null) throw new Error("retained_snapshot_missing");
    await rm(retained.path, { recursive: true, force: true });
    db.prepare("UPDATE artifact_operations SET retention_json=json_set(retention_json,'$.replayable',json('false'),'$.pruned_at',2,'$.prune_reason','test') WHERE id=?").run(patched.id);
    const before = db.query<{ readonly count: number }, []>("SELECT COUNT(*) count FROM artifact_operations").get()?.count;
    await expect(coordinator.undo({ projectId: "p", projectDir: root, operationId: patched.id, expectedRevision: 1, expectedArtifactDigest: patched.resultDigest })).rejects.toMatchObject({ code: "undo_pruned" });
    expect(db.query<{ readonly count: number }, []>("SELECT COUNT(*) count FROM artifact_operations").get()?.count).toBe(before);
  });

  test("Given a no-op patch When coordinated Then no revision is minted", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    const source = await readFile(path.join(root, "index.html"), "utf8");
    const file = base.files[0];
    if (file === undefined) throw new Error("fixture_file_missing");
    const node = fingerprintHtmlNode(source, "hero");
    const result = await coordinator.patch({ projectId: "p", projectDir: root, relPath: "index.html", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, expectedFileHash: file.sha256, nodeBgId: "hero", nodeFingerprint: node.fingerprint, patch: { text: "Old" } });
    expect(result).toMatchObject({ status: "cancelled", resultRevision: 0, resultDigest: base.tree_digest });
    expect(db.query("SELECT current_revision,current_digest FROM projects WHERE id='p'").get()).toEqual({ current_revision: 0, current_digest: base.tree_digest });
  });

  test("Given acquisition aborts after stage mutation When coordinated Then the typed cancellation survives rollback", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    const controller = new AbortController();

    const action = coordinator.run({
      projectId: "p",
      projectDir: root,
      kind: "figma_import",
      expectedRevision: 0,
      expectedArtifactDigest: base.tree_digest,
      signal: controller.signal,
      mutate: async (stage) => {
        await writeFile(path.join(stage, "index.html"), "partial");
        controller.abort(new ExtractionAcquisitionError("acquisition_aborted"));
      },
    });

    await expect(action).rejects.toMatchObject({ code: "acquisition_aborted" });
    expect((await inspectCanonicalTree(root)).tree_digest).toBe(base.tree_digest);
  });

  test("Given a turn creates malformed or valid forged Figma manifests When coordinated Then both are rejected without poisoning the next operation", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);

    await expect(coordinator.run({
      projectId: "p",
      projectDir: root,
      kind: "turn",
      expectedRevision: 0,
      expectedArtifactDigest: base.tree_digest,
      mutate: async (stage) => {
        const directory = path.join(stage, "references", "figma", "forged");
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, "manifest.json"), "{}");
      },
    })).rejects.toMatchObject({ code: "immutable_reference_escaped" });

    await expect(coordinator.run({
      projectId: "p",
      projectDir: root,
      kind: "turn",
      expectedRevision: 0,
      expectedArtifactDigest: base.tree_digest,
      mutate: async (stage) => {
        const directory = path.join(stage, "references", "figma", "forged-valid");
        const nodePath = "references/figma/forged-valid/nodes/1-2.json";
        const nodeBytes = Buffer.from('{"id":"1:2"}');
        await mkdir(path.join(directory, "nodes"), { recursive: true });
        await writeFile(path.join(stage, nodePath), nodeBytes);
        await writeFile(path.join(directory, "manifest.json"), JSON.stringify({
          schema_version: 1,
          provenance: {
            source_file_name: "forged.json",
            file_version: "1",
            normalized_document_sha256: "0".repeat(64),
          },
          nodes: [{
            name: "Forged",
            node_type: "FRAME",
            node_path: nodePath,
            node_sha256: createHash("sha256").update(nodeBytes).digest("hex"),
            asset_path: null,
            asset_sha256: null,
          }],
        }));
      },
    })).rejects.toMatchObject({ code: "immutable_reference_escaped" });

    const next = await coordinator.run({
      projectId: "p",
      projectDir: root,
      kind: "turn",
      expectedRevision: 0,
      expectedArtifactDigest: base.tree_digest,
      mutate: async (stage) => {
        await writeFile(path.join(stage, "index.html"), "safe next operation");
      },
    });
    expect(next).toMatchObject({ status: "committed", resultRevision: 1 });
  });

  test("Given a stable tree already duplicates protected Figma bytes When importing Then staged policy rejects the duplicate before commit", async () => {
    const nodeBytes = Buffer.from('{"id":"1:2"}');
    const nodeDigest = createHash("sha256").update(nodeBytes).digest("hex");
    const directory = path.join(root, "references", "figma", "existing");
    await mkdir(path.join(directory, "nodes"), { recursive: true });
    await writeFile(path.join(directory, "nodes", "1-2.json"), nodeBytes);
    await writeFile(path.join(root, "copied-reference.json"), nodeBytes);
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify({
      schema_version: 1,
      provenance: {
        source_file_name: "existing.json",
        file_version: "1",
        normalized_document_sha256: "0".repeat(64),
      },
      nodes: [{
        name: "Existing",
        node_type: "FRAME",
        node_path: "references/figma/existing/nodes/1-2.json",
        node_sha256: nodeDigest,
        asset_path: null,
        asset_sha256: null,
      }],
    }));
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);

    await expect(coordinator.run({
      projectId: "p",
      projectDir: root,
      kind: "figma_import",
      expectedRevision: 0,
      expectedArtifactDigest: base.tree_digest,
      mutate: async (stage) => {
        await writeFile(path.join(stage, "index.html"), "imported");
      },
    })).rejects.toMatchObject({ code: "immutable_reference_escaped" });

    expect((await inspectCanonicalTree(root)).tree_digest).toBe(base.tree_digest);
    expect(db.query("SELECT current_revision FROM projects WHERE id='p'").get()).toEqual({
      current_revision: 0,
    });
  });

  test("Given the database commit fails after publication When coordinated Then live bytes restore before failed event", async () => {
    const coordinator = new ArtifactCoordinator(db, { beforeDatabaseCommit: () => { throw new ArtifactOperationError("database_commit_failed", "fault"); } });
    const base = await coordinator.initialize("p", root);
    await expect(coordinator.run({ projectId: "p", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, mutate: async (stage) => { await writeFile(path.join(stage, "index.html"), "published then rolled back"); } })).rejects.toMatchObject({ code: "database_commit_failed" });
    expect((await inspectCanonicalTree(root)).tree_digest).toBe(base.tree_digest);
    expect(db.query("SELECT status FROM artifact_operations WHERE json_extract(replay_json,'$.kind')!='initialize'").get()).toEqual({ status: "failed" });
    expect(db.query("SELECT current_revision,current_digest FROM projects WHERE id='p'").get()).toEqual({ current_revision: 0, current_digest: base.tree_digest });
  });

  test("Given file-index finalization fails before durable commit When coordinated Then bytes and DB both remain at base", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    db.exec("DROP TABLE files");
    await expect(coordinator.run({ projectId: "p", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, mutate: async (stage) => { await writeFile(path.join(stage, "index.html"), "new index"); } })).rejects.toMatchObject({ code: "operation_failed" });
    expect((await inspectCanonicalTree(root)).tree_digest).toBe(base.tree_digest);
    expect(db.query("SELECT current_revision,current_digest FROM projects WHERE id='p'").get()).toEqual({ current_revision: 0, current_digest: base.tree_digest });
  });

  test("Given baseline finalization fails after durable commit When coordinated Then result bytes and identity remain committed", async () => {
    const coordinator = new ArtifactCoordinator(db, { beforeBaselineFinalize: () => { throw new Error("baseline fault"); } });
    const base = await coordinator.initialize("p", root);
    const result = await coordinator.run({ projectId: "p", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, mutate: async (stage) => { await writeFile(path.join(stage, "index.html"), "durable result"); } });
    expect(result.status).toBe("committed");
    expect((await inspectCanonicalTree(root)).tree_digest).toBe(result.resultDigest);
    expect(db.query("SELECT status FROM artifact_operations WHERE id=?").get(result.id)).toEqual({ status: "committed" });
    expect(db.query("SELECT current_revision,current_digest FROM projects WHERE id='p'").get()).toEqual({ current_revision: 1, current_digest: result.resultDigest });
    await new ArtifactCoordinator(db).initialize("p", root);
    expect((await inspectCanonicalTree(path.join(root, ".meta", "artifact-baseline", "current"))).tree_digest).toBe(result.resultDigest);
    expect(db.query("SELECT hash FROM files WHERE project_id='p' AND rel_path='index.html'").get()).toEqual({ hash: result.diff[0]?.after_hash });
  });

  test("Given persisted receipts have unknown fields When parsed Then every recursive receipt rejects them", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const manifest = await coordinator.initialize("p", root);
    expect(() => parseCanonicalTreeManifest({ ...manifest, unknown: true })).toThrow();
    expect(() => parseCanonicalTreeManifest({ ...manifest, files: [{ ...manifest.files[0], unknown: true }] })).toThrow();
    expect(() => parseArtifactSnapshot(JSON.stringify({ schema_version: 1, snapshot_path: "/s", stage_path: "/t", base_manifest: manifest, unknown: true }))).toThrow();
    expect(() => parseArtifactRetention(JSON.stringify({ schema_version: 1, replayable: true, retained_until: 1, pruned_at: null, prune_reason: null, unknown: true }))).toThrow();
    expect(() => parseArtifactReplay(JSON.stringify({ schema_version: 1, kind: "turn", parent_operation_id: null, publication: "base", unknown: true }))).toThrow();
  });

  test("Given a corrupt persisted operation When queried Then a typed error occurs without filesystem mutation", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    const before = await readFile(path.join(root, "index.html"));
    db.prepare("UPDATE artifact_operations SET snapshot_json=json_set(snapshot_json,'$.unknown',1)").run();
    expect(() => listArtifactOperations(db, "p")).toThrow(PersistedArtifactOperationError);
    expect(await readFile(path.join(root, "index.html"))).toEqual(before);
    expect((await inspectCanonicalTree(root)).tree_digest).toBe(base.tree_digest);
  });

  test("Given publication fails after its first write When recovery runs Then exact base bytes and identity survive", async () => {
    await writeFile(path.join(root, "style.css"), "old");
    let writes = 0;
    const coordinator = new ArtifactCoordinator(db, { afterPublishWrite: () => { writes += 1; if (writes === 1) throw new ArtifactOperationError("publication_interrupted", "fault"); } });
    const base = await coordinator.initialize("p", root);
    await expect(coordinator.run({ projectId: "p", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, mutate: async (stage) => { await writeFile(path.join(stage, "index.html"), "new"); await writeFile(path.join(stage, "style.css"), "new"); } })).rejects.toMatchObject<Partial<ArtifactOperationError>>({ code: "publication_interrupted" });
    expect((await inspectCanonicalTree(root)).tree_digest).toBe(base.tree_digest);
    expect(await readFile(path.join(root, "index.html"), "utf8")).toContain("Old");
    expect(await readFile(path.join(root, "style.css"), "utf8")).toBe("old");
    expect(db.query("SELECT status,json_extract(retention_json,'$.replayable') replayable FROM artifact_operations WHERE json_extract(replay_json,'$.kind')!='initialize'").get()).toEqual({ status: "failed", replayable: 1 });
    const failedPath = db.query<{ readonly path: string }, []>("SELECT json_extract(snapshot_json,'$.stage_path') path FROM artifact_operations WHERE json_extract(replay_json,'$.kind')!='initialize'").get()?.path;
    expect(failedPath).toBeDefined();
    expect(await readFile(path.join(failedPath ?? "missing", "index.html"), "utf8")).toBe("new");
  });

  test("Given a post-manifest candidate replacement exceeds the canonical byte bound When publishing Then it rejects before read allocation or destination write", async () => {
    const sourceReads: string[] = [];
    let publicationWrites = 0;
    const operationId = "oversized-publication-source";
    const coordinator = new ArtifactCoordinator(db, {
      beforePublishRead: async (relativePath) => {
        if (relativePath === "large.bin") await truncate(path.join(root, ".meta", "artifact-operations", operationId, "stage", relativePath), DEFAULT_CANONICAL_TREE_LIMITS.bytes + 1);
      },
      beforePublishSourceRead: (relativePath) => { sourceReads.push(relativePath); },
      afterPublishWrite: () => { publicationWrites += 1; },
    });
    const base = await coordinator.initialize("p", root);

    await expect(coordinator.run({ projectId: "p", projectDir: root, kind: "turn", operationId, expectedRevision: 0, expectedArtifactDigest: base.tree_digest, mutate: async (stage) => {
      await writeFile(path.join(stage, "index.html"), "changed");
      await writeFile(path.join(stage, "large.bin"), "small-before-publication");
    } })).rejects.toMatchObject({ code: "operation_failed" });

    expect(sourceReads).toEqual(["index.html"]);
    expect(publicationWrites).toBe(0);
    expect(await readFile(path.join(root, "index.html"), "utf8")).toContain("Old");
    await expect(readFile(path.join(root, "large.bin"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("Given nested immutable bytes or a publication-time swap When publishing Then typed rejection writes no result bytes and prunes the failed operation", async () => {
    const forbiddenBytes = new TextEncoder().encode("immutable-source");
    const forbiddenHash = createHash("sha256").update(forbiddenBytes).digest("hex");
    for (const swapAtPublication of [false, true]) {
      const operationId = `security-${swapAtPublication}`;
      let publishedWrites = 0;
      const coordinator = new ArtifactCoordinator(db, {
        ...(swapAtPublication ? { beforePublishRead: async (relativePath: string) => {
          if (relativePath === "nested/output.bin") await writeFile(path.join(root, ".meta", "artifact-operations", operationId, "stage", relativePath), forbiddenBytes);
        } } : {}),
        afterPublishWrite: () => { publishedWrites += 1; },
      });
      const base = await coordinator.initialize("p", root);
      await expect(coordinator.run({
        projectId: "p", projectDir: root, kind: "turn", operationId,
        expectedRevision: 0, expectedArtifactDigest: base.tree_digest,
        publicationPolicy: { forbiddenSha256: new Set([forbiddenHash]) },
        mutate: async (stage) => {
          await writeFile(path.join(stage, "index.html"), "changed");
          await mkdir(path.join(stage, "nested"), { recursive: true });
          await writeFile(path.join(stage, "nested", "output.bin"), swapAtPublication ? "safe-content-000" : forbiddenBytes);
        },
      })).rejects.toMatchObject({ code: "immutable_reference_escaped" });
      expect(publishedWrites).toBe(0);
      expect(await readFile(path.join(root, "index.html"), "utf8")).toContain("Old");
      await expect(readFile(path.join(root, "nested", "output.bin"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readdir(path.join(root, ".meta", "artifact-operations", operationId))).rejects.toMatchObject({ code: "ENOENT" });
      expect(db.query("SELECT status,json_extract(retention_json,'$.replayable') replayable FROM artifact_operations WHERE id=?").get(operationId)).toEqual({ status: "failed", replayable: 0 });
    }
  });

  test("Given two same-base operations When the first owns authority Then the second conflicts and only one revision commits", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    let release: () => void = () => {};
    let preparedResolve: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const prepared = new Promise<void>((resolve) => { preparedResolve = resolve; });
    const first = coordinator.run({ projectId: "p", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, onPrepared: preparedResolve, mutate: async (stage) => { await gate; await writeFile(path.join(stage, "index.html"), "winner"); } });
    await prepared;
    const second = coordinator.run({ projectId: "p", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, mutate: async (stage) => { await writeFile(path.join(stage, "index.html"), "loser"); } });
    await expect(second).rejects.toMatchObject({ code: "operation_conflict" });
    release();
    await expect(first).resolves.toMatchObject({ status: "committed", resultRevision: 1 });
    expect(db.query("SELECT current_revision FROM projects WHERE id='p'").get()).toEqual({ current_revision: 1 });
  });

  test("Given broker delivery fails after commit When patching Then the committed DB identity remains durable", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    const source = await readFile(path.join(root, "index.html"), "utf8");
    const file = base.files[0];
    if (file === undefined) throw new Error("fixture_file_missing");
    const node = fingerprintHtmlNode(source, "hero");
    const unsubscribe = broker.subscribe("s", () => { throw new Error("subscriber fault"); });
    const result = await coordinator.patch({ projectId: "p", projectDir: root, relPath: "index.html", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, expectedFileHash: file.sha256, nodeBgId: "hero", nodeFingerprint: node.fingerprint, patch: { text: "Durable" } });
    unsubscribe();
    expect(result.status).toBe("committed");
    expect(db.query("SELECT current_revision,current_digest FROM projects WHERE id='p'").get()).toEqual({ current_revision: 1, current_digest: result.resultDigest });
    expect(db.query("SELECT COUNT(*) count FROM events WHERE type='artifact.operation'").get()).toEqual({ count: 1 });
  });

  test("Given an external write races an active operation When observed Then evidence is conflicted and stable bytes restore", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    db.prepare("INSERT INTO artifact_operations(id,project_id,status,base_revision,base_digest,expected_revision,expected_file_hash,node_fingerprint,diff_json,snapshot_json,retention_json,replay_json,created_at,updated_at) VALUES ('active','p','working',0,?,0,'','','[]','{}','{}','{}',1,1)").run(base.tree_digest);
    await writeFile(path.join(root, "index.html"), "external race");
    const operation = await coordinator.observeExternal("p", root);
    expect(operation).toMatchObject({ status: "conflicted", resultRevision: 0, resultDigest: base.tree_digest });
    expect((await inspectCanonicalTree(root)).tree_digest).toBe(base.tree_digest);
    expect(db.query<{ readonly id: string; readonly status: string }, []>("SELECT id,status FROM artifact_operations WHERE id=?").get(operation?.id ?? "")).toEqual({ id: operation?.id, status: "conflicted" });
    expect(db.query("SELECT status,result_revision,result_digest FROM artifact_operations WHERE id='active'").get()).toEqual({ status: "conflicted", result_revision: null, result_digest: null });
  });

  test("Given mandatory snapshot creation fails When operation starts Then mutator never runs and identity is unchanged", async () => {
    let mutated = false;
    const coordinator = new ArtifactCoordinator(db, { beforeSnapshot: () => { throw new ArtifactOperationError("snapshot_failed", "fault"); } });
    const base = await coordinator.initialize("p", root);
    await expect(coordinator.run({ projectId: "p", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, mutate: async () => { mutated = true; } })).rejects.toMatchObject({ code: "snapshot_failed" });
    expect(mutated).toBe(false);
    expect((await inspectCanonicalTree(root)).tree_digest).toBe(base.tree_digest);
    expect(db.query("SELECT COUNT(*) count FROM artifact_operations").get()).toEqual({ count: 1 });
  });

  test("Given comment and draw anchors When identity is current Then anchors persist and stale identity rejects", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    const anchor = requireArtifactIdentity({ revision: 0, digest: base.tree_digest }, { revision: 0, digest: base.tree_digest });
    db.prepare("INSERT INTO comments(id,project_id,rel_path,x_pct,y_pct,artifact_revision,artifact_digest,created_at,updated_at) VALUES ('c','p','index.html',1,2,?,?,1,1)").run(anchor.revision, anchor.digest);
    expect(db.query("SELECT artifact_revision,artifact_digest FROM comments WHERE id='c'").get()).toEqual({ artifact_revision: 0, artifact_digest: base.tree_digest });
    expect(() => requireArtifactIdentity({ revision: 0, digest: "stale" }, { revision: 0, digest: base.tree_digest })).toThrow("stale");
  });

  test("Given an idle external write When observed Then one exact external operation advances identity", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    await writeFile(path.join(root, "index.html"), '<div data-bg-node-id="hero">External</div>');
    const operation = await coordinator.observeExternal("p", root);
    expect(operation).toMatchObject({ status: "committed", resultRevision: 1 });
    expect(operation?.diff.map((entry) => entry.path)).toEqual(["index.html"]);
    expect(operation?.resultDigest).not.toBe(base.tree_digest);
    expect(await coordinator.observeExternal("p", root)).toBeNull();
  });
});
