import { mkdir, stat, writeFile } from "node:fs/promises";
import type { CheckpointRef } from "@bg/shared/harness";
import { getProjectDetail } from "../db/project-read-repository";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import { listIndexedProjectFiles } from "./files";
import { inspectCanonicalTree } from "./canonical-tree-manifest";
import { getSqlite } from "../db/sqlite-client";
import { ArtifactCoordinator } from "./artifact-coordinator";
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
  await materializeManagedTree(project.dir_path, dest);

  const createdAt = Date.now();
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
  try { await inspectCanonicalTree(destination); return destination; }
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
  await writeFile(
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
    "utf8",
  );

  return {
    turnId,
    path: checkpointPath,
    createdAt,
  };
}
