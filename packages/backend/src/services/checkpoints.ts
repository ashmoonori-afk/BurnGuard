import { randomUUID } from "node:crypto";
import path from "node:path";
import { lstat, mkdir, readdir, readFile, rm } from "node:fs/promises";
import type { CheckpointRef } from "@bg/shared/harness";
import { getProjectDetail, listProjectIds } from "../db/project-read-repository";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { listIndexedProjectFiles } from "./files";
import { CanonicalTreeManifestError, inspectCanonicalTree, parseCanonicalTreeManifest, validateCanonicalTree } from "./canonical-tree-manifest";
import { getSqlite } from "../db/sqlite-client";
import { ArtifactCoordinator } from "./artifact-coordinator";
import { RETENTION_MS } from "./artifact-retention";
import { defaultManagedTreeIo, materializeManagedTree, type ManagedTreeIo } from "./artifact-tree-storage";
import { writeTextFileAtomically } from "./atomic-text-file";

async function checkpointStorageRoot(projectDir: string): Promise<string> {
  // Inspect the lexical ancestors: resolveWithin returns the real target and would hide an internal alias.
  const metadata = path.join(projectDir, ".meta");
  const checkpoints = path.join(metadata, "checkpoints");
  for (const directory of [projectDir, metadata, checkpoints, path.join(checkpoints, "snapshots"), path.join(checkpoints, "snapshots-v2")]) {
    const info = await lstat(directory).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    });
    if (info !== null && (info.isSymbolicLink() || !info.isDirectory())) {
      throw new CanonicalTreeManifestError("unsafe_tree_entry", "Checkpoint storage must use owned directories");
    }
  }
  return resolveWithin(projectDir, ".meta", "checkpoints");
}

function snapshotDir(projectDir: string, turnId: string, folder: "snapshots" | "snapshots-v2" = "snapshots-v2"): string {
  return path.join(
    projectDir,
    ".meta",
    "checkpoints",
    folder,
    assertSafeName(turnId),
  );
}

/** The manifest sits beside the snapshot so a torn copy cannot vouch for itself. */
function snapshotManifestPath(projectDir: string, turnId: string, folder: "snapshots" | "snapshots-v2" = "snapshots-v2"): string {
  return path.join(projectDir, ".meta", "checkpoints", folder, `${assertSafeName(turnId)}.manifest.json`);
}

/** Parks a live snapshot path so the publication can restore it when a later step fails. */
async function parkSnapshotPath(live: string, io: ManagedTreeIo, publicationId: string): Promise<{ readonly parked: string; readonly moved: boolean }> {
  const parked = `${live}.old-${publicationId}`;
  try { await io.rename(live, parked); return { parked, moved: true }; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { parked, moved: false };
    throw error;
  }
}

/**
 * Publishes a staged snapshot and its manifest: the previous pair is parked first and restored when the
 * swap or the atomic manifest write fails, so a failed re-snapshot keeps the turn's last verified pair
 * instead of a torn one. The atomic manifest write also fsyncs this directory, sealing the tree rename.
 */
async function publishSnapshot(staging: string, dest: string, manifestText: string, manifestPath: string, io: ManagedTreeIo): Promise<void> {
  let previousTree: Awaited<ReturnType<typeof parkSnapshotPath>> | null = null;
  let previousManifest: Awaited<ReturnType<typeof parkSnapshotPath>> | null = null;
  let treeInstalled = false;
  let manifestAttempted = false;
  const publicationId = randomUUID();
  try {
    previousTree = await parkSnapshotPath(dest, io, publicationId);
    previousManifest = await parkSnapshotPath(manifestPath, io, publicationId);
    await io.rename(staging, dest);
    treeInstalled = true;
    manifestAttempted = true;
    await writeTextFileAtomically(manifestPath, manifestText);
  } catch (error) {
    try {
      // Never remove an original whose parking step failed.
      if (treeInstalled) await rm(dest, { recursive: true, force: true });
      if (manifestAttempted) await rm(manifestPath, { force: true });
      if (previousTree?.moved) await io.rename(previousTree.parked, dest);
      if (previousManifest?.moved) await io.rename(previousManifest.parked, manifestPath);
      if (previousTree?.moved || previousManifest?.moved) await io.syncDirectory(path.dirname(dest));
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "checkpoint_rollback_failed");
    }
    throw error;
  }
  if (previousTree?.moved) await rm(previousTree.parked, { recursive: true, force: true }).catch(() => {});
  if (previousManifest?.moved) await rm(previousManifest.parked, { force: true }).catch(() => {});
}

