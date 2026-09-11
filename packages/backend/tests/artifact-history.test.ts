import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
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
