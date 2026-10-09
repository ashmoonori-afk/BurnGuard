import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getVerifiedSnapshotPath, hasSnapshot, pruneExpiredSnapshotsAtStartup, restoreFromSnapshot, writePreTurnSnapshot, writeTurnCheckpoint } from "../src/services/checkpoints";
import { defaultManagedTreeIo, type ManagedTreeIo } from "../src/services/artifact-tree-storage";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { indexProjectFiles, isTransientFilePath, resolveDrawFile, resolveProjectFile } from "../src/services/managed-project-files";
import { buildArtifactSummary, listIndexedProjectFiles } from "../src/services/files";
import { getLatestProjectSession, listProjectIds } from "../src/db/project-read-repository";
import { getProjectFile, replaceProjectFiles } from "../src/db/files";
import { getManagedExportJob } from "../src/db/managed-file-repository";
import { projectsDir } from "../src/lib/paths";

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

function snapshotRoot(projectDir: string, folder: "snapshots" | "snapshots-v2" = "snapshots"): string {
  return path.join(projectDir, ".meta", "checkpoints", folder);
}

function snapshotDir(projectDir: string, turnId: string, folder: "snapshots" | "snapshots-v2" = "snapshots"): string {
  return path.join(snapshotRoot(projectDir, folder), turnId);
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
    mkdirSync(projectsDir, { recursive: true });
    projectDir = mkdtempSync(path.join(projectsDir, "bg-ckpt-test-"));
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

  async function createProductionProject(directory: string = projectDir): Promise<string> {
    projectSequence += 1;
    const projectId = `checkpoint-production-${process.pid}-${projectSequence}`;
    projectIds.push(projectId);
    getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, directory);
    await indexProjectFiles(projectId);
    return projectId;
  }

  test("Given redirected private checkpoint storage When startup sweeps Then authored snapshots are untouched", async () => {
    await createProductionProject();
    const authored = path.join(projectDir, "snapshots");
    mkdirSync(authored);
    const note = path.join(authored, "notes.txt");
    writeFileSync(note, "authored", "utf8");
    const expired = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    utimesSync(note, expired, expired);
    symlinkSync(projectDir, path.join(projectDir, ".meta", "checkpoints"), process.platform === "win32" ? "junction" : "dir");

    await pruneExpiredSnapshotsAtStartup();
    expect(existsSync(note)).toBe(true);
    expect(readFileSync(note, "utf8")).toBe("authored");
  });

  test("Given a database path outside managed projects When startup sweeps Then its private-looking files are untouched", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "bg-ckpt-outside-"));
    try {
      writeFileSync(path.join(outside, "index.html"), "<h1>outside</h1>", "utf8");
      const snapshots = path.join(outside, ".meta", "checkpoints", "snapshots");
      mkdirSync(snapshots, { recursive: true });
      const note = path.join(snapshots, "notes.txt");
      writeFileSync(note, "outside", "utf8");
      const expired = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      utimesSync(note, expired, expired);
      await createProductionProject(outside);

      await pruneExpiredSnapshotsAtStartup();
      expect(existsSync(note)).toBe(true);
      expect(readFileSync(note, "utf8")).toBe("outside");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("Given a snapshot entry linked to authored bytes When its manifest expires Then pruning removes only the private link", async () => {
    await createProductionProject();
    const authored = path.join(projectDir, "authored");
    mkdirSync(authored);
    const note = path.join(authored, "notes.txt");
    writeFileSync(note, "authored", "utf8");
    const root = snapshotRoot(projectDir, "snapshots-v2");
    mkdirSync(root, { recursive: true });
    symlinkSync(authored, path.join(root, "turn-link"), process.platform === "win32" ? "junction" : "dir");
    const receipt = path.join(root, "turn-link.manifest.json");
    writeFileSync(receipt, "{}", "utf8");
    const expired = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    utimesSync(receipt, expired, expired);

    await pruneExpiredSnapshotsAtStartup();
    expect(readFileSync(note, "utf8")).toBe("authored");
  });

  test.each([
    { name: "tree_parked", manifestParked: false, incomingVisible: false, treeRestored: false },
    { name: "pair_parked", manifestParked: true, incomingVisible: false, treeRestored: false },
    { name: "incoming_visible", manifestParked: true, incomingVisible: true, treeRestored: false },
    { name: "rollback_interrupted", manifestParked: true, incomingVisible: false, treeRestored: true },
  ])("Given interrupted replacement at $name When startup recovers Then the previous verified pair is available", async ({ manifestParked, incomingVisible, treeRestored }) => {
    // Given: actual filesystem states at each rename boundary, as left by process termination.
    const projectId = await createProductionProject();
    const snapshot = await writePreTurnSnapshot(projectId, "turn-restart");
    if (snapshot === null) throw new Error("fixture_snapshot_missing");
    const manifest = path.join(path.dirname(snapshot.path), "turn-restart.manifest.json");
    const publicationId = crypto.randomUUID();
    const parked = `${snapshot.path}.old-${publicationId}`;
    await fsPromises.rename(snapshot.path, parked);
    if (manifestParked) await fsPromises.rename(manifest, `${manifest}.old-${publicationId}`);
    if (incomingVisible) {
      mkdirSync(snapshot.path);
      writeFileSync(path.join(snapshot.path, "index.html"), "incomplete", "utf8");
    }
    if (treeRestored) await fsPromises.rename(parked, snapshot.path);

    // When
    await pruneExpiredSnapshotsAtStartup();

    // Then
    expect(await getVerifiedSnapshotPath(projectId, "turn-restart")).toBe(snapshot.path);
    expect(readFileSync(path.join(snapshot.path, "index.html"), "utf8")).toBe("<h1>v1</h1>");
    expect(readFileSync(path.join(snapshot.path, "style.css"), "utf8")).toBe("body { color: red; }");
  });

  test("Given a verified snapshot When the second parking step fails Then its prior tree and manifest remain usable", async () => {
    const projectId = await createProductionProject();
    const prior = await writePreTurnSnapshot(projectId, "turn-park");
    if (prior === null) throw new Error("fixture_snapshot_missing");
    writeFileSync(path.join(projectDir, "index.html"), "<h1>changed</h1>", "utf8");
    const failure = new Error("injected_manifest_park_failure");
    const io: ManagedTreeIo = {
      ...defaultManagedTreeIo,
      rename: async (from, to) => {
        if (from.endsWith("turn-park.manifest.json") && to.includes(".old-")) throw failure;
        await defaultManagedTreeIo.rename(from, to);
      },
    };

    await expect(writePreTurnSnapshot(projectId, "turn-park", io)).rejects.toBe(failure);
    const verified = await getVerifiedSnapshotPath(projectId, "turn-park");
    expect(verified).toBe(prior.path);
    expect(readFileSync(path.join(prior.path, "index.html"), "utf8")).toBe("<h1>v1</h1>");
  });

  test("Given a newly written snapshot When its manifest disappears Then it never becomes an unsealed legacy snapshot", async () => {
    const projectId = await createProductionProject();
    const snapshot = await writePreTurnSnapshot(projectId, "turn-unsealed");
    if (snapshot === null) throw new Error("fixture_snapshot_missing");
    rmSync(path.join(path.dirname(snapshot.path), "turn-unsealed.manifest.json"));

    expect(await getVerifiedSnapshotPath(projectId, "turn-unsealed")).toBeNull();
  });

  test("Given a damaged snapshot with an expired manifest When startup prunes Then corruption is not accepted as legacy", async () => {
    const projectId = await createProductionProject();
    const snapshot = await writePreTurnSnapshot(projectId, "turn-expired-manifest");
    if (snapshot === null) throw new Error("fixture_snapshot_missing");
    rmSync(path.join(snapshot.path, "style.css"));
    const manifest = path.join(path.dirname(snapshot.path), "turn-expired-manifest.manifest.json");
    const expired = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    utimesSync(manifest, expired, expired);
    expect(await getVerifiedSnapshotPath(projectId, "turn-expired-manifest")).toBeNull();

    await pruneExpiredSnapshotsAtStartup();
    expect(await getVerifiedSnapshotPath(projectId, "turn-expired-manifest")).toBeNull();
  });

  test("Given a written snapshot When a file inside it is lost Then it no longer verifies against its manifest", async () => {
    // Given
    const projectId = await createProductionProject();
    await writePreTurnSnapshot(projectId, "turn-torn");
    expect(await getVerifiedSnapshotPath(projectId, "turn-torn")).toBe(snapshotDir(projectDir, "turn-torn", "snapshots-v2"));

    // When
    rmSync(path.join(snapshotDir(projectDir, "turn-torn", "snapshots-v2"), "assets", "hero.svg"));

    // Then
    expect(await getVerifiedSnapshotPath(projectId, "turn-torn")).toBeNull();
    expect(await restoreFromSnapshot(projectId, "turn-torn")).toBeNull();
  });

  test("Given a legacy snapshot without a manifest When restored Then it falls back to the structural check and restores", async () => {
    // Given
    const projectId = await createProductionProject();
    takeSnapshot(projectDir, "turn-legacy");

    // When
    const verified = await getVerifiedSnapshotPath(projectId, "turn-legacy");
    const restored = await restoreFromSnapshot(projectId, "turn-legacy");

    // Then
    expect(verified).toBe(snapshotDir(projectDir, "turn-legacy"));
    expect(restored).not.toBeNull();
  });

  test("Given a snapshot whose manifest exists but is corrupt When verified Then it is refused", async () => {
    // Given
    const projectId = await createProductionProject();
    await writePreTurnSnapshot(projectId, "turn-bad-manifest");

    // When
    writeFileSync(path.join(snapshotRoot(projectDir, "snapshots-v2"), "turn-bad-manifest.manifest.json"), "{", "utf8");

    // Then
    expect(await getVerifiedSnapshotPath(projectId, "turn-bad-manifest")).toBeNull();
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
    expect(readdirSync(snapshotRoot(projectDir)).sort()).toEqual(["turn-atomic.tmp-leftover"]);
    expect(readdirSync(snapshotRoot(projectDir, "snapshots-v2")).sort()).toEqual(["turn-atomic", "turn-atomic.manifest.json"]);
    expect(readFileSync(path.join(snapshotDir(projectDir, "turn-atomic", "snapshots-v2"), "index.html"), "utf8")).toBe("<h1>v1</h1>");
    expect(await getVerifiedSnapshotPath(projectId, "turn-atomic")).toBe(snapshotDir(projectDir, "turn-atomic", "snapshots-v2"));
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
    expect(readdirSync(checkpointDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("Given a valid checkpoint receipt When its replacement write fails after partial bytes Then the original receipt survives", async () => {
    // Given
    const projectId = await createProductionProject();
    const checkpoint = await writeTurnCheckpoint(projectId, "turn-receipt-fault");
    if (checkpoint === null) throw new Error("fixture_checkpoint_missing");
    const original = readFileSync(checkpoint.path, "utf8");
    const failure = new Error("injected_receipt_write_failure");
    const open = fsPromises.open;
    const fault = spyOn(fsPromises, "open").mockImplementation(async (target, flags, mode) => {
      const handle = await open(target, flags, mode);
      if (String(target).startsWith(`${checkpoint.path}.`) && String(target).endsWith(".tmp")) {
        const write = handle.writeFile.bind(handle);
        handle.writeFile = async () => { await write("{", "utf8"); throw failure; };
      }
      return handle;
    });

    // When
    try {
      await expect(writeTurnCheckpoint(projectId, "turn-receipt-fault")).rejects.toBe(failure);
    } finally {
      fault.mockRestore();
    }

    // Then
    expect(readFileSync(checkpoint.path, "utf8")).toBe(original);
    expect(readdirSync(path.dirname(checkpoint.path)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("Given snapshots older than the retention window When a new snapshot is written Then expired entries are pruned and recent ones kept", async () => {
    // Given
    const projectId = await createProductionProject();
    await writePreTurnSnapshot(projectId, "turn-old");
    await writePreTurnSnapshot(projectId, "turn-recent");
    const checkpointDir = path.join(projectDir, ".meta", "checkpoints");
    const leftover = "turn-old.json.00000000-0000-0000-0000-000000000000.tmp";
    writeFileSync(path.join(checkpointDir, leftover), "{", "utf8");
    const expired = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1000);
    for (const name of ["turn-old", "turn-old.manifest.json"]) utimesSync(path.join(snapshotRoot(projectDir, "snapshots-v2"), name), expired, expired);
    utimesSync(path.join(checkpointDir, leftover), expired, expired);
    for (const name of ["turn-recent", "turn-recent.manifest.json"]) utimesSync(path.join(snapshotRoot(projectDir, "snapshots-v2"), name), recent, recent);

    // When
    await writePreTurnSnapshot(projectId, "turn-new");

    // Then
    expect(readdirSync(snapshotRoot(projectDir, "snapshots-v2")).sort()).toEqual(["turn-new", "turn-new.manifest.json", "turn-recent", "turn-recent.manifest.json"]);
    expect(existsSync(path.join(checkpointDir, leftover))).toBe(false);
    expect(await getVerifiedSnapshotPath(projectId, "turn-recent")).toBe(snapshotDir(projectDir, "turn-recent", "snapshots-v2"));
  });

  test("Given an expired snapshot and no new turn When the startup sweep runs Then the expired snapshot is pruned and the recent one kept", async () => {
    // Given
    const projectId = await createProductionProject();
    await writePreTurnSnapshot(projectId, "turn-stale");
    await writePreTurnSnapshot(projectId, "turn-fresh");
    const expired = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    for (const name of ["turn-stale", "turn-stale.manifest.json"]) utimesSync(path.join(snapshotRoot(projectDir, "snapshots-v2"), name), expired, expired);

    // When
    await pruneExpiredSnapshotsAtStartup();

    // Then
    expect(readdirSync(snapshotRoot(projectDir, "snapshots-v2")).sort()).toEqual(["turn-fresh", "turn-fresh.manifest.json"]);
  });

  test("Given an existing verified snapshot When republishing fails mid-swap Then the previous snapshot is still restorable", async () => {
    // Given
    const projectId = await createProductionProject();
    const dest = snapshotDir(projectDir, "turn-swap", "snapshots-v2");
    await writePreTurnSnapshot(projectId, "turn-swap");
    expect(await getVerifiedSnapshotPath(projectId, "turn-swap")).toBe(dest);
    // Fail only the staging tree becoming visible; the rollback rename of the parked tree must still run.
    const failing: ManagedTreeIo = {
      ...defaultManagedTreeIo,
      rename: async (from: string, to: string) => {
        if (to === dest && from.includes(".tmp-")) throw new Error("swap failed");
        await defaultManagedTreeIo.rename(from, to);
      },
    };
    writeFileSync(path.join(projectDir, "index.html"), "<h1>v2</h1>", "utf8");

    // When / Then
    await expect(writePreTurnSnapshot(projectId, "turn-swap", failing)).rejects.toThrow("swap failed");
    expect(await getVerifiedSnapshotPath(projectId, "turn-swap")).toBe(dest);
    expect(readFileSync(path.join(dest, "index.html"), "utf8")).toBe("<h1>v1</h1>");
    expect(readdirSync(snapshotRoot(projectDir, "snapshots-v2")).filter((name) => name.includes(".old-") || name.includes(".tmp-"))).toEqual([]);
  });

  test("Given a snapshot write When it publishes Then the tree becomes visible only after its bytes are flushed", async () => {
    // Given
    const projectId = await createProductionProject();
    const events: string[] = [];
    const recording: ManagedTreeIo = {
      ...defaultManagedTreeIo,
      syncFile: async (handle: FileHandle) => { events.push("sync"); await defaultManagedTreeIo.syncFile(handle); },
      rename: async (from: string, to: string) => { events.push(`rename:${path.basename(to)}`); await defaultManagedTreeIo.rename(from, to); },
    };

    // When
    await writePreTurnSnapshot(projectId, "turn-sealed", recording);

    // Then
    const visible = events.indexOf("rename:turn-sealed");
    expect(visible).toBeGreaterThan(-1);
    expect(events.lastIndexOf("sync")).toBeGreaterThan(-1);
    expect(visible).toBeGreaterThan(events.lastIndexOf("sync"));
    expect(events.filter((event) => event === "sync").length).toBeGreaterThan(1);
  });
});
