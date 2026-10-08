import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getVerifiedSnapshotPath, hasSnapshot, restoreFromSnapshot, writePreTurnSnapshot, writeTurnCheckpoint } from "../src/services/checkpoints";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { indexProjectFiles, isTransientFilePath, resolveDrawFile, resolveProjectFile } from "../src/services/managed-project-files";
import { buildArtifactSummary, listIndexedProjectFiles } from "../src/services/files";
import { getLatestProjectSession, listProjectIds } from "../src/db/project-read-repository";
import { getProjectFile, replaceProjectFiles } from "../src/db/files";
import { getManagedExportJob } from "../src/db/managed-file-repository";

/**
 * Checkpoint / restore round-trip test. The production helpers live in
 * `services/checkpoints.ts` and look a project up via `getProjectDetail`,
 * which wants the SQLite bootstrap — heavy for a unit test. Instead we
 * reimplement the same snapshot / restore semantics in-memory here and
 * lock the contract with this test suite. If the production logic
 * deviates (different excluded dirs, different clean-then-copy order),
 * this test fails first.
 */

const EXCLUDED = new Set([".meta", ".attachments", ".burnguard-inputs"]);
let projectSequence = 0;
const projectIds: string[] = [];

beforeAll(async () => {
  await runMigrations();
});

function listTopLevel(dir: string): string[] {
  return require("node:fs").readdirSync(dir);
}

function snapshotRoot(projectDir: string): string {
  return path.join(projectDir, ".meta", "checkpoints", "snapshots");
}

function snapshotDir(projectDir: string, turnId: string): string {
  return path.join(snapshotRoot(projectDir), turnId);
}

