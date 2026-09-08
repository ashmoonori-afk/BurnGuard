import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { assertSafeName, PathBoundaryError, resolveWithin } from "../security/path-boundary";
import { closeProjectWatcher, projectWatchers } from "./watcher-registry";
import { ensureProjectWatcher, isProjectSignalPending } from "./watchers";
import { isUserTurnRunning } from "./turns";
import { isDirectionOperationActive } from "./direction-operation-registry";
import { isArtifactProjectBusy } from "./artifact-project-lock";

export class ProjectDeletionError extends Error {
  constructor(readonly code: "project_not_found" | "project_in_use" | "project_delete_failed") { super(code); }
}

export async function deleteProject(db: Database, projectId: string, options: { readonly projectsRoot?: string; readonly beforeDatabaseDelete?: () => void } = {}): Promise<void> {
  const root = options.projectsRoot ?? projectsDir;
  let original: string | null = null;
  let tombstone: string | null = null;
  let moved = false;
  let ownsTombstone = false;
  const wasWatched = projectWatchers.has(projectId);
  try {
    db.transaction(() => {
      const project = db.query<{ dir_path: string }, [string]>("SELECT dir_path FROM projects WHERE id=?").get(projectId);
      if (project === null) throw new ProjectDeletionError("project_not_found");
      const sessions = db.query<{ id: string; status: string }, [string]>("SELECT id,status FROM sessions WHERE project_id=?").all(projectId);
      const referenced = db.query("SELECT 1 FROM learning_checkpoints WHERE project_id=? LIMIT 1").get(projectId);
      const operation = db.query("SELECT 1 FROM artifact_operations WHERE project_id=? AND status IN ('pending','working','recovering') LIMIT 1").get(projectId);
      const exporting = db.query("SELECT 1 FROM exports e JOIN export_attempts a ON a.job_id=e.id WHERE e.project_id=? AND a.status IN ('pending','running','validating','retrying','recovering') LIMIT 1").get(projectId);
      if (referenced || operation || exporting || isArtifactProjectBusy(db, projectId) || isProjectSignalPending(projectId) || sessions.some((s) => s.status === "running" || s.status === "awaiting_tool" || isUserTurnRunning(s.id) || isDirectionOperationActive(s.id))) throw new ProjectDeletionError("project_in_use");
      try { original = resolveManagedPath(root, project.dir_path); }
      catch (error) {
        // A legacy row outside managed storage may be removed, never its files.
        if (!(error instanceof PathBoundaryError) || error.code !== "outside_root") throw error;
      }
      if (original !== null && existsSync(original)) {
        const trash = resolveWithin(root, ".deletions");
        mkdirSync(trash, { recursive: true });
        tombstone = resolveWithin(trash, assertSafeName(projectId));
        if (existsSync(tombstone)) throw new ProjectDeletionError("project_delete_failed");
        mkdirSync(tombstone);
        ownsTombstone = true;
        writeFileSync(path.join(tombstone, "receipt.json"), JSON.stringify({ schema_version: 1, project_id: projectId, source_relative_path: path.relative(root, original).split(path.sep).join("/") }), { encoding: "utf8", flag: "wx" });
        closeProjectWatcher(projectId);
        renameSync(original, path.join(tombstone, "files"));
        moved = true;
      }
      options.beforeDatabaseDelete?.();
      db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
    })();
  } catch (error) {
    // SQLite rolled back. Restore the original bytes before reporting failure.
    if (moved && original !== null && tombstone !== null) renameSync(path.join(tombstone, "files"), original);
    if (ownsTombstone && tombstone !== null) await rm(tombstone, { recursive: true, force: true });
    if (wasWatched && moved) await ensureProjectWatcher(projectId);
    if (error instanceof ProjectDeletionError) throw error;
    throw new ProjectDeletionError("project_delete_failed");
  }
  closeProjectWatcher(projectId);
  if (tombstone !== null) {
    // Committed deletion remains recoverable/cleanable if Windows holds a handle.
    try { await rm(tombstone, { recursive: true, force: true }); }
    catch { console.warn("[project] deferred deleted project cleanup", projectId); }
  }
}

/** Crash between rename and DB commit: row exists => restore; absent => collect. */
export async function reconcileProjectDeletions(db: Database, root = projectsDir): Promise<void> {
  const trash = resolveWithin(root, ".deletions");
  if (!existsSync(trash)) return;
  for (const entry of await readdir(trash, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new ProjectDeletionError("project_delete_failed");
    const id = assertSafeName(entry.name);
    const tombstone = resolveWithin(trash, id);
    const receipt: unknown = JSON.parse(readFileSync(resolveWithin(tombstone, "receipt.json"), "utf8"));
    if (typeof receipt !== "object" || receipt === null || Array.isArray(receipt) || Object.keys(receipt).sort().join(",") !== "project_id,schema_version,source_relative_path"
      || !("schema_version" in receipt) || receipt.schema_version !== 1 || !("project_id" in receipt) || receipt.project_id !== id
      || !("source_relative_path" in receipt) || typeof receipt.source_relative_path !== "string" || receipt.source_relative_path.length === 0) throw new ProjectDeletionError("project_delete_failed");
    const original = resolveWithin(root, receipt.source_relative_path);
    if (original === path.resolve(root) || path.relative(trash, original).split(path.sep)[0] !== "..") throw new ProjectDeletionError("project_delete_failed");
    const files = resolveWithin(tombstone, "files");
    const project = db.query<{ dir_path: string }, [string]>("SELECT dir_path FROM projects WHERE id=?").get(id);
    if (project === null) await rm(tombstone, { recursive: true, force: true });
    else {
      if (resolveManagedPath(root, project.dir_path) !== original) throw new ProjectDeletionError("project_delete_failed");
      if (existsSync(files)) {
        if (existsSync(original)) throw new ProjectDeletionError("project_delete_failed");
        renameSync(files, original);
      } else if (!existsSync(original)) throw new ProjectDeletionError("project_delete_failed");
      await rm(tombstone, { recursive: true, force: true });
    }
  }
}