/** Match both parked pieces by publication ID; restart must finish restoring a validated prior pair. */
async function recoverInterruptedSnapshots(projectDir: string): Promise<void> {
  await checkpointStorageRoot(projectDir);
  const root = resolveWithin(projectDir, ".meta", "checkpoints", "snapshots-v2");
  const names = await readdir(root).catch(() => []);
  const pairs = new Map<string, { readonly turnId: string; readonly publicationId: string }>();
  for (const name of names) {
    const match = /^(.*)\.old-([0-9a-f-]{36})$/.exec(name);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const stem = match[1];
    const turnId = stem.endsWith(".manifest.json") ? stem.slice(0, -".manifest.json".length) : stem;
    pairs.set(`${turnId}:${match[2]}`, { turnId, publicationId: match[2] });
  }
  for (const { turnId, publicationId } of pairs.values()) {
    const destination = path.join(root, assertSafeName(turnId));
    const manifest = path.join(root, `${turnId}.manifest.json`);
    const parkedTree = path.join(root, `${turnId}.old-${publicationId}`);
    const parkedManifest = path.join(root, `${turnId}.manifest.json.old-${publicationId}`);
    const validPair = async (tree: string, receipt: string): Promise<boolean> => {
      try {
        const info = await lstat(receipt);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) return false;
        await validateCanonicalTree(tree, parseCanonicalTreeManifest(JSON.parse(await readFile(receipt, "utf8"))));
        return true;
      } catch (error) {
        if (error instanceof Error) return false;
        throw error;
      }
    };
    if (await validPair(destination, manifest)) continue;
    if (await validPair(destination, parkedManifest)) {
      await rm(manifest, { force: true });
      await defaultManagedTreeIo.rename(parkedManifest, manifest);
    } else {
      const receipt = await validPair(parkedTree, parkedManifest) ? parkedManifest : manifest;
      if (!(await validPair(parkedTree, receipt))) continue;
      await rm(destination, { recursive: true, force: true });
      await defaultManagedTreeIo.rename(parkedTree, destination);
      if (receipt === parkedManifest) {
        await rm(manifest, { force: true });
        await defaultManagedTreeIo.rename(parkedManifest, manifest);
      }
    }
    await defaultManagedTreeIo.syncDirectory(root);
  }
}

