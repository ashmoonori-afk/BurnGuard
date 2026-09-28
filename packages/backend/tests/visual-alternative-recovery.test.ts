import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrationsFrom } from "../src/db/migrate";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { materializeManagedTree } from "../src/services/artifact-tree-storage";
import { recoverVisualAlternatives } from "../src/services/visual-alternative-recovery";

const roots: string[] = [];
let db: Database;
let root: string;

beforeEach(async () => {
  db = new Database(":memory:");
  await runMigrationsFrom(db, path.join(import.meta.dir, "../src/db/migrations"));
  root = await mkdtemp(path.join(tmpdir(), "burnguard-alternative-recovery-"));
  roots.push(root);
  await writeFile(path.join(root, "index.html"), "<main>Original</main>");
  db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES ('p','P','prototype',?,'index.html','codex',1,1)").run(root);
  db.exec("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('s','p','codex','idle',1,1,1)");
});

afterEach(async () => {
  db.close();
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("visual alternative recovery", () => {
  test("Given interrupted generation left a committed alternative active When startup recovers Then the base returns and the revision survives", async () => {
    // Given
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    const generationId = "generation-recovery";
    const basePath = path.join(root, ".meta", "visual-alternatives", generationId, "base");
    await materializeManagedTree(root, basePath);
    const generated = await coordinator.run({
      projectId: "p",
      projectDir: root,
      kind: "turn",
      operationId: "alternative-recovery-operation",
      expectedRevision: 0,
      expectedArtifactDigest: base.tree_digest,
      mutate: async (stage) => {
        await writeFile(path.join(stage, "index.html"), "<main>Interrupted alternative</main>");
      },
    });
    db.prepare(
      "INSERT INTO visual_alternative_generations(id,project_id,status,base_revision,base_digest,base_manifest_json,base_path,created_at,updated_at) VALUES (?,?, 'generating',?,?,?,?,1,1)",
    ).run(generationId, "p", 0, base.tree_digest, JSON.stringify(base), basePath);
    db.prepare(
      "INSERT INTO visual_alternatives(id,project_id,generation_id,name,ordinal,status,source_revision,source_digest,result_revision,result_digest,operation_id,created_at,updated_at) VALUES ('a','p',?,'Interrupted',0,'generating',0,?,?,?,'alternative-recovery-operation',1,1)",
    ).run(generationId, base.tree_digest, generated.resultRevision, generated.resultDigest);

    // When
    const recovered = await recoverVisualAlternatives(db);

    // Then
    expect(recovered).toBe(1);
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("<main>Original</main>");
    expect((await inspectCanonicalTree(root)).tree_digest).toBe(base.tree_digest);
    expect(db.query("SELECT status FROM visual_alternative_generations WHERE id=?").get(generationId)).toEqual({ status: "ready" });
    expect(db.query("SELECT status FROM visual_alternatives WHERE id='a'").get()).toEqual({ status: "ready" });
  });
});