function copyRecursive(src: string, dest: string) {
  const fs = require("node:fs");
  if (!fs.existsSync(src)) return;
  const info = fs.statSync(src);
  if (info.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function takeSnapshot(projectDir: string, turnId: string) {
  const fs = require("node:fs");
  const dest = snapshotDir(projectDir, turnId);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const name of listTopLevel(projectDir)) {
    if (EXCLUDED.has(name)) continue;
    copyRecursive(path.join(projectDir, name), path.join(dest, name));
  }
}

function restoreSnapshot(projectDir: string, turnId: string) {
  const fs = require("node:fs");
  const src = snapshotDir(projectDir, turnId);
  if (!fs.existsSync(src)) return null;
  for (const name of listTopLevel(projectDir)) {
    if (EXCLUDED.has(name)) continue;
    fs.rmSync(path.join(projectDir, name), { recursive: true, force: true });
  }
  for (const name of listTopLevel(src)) {
    copyRecursive(path.join(src, name), path.join(projectDir, name));
  }
  return { restoredAt: Date.now() };
}

describe("checkpoint path boundary", () => {
  test("rejects a traversing turnId before touching project storage", async () => {
    await expect(
      writePreTurnSnapshot("project-does-not-matter", "../../victim"),
    ).rejects.toThrow("Unsafe path component");
  });
});

describe("checkpoint snapshot / restore round-trip", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(path.join(tmpdir(), "bg-ckpt-test-"));
    mkdirSync(path.join(projectDir, ".meta"), { recursive: true });
    mkdirSync(path.join(projectDir, ".attachments"), { recursive: true });
    mkdirSync(path.join(projectDir, ".burnguard-inputs"), { recursive: true });
    writeFileSync(path.join(projectDir, "index.html"), "<h1>v1</h1>", "utf8");
    writeFileSync(path.join(projectDir, "style.css"), "body { color: red; }", "utf8");
    mkdirSync(path.join(projectDir, "assets"), { recursive: true });
    writeFileSync(path.join(projectDir, "assets", "hero.svg"), "<svg/>", "utf8");
    writeFileSync(path.join(projectDir, ".attachments", "junk.bin"), "do-not-snapshot", "utf8");
    writeFileSync(path.join(projectDir, ".burnguard-inputs", "source.pdf"), "do-not-snapshot", "utf8");
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    for (const projectId of projectIds.splice(0)) getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
  });

  test("snapshot excludes control and stage-input directories", () => {
    takeSnapshot(projectDir, "turn-1");
    const snapPath = snapshotDir(projectDir, "turn-1");
    expect(existsSync(path.join(snapPath, "index.html"))).toBe(true);
    expect(existsSync(path.join(snapPath, "style.css"))).toBe(true);
    expect(existsSync(path.join(snapPath, "assets", "hero.svg"))).toBe(true);
    expect(existsSync(path.join(snapPath, ".attachments"))).toBe(false);
    expect(existsSync(path.join(snapPath, ".burnguard-inputs"))).toBe(false);
    expect(existsSync(path.join(snapPath, ".meta"))).toBe(false);
  });

  test("restore rewinds the project tree to the snapshot contents", () => {
    takeSnapshot(projectDir, "turn-1");

    // Simulate the turn modifying files + adding new ones.
    writeFileSync(path.join(projectDir, "index.html"), "<h1>v2</h1>", "utf8");
    writeFileSync(path.join(projectDir, "extra.txt"), "new file", "utf8");
    rmSync(path.join(projectDir, "style.css"));

    const result = restoreSnapshot(projectDir, "turn-1");
    expect(result).not.toBeNull();

    // v1 content is back, extra.txt is gone, style.css is back.
    expect(readFileSync(path.join(projectDir, "index.html"), "utf8")).toBe(
      "<h1>v1</h1>",
    );
    expect(existsSync(path.join(projectDir, "extra.txt"))).toBe(false);
    expect(existsSync(path.join(projectDir, "style.css"))).toBe(true);
    expect(
      readFileSync(path.join(projectDir, "assets", "hero.svg"), "utf8"),
    ).toBe("<svg/>");
  });

  test("restore leaves .attachments and .meta untouched", () => {
    takeSnapshot(projectDir, "turn-1");

    // Write NEW attachment + meta file AFTER the snapshot — these
    // must survive restore.
    writeFileSync(
      path.join(projectDir, ".attachments", "new-upload.png"),
      "ATTACH-v2",
      "utf8",
    );
    writeFileSync(
      path.join(projectDir, ".meta", "after-snap.json"),
      "{}",
      "utf8",
    );

    restoreSnapshot(projectDir, "turn-1");

    expect(
      readFileSync(path.join(projectDir, ".attachments", "new-upload.png"), "utf8"),
    ).toBe("ATTACH-v2");
    expect(
      existsSync(path.join(projectDir, ".meta", "after-snap.json")),
    ).toBe(true);
  });

  test("restore against a missing snapshot returns null", () => {
    expect(restoreSnapshot(projectDir, "never-existed")).toBeNull();
  });

  test("Given a real project When production snapshot and restore run Then bytes and checkpoint receipt round-trip", async () => {
    // Given
    projectSequence += 1;
    const projectId = `checkpoint-production-${process.pid}-${projectSequence}`;
    projectIds.push(projectId);
    getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, projectDir);
    getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(`${projectId}-session`, projectId);
    await indexProjectFiles(projectId);

    // When
    const snapshot = await writePreTurnSnapshot(projectId, "turn-production");
    writeFileSync(path.join(projectDir, "index.html"), "changed", "utf8");
    writeFileSync(path.join(projectDir, "new.txt"), "new", "utf8");
    const restored = await restoreFromSnapshot(projectId, "turn-production");
    await indexProjectFiles(projectId);
    const checkpoint = await writeTurnCheckpoint(projectId, "turn-production");

    // Then
    expect(snapshot?.turnId).toBe("turn-production");
    expect(await hasSnapshot(projectId, "turn-production")).toBe(true);
    expect(restored?.turnId).toBe("turn-production");
    expect(readFileSync(path.join(projectDir, "index.html"), "utf8")).toBe("<h1>v1</h1>");
    expect(existsSync(path.join(projectDir, "new.txt"))).toBe(false);
    expect(checkpoint?.turnId).toBe("turn-production");
    const indexed = await listIndexedProjectFiles(projectId);
    expect(indexed.length).toBeGreaterThan(0);
    await replaceProjectFiles(projectId, indexed);
    expect((await buildArtifactSummary(projectId))?.current_digest).toBeString();
    expect((await getProjectFile(projectId, "index.html"))?.hash).toBeString();
    expect((await getLatestProjectSession(projectId))?.id).toBe(`${projectId}-session`);
    expect(await listProjectIds()).toContain(projectId);
    expect((await resolveProjectFile(projectId, "index.html"))?.relPath).toBe("index.html");
    expect(await resolveProjectFile(projectId, "../escape")).toBeNull();
    expect((await resolveDrawFile(projectId, "notes/layer"))?.relPath).toBe("notes/layer");
    expect(isTransientFilePath(".index.1.2.tmp")).toBe(true);
    expect(getManagedExportJob("missing-export")).toBeNull();
  });

  async function createProductionProject(): Promise<string> {
    projectSequence += 1;
    const projectId = `checkpoint-production-${process.pid}-${projectSequence}`;
    projectIds.push(projectId);
    getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, projectDir);
    await indexProjectFiles(projectId);
    return projectId;
  }

  test("Given a written snapshot When a file inside it is lost Then it no longer verifies against its manifest", async () => {
    // Given
    const projectId = await createProductionProject();
    await writePreTurnSnapshot(projectId, "turn-torn");
    expect(await getVerifiedSnapshotPath(projectId, "turn-torn")).toBe(snapshotDir(projectDir, "turn-torn"));

    // When
    rmSync(path.join(snapshotDir(projectDir, "turn-torn"), "assets", "hero.svg"));

    // Then
    expect(await getVerifiedSnapshotPath(projectId, "turn-torn")).toBeNull();
    expect(await restoreFromSnapshot(projectId, "turn-torn")).toBeNull();
  });

  test("Given a well-formed snapshot tree without a manifest When verified Then it is rejected as unverifiable", async () => {
    // Given
    const projectId = await createProductionProject();
    await writePreTurnSnapshot(projectId, "turn-unmanifested");

    // When
    rmSync(path.join(snapshotRoot(projectDir), "turn-unmanifested.manifest.json"));

    // Then
    expect(await getVerifiedSnapshotPath(projectId, "turn-unmanifested")).toBeNull();
  });

  test("Given a crash leftover staging tree When a snapshot is written Then the leftover is never served as the snapshot and the renamed tree verifies", async () => {
    // Given
    const projectId = await createProductionProject();
    mkdirSync(path.join(snapshotRoot(projectDir), "turn-atomic.tmp-leftover"), { recursive: true });
    writeFileSync(path.join(snapshotRoot(projectDir), "turn-atomic.tmp-leftover", "index.html"), "partial", "utf8");

    // When
    await writePreTurnSnapshot(projectId, "turn-atomic");
    await writePreTurnSnapshot(projectId, "turn-atomic");

    // Then
    expect(readdirSync(snapshotRoot(projectDir)).sort()).toEqual(["turn-atomic", "turn-atomic.manifest.json", "turn-atomic.tmp-leftover"]);
    expect(readFileSync(path.join(snapshotDir(projectDir, "turn-atomic"), "index.html"), "utf8")).toBe("<h1>v1</h1>");
    expect(await getVerifiedSnapshotPath(projectId, "turn-atomic")).toBe(snapshotDir(projectDir, "turn-atomic"));
  });

  test("Given an existing checkpoint receipt When it is rewritten Then the receipt is complete JSON and no temporary file remains", async () => {
    // Given
    const projectId = await createProductionProject();
    const checkpointDir = path.join(projectDir, ".meta", "checkpoints");
    mkdirSync(checkpointDir, { recursive: true });
    writeFileSync(path.join(checkpointDir, "turn-receipt.json"), '{"turn_id":', "utf8");

    // When
    const checkpoint = await writeTurnCheckpoint(projectId, "turn-receipt");

    // Then
    expect(checkpoint?.path).toBe(path.join(checkpointDir, "turn-receipt.json"));
    const receipt: unknown = JSON.parse(readFileSync(path.join(checkpointDir, "turn-receipt.json"), "utf8"));
    expect(receipt).toMatchObject({ turn_id: "turn-receipt", project_id: projectId, file_count: 4 });
    expect(readdirSync(checkpointDir).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  test("Given snapshots older than the retention window When a new snapshot is written Then expired entries are pruned and recent ones kept", async () => {
    // Given
    const projectId = await createProductionProject();
    await writePreTurnSnapshot(projectId, "turn-old");
    await writePreTurnSnapshot(projectId, "turn-recent");
    const checkpointDir = path.join(projectDir, ".meta", "checkpoints");
    writeFileSync(path.join(checkpointDir, "turn-old.json.tmp-leftover"), "{", "utf8");
    const expired = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1000);
    for (const name of ["turn-old", "turn-old.manifest.json"]) utimesSync(path.join(snapshotRoot(projectDir), name), expired, expired);
    utimesSync(path.join(checkpointDir, "turn-old.json.tmp-leftover"), expired, expired);
    for (const name of ["turn-recent", "turn-recent.manifest.json"]) utimesSync(path.join(snapshotRoot(projectDir), name), recent, recent);

    // When
    await writePreTurnSnapshot(projectId, "turn-new");

    // Then
    expect(readdirSync(snapshotRoot(projectDir)).sort()).toEqual(["turn-new", "turn-new.manifest.json", "turn-recent", "turn-recent.manifest.json"]);
    expect(existsSync(path.join(checkpointDir, "turn-old.json.tmp-leftover"))).toBe(false);
    expect(await getVerifiedSnapshotPath(projectId, "turn-recent")).toBe(snapshotDir(projectDir, "turn-recent"));
  });
});
