import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrationsFrom } from "../src/db/migrate";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { materializeManagedTree } from "../src/services/artifact-tree-storage";
import { recoverVisualAlternatives } from "../src/services/visual-alternative-recovery";
import { isSessionHeldForRecovery } from "../src/services/turns";

const RETAINED_UNTIL = 253402300799999;
const roots: string[] = [];
let db: Database;
let root: string;
let projectDir: string;

beforeEach(async () => {
  db = new Database(":memory:");
  await runMigrationsFrom(db, path.join(import.meta.dir, "../src/db/migrations"));
  root = await mkdtemp(path.join(tmpdir(), "burnguard-alternative-recovery-"));
  roots.push(root);
  projectDir = path.join(root, "project");
  await mkdir(projectDir);
  await writeFile(path.join(projectDir, "index.html"), "<main>Original</main>");
  db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES ('p','P','prototype',?,'index.html','codex',1,1)").run(projectDir);
});

afterEach(async () => {
  db.close();
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function addSession(sessionId: string): void {
  db.prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,'p','codex','idle',1,1,1)").run(sessionId);
}

/** Leaves the state a crash mid-batch leaves: base staged, one item committed but not yet marked ready. */
async function interruptedGeneration(generationId: string, options: { readonly manifest: boolean } = { manifest: true }) {
  const coordinator = new ArtifactCoordinator(db);
  const base = await coordinator.initialize("p", projectDir);
  const basePath = path.join(projectDir, ".meta", "visual-alternatives", generationId, "base");
  await materializeManagedTree(projectDir, basePath);
  const operationId = `${generationId}-operation`;
  await coordinator.run({
    projectId: "p",
    projectDir,
    kind: "turn",
    operationId,
    expectedRevision: 0,
    expectedArtifactDigest: base.tree_digest,
    mutate: async (stage) => {
      await writeFile(path.join(stage, "index.html"), "<main>Interrupted alternative</main>");
    },
  });
  db.prepare(
    "INSERT INTO visual_alternative_generations(id,project_id,status,base_revision,base_digest,base_manifest_json,base_path,created_at,updated_at) VALUES (?,?, 'generating',?,?,?,?,1,1)",
  ).run(generationId, "p", 0, base.tree_digest, options.manifest ? JSON.stringify(base) : null, basePath);
  db.prepare(
    "INSERT INTO visual_alternatives(id,project_id,generation_id,name,ordinal,status,source_revision,source_digest,result_revision,result_digest,operation_id,created_at,updated_at) VALUES (?,'p',?,'Interrupted',0,'generating',0,?,NULL,NULL,?,1,1)",
  ).run(`${generationId}-a`, generationId, base.tree_digest, operationId);
  return { base, basePath, operationId };
}

function retainedUntil(operationId: string): unknown {
  return db.query<{ readonly until: unknown }, [string]>(
    "SELECT json_extract(retention_json,'$.retained_until') AS until FROM artifact_operations WHERE id=?",
  ).get(operationId)?.until;
}

describe("visual alternative recovery", () => {
  test("Given interrupted generation left a committed alternative active When startup recovers Then the base returns and the revision is retained", async () => {
    // Given
    addSession("s");
    const { base, operationId } = await interruptedGeneration("generation-recovery");

    // When
    const recovered = await recoverVisualAlternatives(db, { root });

    // Then
    expect(recovered).toEqual({ recovered: 1, held: [] });
    expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("<main>Original</main>");
    expect((await inspectCanonicalTree(projectDir)).tree_digest).toBe(base.tree_digest);
    expect(db.query("SELECT status FROM visual_alternative_generations WHERE id='generation-recovery'").get()).toEqual({ status: "ready" });
    expect(db.query("SELECT status FROM visual_alternatives WHERE id='generation-recovery-a'").get()).toEqual({ status: "ready" });
    expect(retainedUntil(operationId)).toBe(RETAINED_UNTIL);
    expect(existsSync(path.join(projectDir, ".meta", "visual-alternatives", "generation-recovery"))).toBe(false);
  });

  test("Given a crash before the base manifest was recorded When startup recovers Then the generation fails and its partial tree is removed", async () => {
    // Given
    addSession("s-null-manifest");
    await interruptedGeneration("generation-null", { manifest: false });

    // When
    const recovered = await recoverVisualAlternatives(db, { root });

    // Then
    expect(recovered.held).toEqual([]);
    expect(db.query("SELECT status FROM visual_alternative_generations WHERE id='generation-null'").get()).toEqual({ status: "failed" });
    expect(db.query("SELECT status,result_revision FROM visual_alternatives WHERE id='generation-null-a'").get()).toEqual({ status: "failed", result_revision: null });
    expect(existsSync(path.join(projectDir, ".meta", "visual-alternatives", "generation-null"))).toBe(false);
  });

  test("Given a project path outside managed storage When startup recovers Then rows settle and no file is touched", async () => {
    // Given
    const { basePath } = await interruptedGeneration("generation-outside");
    const otherRoot = await mkdtemp(path.join(tmpdir(), "burnguard-alternative-other-root-"));
    roots.push(otherRoot);
    const before = await readFile(path.join(projectDir, "index.html"), "utf8");

    // When
    const recovered = await recoverVisualAlternatives(db, { root: otherRoot });

    // Then
    expect(recovered.held).toEqual([]);
    expect(db.query("SELECT status FROM visual_alternative_generations WHERE id='generation-outside'").get()).toEqual({ status: "failed" });
    expect(existsSync(basePath)).toBe(true);
    expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe(before);
  });

  test("Given a base digest that does not match its manifest When startup recovers Then the generation fails without a restore", async () => {
    // Given
    await interruptedGeneration("generation-corrupt");
    db.exec(`UPDATE visual_alternative_generations SET base_digest='${"0".repeat(64)}' WHERE id='generation-corrupt'`);
    let restored = false;

    // When
    await recoverVisualAlternatives(db, { root, restoreBase: async () => { restored = true; } });

    // Then
    expect(restored).toBe(false);
    expect(db.query("SELECT status FROM visual_alternative_generations WHERE id='generation-corrupt'").get()).toEqual({ status: "failed" });
    expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("<main>Interrupted alternative</main>");
  });

  test("Given the base cannot be restored When startup recovers Then the generation stays durable and its sessions are held", async () => {
    // Given
    addSession("s-restore-failed");
    await interruptedGeneration("generation-held");

    // When
    const recovered = await recoverVisualAlternatives(db, {
      root,
      restoreBase: async () => { throw new Error("disk_unavailable"); },
    });

    // Then
    expect(recovered.held).toEqual(["generation-held"]);
    expect(isSessionHeldForRecovery("s-restore-failed")).toBe(true);
    expect(db.query("SELECT status FROM visual_alternative_generations WHERE id='generation-held'").get()).toEqual({ status: "generating" });
    expect(existsSync(path.join(projectDir, ".meta", "visual-alternatives", "generation-held", "base"))).toBe(true);
  });

  test("Given an orphan tree and a stale pin When startup recovers Then the tree is removed and the pin released", async () => {
    // Given
    const orphan = path.join(projectDir, ".meta", "visual-alternatives", "orphan-generation");
    await mkdir(orphan, { recursive: true });
    await writeFile(path.join(orphan, "leftover.html"), "leftover");
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", projectDir);
    await coordinator.run({
      projectId: "p",
      projectDir,
      kind: "turn",
      operationId: "stale-pin",
      expectedRevision: 0,
      expectedArtifactDigest: base.tree_digest,
      mutate: async (stage) => {
        await writeFile(path.join(stage, "index.html"), "<main>Pinned</main>");
      },
    });
    db.prepare("UPDATE artifact_operations SET retention_json=json_set(retention_json,'$.retained_until',?) WHERE id='stale-pin'").run(RETAINED_UNTIL);

    // When
    await recoverVisualAlternatives(db, { root, now: () => 1000 });

    // Then
    expect(existsSync(orphan)).toBe(false);
    expect(retainedUntil("stale-pin")).toBe(1000 + 30 * 24 * 60 * 60 * 1000);
  });
});