/** Snapshots, their manifests, and crash leftovers expire with the shared artifact retention window. */
async function pruneExpiredSnapshots(projectDir: string, keepTurnId: string | null, now: number): Promise<void> {
  const checkpointDir = await checkpointStorageRoot(projectDir);
  const candidates: string[] = [];
  for (const folder of ["snapshots", "snapshots-v2"]) {
    const snapshotRoot = resolveWithin(projectDir, ".meta", "checkpoints", folder);
    const visited = new Set<string>();
    for (const name of await readdir(snapshotRoot).catch(() => [])) {
      const turnId = name.endsWith(".manifest.json") ? name.slice(0, -".manifest.json".length) : name;
      if (turnId === keepTurnId || visited.has(turnId)) continue;
      visited.add(turnId);
      try {
        const tree = path.join(snapshotRoot, turnId);
        const manifest = path.join(snapshotRoot, `${turnId}.manifest.json`);
        const manifestInfo = await lstat(manifest).catch((error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
          throw error;
        });
        // The receipt dates the immutable pair. Never drop verification while leaving a changed tree.
        if ((manifestInfo ?? await lstat(tree)).mtimeMs > now - RETENTION_MS) continue;
        await rm(tree, { recursive: true, force: true });
        if (manifestInfo !== null) await rm(manifest, { force: true });
      } catch {
        console.warn("[checkpoints] expired snapshot cleanup deferred");
      }
    }
  }
  for (const name of await readdir(checkpointDir).catch(() => [])) {
    // The atomic writer's crash leftovers end in `.tmp`; a committed receipt is `<turnId>.json`.
    if (name.endsWith(".tmp")) candidates.push(path.join(checkpointDir, name));
  }
  for (const candidate of candidates) {
    try {
      // A fresh mtime is an in-progress or just-published entry; only expired bytes leave.
      if ((await lstat(candidate)).mtimeMs > now - RETENTION_MS) continue;
      await rm(candidate, { recursive: true, force: true });
    } catch {
      // A held handle keeps this entry until the next snapshot sweep.
      console.warn("[checkpoints] expired snapshot cleanup deferred");
    }
  }
}

/**
 * Best-effort startup sweep so projects that never run another turn still release expired snapshots.
 * Bootstrap awaits this before opening the listener or starting watchers, so no snapshot publication
 * can be in progress. It walks every project rather than an arbitrary prefix.
 */
export async function pruneExpiredSnapshotsAtStartup(now: number = Date.now()): Promise<void> {
  try {
    for (const id of await listProjectIds()) {
      try {
        const project = await getProjectDetail(id);
        if (project !== null) {
          // Global destructive maintenance requires managed ownership; targeted snapshot callers keep
          // their existing project-root contract (including isolated roots used by route integrations).
          const managed = resolveManagedPath(projectsDir, project.dir_path);
          await recoverInterruptedSnapshots(managed);
          await pruneExpiredSnapshots(managed, null, now);
        }
      } catch { console.warn("[checkpoints] expired snapshot cleanup deferred"); }
    }
  } catch { console.warn("[checkpoints] expired snapshot cleanup deferred"); }
}

/**
 * Snapshots the managed artifact tree before a turn starts.
 * Private uploads and checkpoint metadata stay outside rollback.
 */
export async function writePreTurnSnapshot(
  projectId: string,
  turnId: string,
  io: ManagedTreeIo = defaultManagedTreeIo,
): Promise<CheckpointRef | null> {
  assertSafeName(turnId);
  const project = await getProjectDetail(projectId);
  if (!project) return null;
  await checkpointStorageRoot(project.dir_path);

  const dest = snapshotDir(project.dir_path, turnId);
  const manifestPath = snapshotManifestPath(project.dir_path, turnId);
  // Stage the copy as a sibling and swap it in: a crash leaves only a sibling that is never read as the
  // snapshot, and the previous tree is parked until the new tree and its manifest are in place.
  const staging = `${dest}.tmp-${randomUUID()}`;
  try {
    const manifest = await materializeManagedTree(project.dir_path, staging, io);
    // Recursive mkdir creates private ancestors too; seal their entries before changing live authority.
    for (let directory = path.dirname(staging); ; directory = path.dirname(directory)) {
      await io.syncDirectory(directory);
      if (directory === path.resolve(project.dir_path)) break;
    }
    await publishSnapshot(staging, dest, JSON.stringify(manifest), manifestPath, io);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  const createdAt = Date.now();
  try { await pruneExpiredSnapshots(project.dir_path, turnId, createdAt); }
  catch { console.warn("[checkpoints] expired snapshot cleanup deferred"); }
  return {
    turnId,
    path: dest,
    createdAt,
  };
}

export async function getVerifiedSnapshotPath(projectId: string, turnId: string): Promise<string | null> {
  assertSafeName(turnId);
  const project = await getProjectDetail(projectId);
  if (project === null) return null;
  try {
    await checkpointStorageRoot(project.dir_path);
    const current = snapshotDir(project.dir_path, turnId);
    const currentManifest = snapshotManifestPath(project.dir_path, turnId);
    const exists = async (target: string): Promise<boolean> => {
      try { await lstat(target); return true; }
      catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
        throw error;
      }
    };
    // The namespace survives loss of a manifest: a new-format tree must never vouch for itself.
    const legacy = !(await exists(current)) && !(await exists(currentManifest));
    const folder = legacy ? "snapshots" : "snapshots-v2";
    const destination = snapshotDir(project.dir_path, turnId, folder);
    const receipt = snapshotManifestPath(project.dir_path, turnId, folder);
    const receiptInfo = await lstat(receipt).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    });
    if (receiptInfo !== null && (receiptInfo.isSymbolicLink() || !receiptInfo.isFile() || receiptInfo.nlink > 1)) return null;
    const manifestText = await readFile(receipt, "utf8").catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    });
    // Snapshots written before manifests existed keep the structural check; a manifest that exists must match.
    if (manifestText === null) {
      if (!legacy) return null;
      await inspectCanonicalTree(destination);
    }
    else await validateCanonicalTree(destination, parseCanonicalTreeManifest(JSON.parse(manifestText)));
    return destination;
  }
  catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

