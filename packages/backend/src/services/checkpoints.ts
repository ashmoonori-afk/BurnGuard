import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import type { CheckpointRef } from "@bg/shared/harness";
import { getProjectDetail, listProjectIds } from "../db/project-read-repository";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import { listIndexedProjectFiles } from "./files";
import { inspectCanonicalTree, parseCanonicalTreeManifest, validateCanonicalTree } from "./canonical-tree-manifest";
import { getSqlite } from "../db/sqlite-client";
import { ArtifactCoordinator } from "./artifact-coordinator";
import { ARTIFACT_RETENTION_MS } from "./artifact-retention-window";
import { materializeManagedTree } from "./artifact-tree-storage";

function snapshotDir(projectDir: string, turnId: string): string {
  return resolveWithin(
    projectDir,
    ".meta",
    "checkpoints",
    "snapshots",
    assertSafeName(turnId),
  );
}

/** The manifest sits beside the snapshot so a torn copy cannot vouch for itself. */
function snapshotManifestPath(projectDir: string, turnId: string): string {
  return resolveWithin(projectDir, ".meta", "checkpoints", "snapshots", `${assertSafeName(turnId)}.manifest.json`);
}

async function writeFileAtomic(target: string, content: string): Promise<void> {
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** Snapshots, their manifests, and crash leftovers expire with the shared artifact retention window. */
async function pruneExpiredSnapshots(projectDir: string, keepTurnId: string | null, now: number): Promise<void> {
  const checkpointDir = resolveWithin(projectDir, ".meta", "checkpoints");
  const snapshotRoot = resolveWithin(checkpointDir, "snapshots");
  const candidates: string[] = [];
  for (const name of await readdir(snapshotRoot).catch(() => [])) {
    if (name !== keepTurnId && name !== `${keepTurnId}.manifest.json`) candidates.push(resolveWithin(snapshotRoot, name));
  }
  for (const name of await readdir(checkpointDir).catch(() => [])) {
    if (name.includes(".json.tmp-")) candidates.push(resolveWithin(checkpointDir, name));
  }
  for (const candidate of candidates) {
    try {
      if ((await lstat(candidate)).mtimeMs > now - ARTIFACT_RETENTION_MS) continue;
      await rm(candidate, { recursive: true, force: true });
    } catch {
      // A held handle keeps this entry until the next snapshot sweep.
      console.warn("[checkpoints] expired snapshot cleanup deferred");
    }
  }
}

const STARTUP_SWEEP_PROJECT_LIMIT = 500;

/** Best-effort startup sweep so projects that never run another turn still release expired snapshots. */
export async function pruneExpiredSnapshotsAtStartup(now: number = Date.now()): Promise<void> {
  try {
    const ids = (await listProjectIds()).slice(0, STARTUP_SWEEP_PROJECT_LIMIT);
    for (const id of ids) {
      try {
        const project = await getProjectDetail(id);
        if (project !== null) await pruneExpiredSnapshots(project.dir_path, null, now);
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
): Promise<CheckpointRef | null> {
  assertSafeName(turnId);
  const project = await getProjectDetail(projectId);
  if (!project) return null;

  const dest = snapshotDir(project.dir_path, turnId);
  const manifestPath = snapshotManifestPath(project.dir_path, turnId);
  // Copy into a sibling and rename, so a crash never leaves a partial tree at `dest`.
  const staging = `${dest}.tmp-${randomUUID()}`;
  try {
    const manifest = await materializeManagedTree(project.dir_path, staging);
    await rm(dest, { recursive: true, force: true });
    await writeFileAtomic(manifestPath, JSON.stringify(manifest));
    await rename(staging, dest);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
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
  const destination = snapshotDir(project.dir_path, turnId);
  try {
    const manifestText = await readFile(snapshotManifestPath(project.dir_path, turnId), "utf8").catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    // Snapshots written before manifests existed keep the structural check; a manifest that exists must match.
    if (manifestText === null) await inspectCanonicalTree(destination);
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
  assertSafeName(turnId);
  const project = await getProjectDetail(projectId);
  if (!project) return false;
  const dest = snapshotDir(project.dir_path, turnId);
  try {
    const info = await stat(dest);
    return info.isDirectory();
  } catch {
    return false;
  }
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
  const checkpointDir = resolveWithin(project.dir_path, ".meta", "checkpoints");
  const checkpointPath = resolveWithin(
    project.dir_path,
    ".meta",
    "checkpoints",
    `${safeTurnId}.json`,
  );
  const createdAt = Date.now();

  await mkdir(checkpointDir, { recursive: true });
  await writeFileAtomic(
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
