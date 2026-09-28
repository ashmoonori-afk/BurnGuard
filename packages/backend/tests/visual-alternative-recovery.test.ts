import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrationsFrom } from "../src/db/migrate";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { materializeManagedTree } from "../src/services/artifact-tree-storage";
import { recoverVisualAlternatives } from "../src/services/visual-alternative-recovery";
import { restoreVisualAlternativeBase } from "../src/services/visual-alternative-generation";
import { isSessionHeldForRecovery } from "../src/services/turns";
import { recoverProjectVisualAlternatives } from "../src/services/visual-alternative-recovery";
import { deleteVisualAlternative } from "../src/db/visual-alternative-repository";
import { canCreateSymlink, SYMLINK_SKIP_REASON } from "./helpers/platform";

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

  test("Given a corrupt base while the project holds an alternative When startup recovers Then nothing is released and the sessions are held", async () => {
    // Given
    addSession("s-corrupt-base");
    const { basePath } = await interruptedGeneration("generation-corrupt");
    db.exec(`UPDATE visual_alternative_generations SET base_digest='${"0".repeat(64)}' WHERE id='generation-corrupt'`);
    let restored = false;

    // When
    const recovered = await recoverVisualAlternatives(db, { root, restoreBase: async () => { restored = true; } });

    // Then
    expect(restored).toBe(false);
    expect(recovered.held).toEqual(["generation-corrupt"]);
    expect(isSessionHeldForRecovery("s-corrupt-base")).toBe(true);
    expect(db.query("SELECT status FROM visual_alternative_generations WHERE id='generation-corrupt'").get()).toEqual({ status: "generating" });
    expect(existsSync(basePath)).toBe(true);
  });

  test("Given a corrupt staged base while the project is still at its base When startup recovers Then the generation settles safely", async () => {
    // Given
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", projectDir);
    const basePath = path.join(projectDir, ".meta", "visual-alternatives", "generation-at-base", "base");
    await materializeManagedTree(projectDir, basePath);
    await writeFile(path.join(basePath, "index.html"), "tampered");
    db.prepare(
      "INSERT INTO visual_alternative_generations(id,project_id,status,base_revision,base_digest,base_manifest_json,base_path,created_at,updated_at) VALUES ('generation-at-base','p','generating',0,?,?,?,1,1)",
    ).run(base.tree_digest, JSON.stringify(base), basePath);

    // When
    const recovered = await recoverVisualAlternatives(db, { root });

    // Then
    expect(recovered.held).toEqual([]);
    expect(db.query("SELECT status FROM visual_alternative_generations WHERE id='generation-at-base'").get()).toEqual({ status: "failed" });
    expect(existsSync(path.join(projectDir, ".meta", "visual-alternatives", "generation-at-base"))).toBe(false);
  });

  test("Given a persisted generation id that is not a safe name When startup recovers Then rows settle and no metadata is removed", async () => {
    // Given
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", projectDir);
    await mkdir(path.join(projectDir, ".meta", "keep"), { recursive: true });
    await writeFile(path.join(projectDir, ".meta", "keep", "marker"), "keep");
    db.prepare(
      "INSERT INTO visual_alternative_generations(id,project_id,status,base_revision,base_digest,base_manifest_json,base_path,created_at,updated_at) VALUES ('..','p','generating',0,?,NULL,?,1,1)",
    ).run(base.tree_digest, path.join(projectDir, ".meta", "base"));

    // When
    await recoverVisualAlternatives(db, { root });

    // Then
    expect(db.query("SELECT status FROM visual_alternative_generations WHERE id='..'").get()).toEqual({ status: "failed" });
    expect(await readFile(path.join(projectDir, ".meta", "keep", "marker"), "utf8")).toBe("keep");
  });

  test("Given the current revision was not produced by the batch When startup recovers Then the foreign edit is kept and sessions are held", async () => {
    // Given
    addSession("s-foreign");
    await interruptedGeneration("generation-foreign");
    db.exec("UPDATE visual_alternatives SET operation_id='other-operation' WHERE id='generation-foreign-a'");

    // When
    const recovered = await recoverVisualAlternatives(db, { root });

    // Then
    expect(recovered.held).toEqual(["generation-foreign"]);
    expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("<main>Interrupted alternative</main>");
    expect(isSessionHeldForRecovery("s-foreign")).toBe(true);
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

  test.skipIf(!canCreateSymlink())(`Given an orphan entry that is a symlink to project content When startup recovers Then only the link is removed (${SYMLINK_SKIP_REASON})`, async () => {
    // Given
    const container = path.join(projectDir, ".meta", "visual-alternatives");
    await mkdir(container, { recursive: true });
    await mkdir(path.join(projectDir, "keep"), { recursive: true });
    await writeFile(path.join(projectDir, "keep", "marker.html"), "keep");
    await symlink(path.join(projectDir, "keep"), path.join(container, "linked-orphan"));

    // When
    await recoverVisualAlternatives(db, { root });

    // Then
    expect(existsSync(path.join(container, "linked-orphan"))).toBe(false);
    expect(await readFile(path.join(projectDir, "keep", "marker.html"), "utf8")).toBe("keep");
  });

  test.skipIf(process.platform === "win32")("Given orphan entries whose names are not valid ids When startup recovers Then they are removed without aborting (POSIX-only names)", async () => {
    // Given
    const container = path.join(projectDir, ".meta", "visual-alternatives");
    await mkdir(path.join(container, "bad:name "), { recursive: true });

    // When
    await recoverVisualAlternatives(db, { root });

    // Then
    expect(existsSync(path.join(container, "bad:name "))).toBe(false);
  });

  test("Given a quarantined project with changed live bytes When the watcher observes it Then observation defers instead of failing", async () => {
    // Given
    await interruptedGeneration("generation-observed");
    await writeFile(path.join(projectDir, "index.html"), "<main>Edited outside</main>");

    // When
    const observed = await new ArtifactCoordinator(db).observeExternal("p", projectDir);

    // Then
    expect(observed).toBeNull();
    expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("<main>Edited outside</main>");
  });

  test("Given concurrent recovery retries When both run Then they share one attempt and converge once", async () => {
    // Given
    addSession("s-concurrent");
    await interruptedGeneration("generation-concurrent");
    let restores = 0;
    const restoreBase: typeof restoreVisualAlternativeBase = async (...args) => {
      restores += 1;
      await restoreVisualAlternativeBase(...args);
    };

    // When
    const results = await Promise.all([
      recoverProjectVisualAlternatives(db, "p", { root, restoreBase }),
      recoverProjectVisualAlternatives(db, "p", { root, restoreBase }),
    ]);

    // Then
    expect(results).toEqual(["recovered", "recovered"]);
    expect(restores).toBe(1);
    expect(isSessionHeldForRecovery("s-concurrent")).toBe(false);
  });

  test.skipIf(process.platform === "win32")("Given tree cleanup fails after recovery converges When the retry settles Then the sessions are released anyway", async () => {
    // Given
    addSession("s-cleanup");
    await interruptedGeneration("generation-cleanup");
    await recoverVisualAlternatives(db, { root, restoreBase: async () => { throw new Error("disk_unavailable"); } });
    const container = path.join(projectDir, ".meta", "visual-alternatives");
    await chmod(container, 0o555);

    try {
      // When
      const result = await recoverProjectVisualAlternatives(db, "p", { root });

      // Then
      expect(result).toBe("recovered");
      expect(isSessionHeldForRecovery("s-cleanup")).toBe(false);
      expect(db.query("SELECT status FROM visual_alternative_generations WHERE id='generation-cleanup'").get()).toEqual({ status: "ready" });
    } finally {
      await chmod(container, 0o755);
    }
  });

  test.skipIf(process.platform === "win32")("Given an undeletable orphan tree When startup recovers Then startup completes and the tree is left for later", async () => {
    // Given
    const container = path.join(projectDir, ".meta", "visual-alternatives");
    await mkdir(path.join(container, "stuck-orphan"), { recursive: true });
    await writeFile(path.join(container, "stuck-orphan", "file.html"), "stuck");
    await chmod(container, 0o555);

    try {
      // When
      const recovered = await recoverVisualAlternatives(db, { root });

      // Then
      expect(recovered).toEqual({ recovered: 0, held: [] });
      expect(existsSync(path.join(container, "stuck-orphan"))).toBe(true);
    } finally {
      await chmod(container, 0o755);
    }
  });

  test.skipIf(process.platform === "win32")("Given an unreadable alternatives container When startup recovers Then startup completes", async () => {
    // Given
    const container = path.join(projectDir, ".meta", "visual-alternatives");
    await mkdir(path.join(container, "hidden-orphan"), { recursive: true });
    await chmod(container, 0o000);

    try {
      // When
      const recovered = await recoverVisualAlternatives(db, { root });

      // Then
      expect(recovered).toEqual({ recovered: 0, held: [] });
    } finally {
      await chmod(container, 0o755);
    }
  });

  test("Given a ready alternative of a still-generating generation When deleted Then deletion is refused", async () => {
    // Given
    await interruptedGeneration("generation-delete");
    db.exec("UPDATE visual_alternatives SET status='failed' WHERE id='generation-delete-a'");

    // When / Then
    expect(() => deleteVisualAlternative(db, "p", "generation-delete-a", 2)).toThrow("generation_active");
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