export async function hasSnapshot(
  projectId: string,
  turnId: string,
): Promise<boolean> {
  return (await getVerifiedSnapshotPath(projectId, turnId)) !== null;
}

export interface RestoreResult {
  turnId: string;
  restoredAt: number;
  removedEntries: string[];
  copiedEntries: string[];
}

/**
 * Restores the project file tree to the pre-turn snapshot for
 * `turnId` through managed publication, preserving private uploads.
 * Callers must ensure no
 * turn is running — this function will happily overwrite files under
 * an active CLI subprocess if called concurrently.
 */
export async function restoreFromSnapshot(
  projectId: string,
  turnId: string,
): Promise<RestoreResult | null> {
  assertSafeName(turnId);
  const project = await getProjectDetail(projectId);
  if (!project) return null;

  const source = await getVerifiedSnapshotPath(projectId, turnId);
  if (source === null) return null;
  const coordinator = new ArtifactCoordinator(getSqlite());
  if (project.current_digest === null) await coordinator.initialize(projectId, project.dir_path);
  else await coordinator.observeExternal(projectId, project.dir_path);
  const current = await getProjectDetail(projectId);
  if (current?.current_digest === null || current === null) return null;
  const operation = await coordinator.run({ projectId, projectDir: project.dir_path, kind: "restore", expectedRevision: current.current_revision, expectedArtifactDigest: current.current_digest, mutate: async (stage) => { await materializeManagedTree(source, stage); } });
  return { turnId, restoredAt: Date.now(), removedEntries: operation.diff.filter((entry) => entry.action === "deleted").map((entry) => entry.path), copiedEntries: operation.diff.filter((entry) => entry.action !== "deleted").map((entry) => entry.path) };
}

export async function writeTurnCheckpoint(
  projectId: string,
  turnId: string,
): Promise<CheckpointRef | null> {
  const safeTurnId = assertSafeName(turnId);
  const project = await getProjectDetail(projectId);
  if (!project) {
    return null;
  }

  const files = await listIndexedProjectFiles(projectId);
  const checkpointDir = await checkpointStorageRoot(project.dir_path);
  const checkpointPath = path.join(checkpointDir, `${safeTurnId}.json`);
  const createdAt = Date.now();

  await mkdir(checkpointDir, { recursive: true });
  await writeTextFileAtomically(
    checkpointPath,
    JSON.stringify(
      {
        turn_id: turnId,
        project_id: projectId,
        entrypoint: project.entrypoint,
        file_count: files.length,
        files,
        created_at: createdAt,
      },
      null,
      2,
    ),
  );

  return {
    turnId,
    path: checkpointPath,
    createdAt,
  };
}
