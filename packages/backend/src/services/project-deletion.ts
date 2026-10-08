import type { Database } from "bun:sqlite";
import type { RecentlyDeletedProject } from "@bg/shared";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { ulid } from "ulid";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { assertSafeName, PathBoundaryError, resolveWithin } from "../security/path-boundary";
import { closeProjectWatcher, projectWatchers } from "./watcher-registry";
import { ensureProjectWatcher, isProjectSignalPending } from "./watchers";
import { isSessionHeldForRecovery, isUserTurnRunning } from "./turns";
import { isDirectionOperationActive } from "./direction-operation-registry";
import { isVisualAlternativeOperationActive } from "./visual-alternative-operation-registry";
import { isArtifactProjectBusy } from "./artifact-project-lock";
import { captureProjectRows, parseProjectRowSnapshot, restoreProjectRows } from "./project-row-snapshot";

export class ProjectDeletionError extends Error {
  constructor(readonly code: "project_not_found" | "project_in_use" | "project_delete_failed" | "project_restore_unavailable" | "project_restore_conflict" | "project_restore_failed") { super(code); }
}

/** A deleted project stays restorable for 30 days, the same window as artifact operation retention. */
export const PROJECT_DELETION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

type DeletionPlan = { readonly id: string; readonly tombstone: string; readonly original: string; readonly files: string; readonly name: string | null; readonly deletedAt: number | null };

export async function deleteProject(db: Database, projectId: string, options: { readonly projectsRoot?: string; readonly beforeDatabaseDelete?: () => void } = {}): Promise<void> {
  const root = options.projectsRoot ?? projectsDir;
  let original: string | null = null;
  let tombstone: string | null = null;
  let moved = false;
  let ownsTombstone = false;
  const wasWatched = projectWatchers.has(projectId);
  try {
    db.transaction(() => {
      const project = db.query<{ dir_path: string; name: string }, [string]>("SELECT dir_path,name FROM projects WHERE id=?").get(projectId);
      if (project === null) throw new ProjectDeletionError("project_not_found");
      const sessions = db.query<{ id: string; status: string }, [string]>("SELECT id,status FROM sessions WHERE project_id=?").all(projectId);
      const referenced = db.query("SELECT 1 FROM learning_checkpoints WHERE project_id=? LIMIT 1").get(projectId);
      const operation = db.query("SELECT 1 FROM artifact_operations WHERE project_id=? AND status IN ('pending','working','recovering') LIMIT 1").get(projectId);
      const exporting = db.query("SELECT 1 FROM exports e JOIN export_attempts a ON a.job_id=e.id WHERE e.project_id=? AND a.status IN ('pending','running','validating','retrying','recovering') LIMIT 1").get(projectId);
      const alternatives = db.query("SELECT 1 FROM visual_alternative_generations WHERE project_id=? AND status='generating' LIMIT 1").get(projectId);
      if (referenced || operation || exporting || alternatives || isArtifactProjectBusy(db, projectId) || isProjectSignalPending(projectId) || sessions.some((s) => s.status === "running" || s.status === "awaiting_tool" || isUserTurnRunning(s.id) || isSessionHeldForRecovery(s.id) || isDirectionOperationActive(s.id) || isVisualAlternativeOperationActive(s.id))) throw new ProjectDeletionError("project_in_use");
      try { original = resolveManagedPath(root, project.dir_path); }
      catch (error) {
        // A legacy row outside managed storage may be removed, never its files.
        if (!(error instanceof PathBoundaryError) || error.code !== "outside_root") throw error;
      }
      if (original !== null && existsSync(original)) {
        const trash = resolveWithin(root, ".deletions");
        mkdirSync(trash, { recursive: true });
        tombstone = resolveWithin(trash, assertSafeName(projectId));
        // A tombstone left by startup quarantine belongs to unverified bytes: set it aside, never delete it.
        if (existsSync(tombstone)) renameSync(tombstone, resolveWithin(trash, `${projectId}.quarantined-${ulid()}`));
        mkdirSync(tombstone);
        ownsTombstone = true;
        writeFileSync(path.join(tombstone, "receipt.json"), JSON.stringify({ schema_version: 2, project_id: projectId, source_relative_path: path.relative(root, original).split(path.sep).join("/"), name: project.name, deleted_at: Date.now() }), { encoding: "utf8", flag: "wx" });
        closeProjectWatcher(projectId);
        renameSync(original, path.join(tombstone, "files"));
        moved = true;
        // The rows the cascade is about to remove; restore re-inserts them. Written atomically so a restorable tombstone always has a whole copy.
        writeFileSync(path.join(tombstone, "rows.json.tmp"), JSON.stringify(captureProjectRows(db, projectId)), { encoding: "utf8", flag: "wx" });
        renameSync(path.join(tombstone, "rows.json.tmp"), path.join(tombstone, "rows.json"));
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
  // The tombstone is kept as "recently deleted" until purgeExpiredProjectDeletions collects it.
  closeProjectWatcher(projectId);
}

/** Lists restorable deletions only: never quarantined, unreadable, legacy (no row snapshot) or expired tombstones, and never paths. */
export async function listRecentlyDeletedProjects(db: Database, options: { readonly projectsRoot?: string; readonly now?: number } = {}): Promise<RecentlyDeletedProject[]> {
  const root = options.projectsRoot ?? projectsDir;
  const now = options.now ?? Date.now();
  const listed: RecentlyDeletedProject[] = [];
  for (const plan of await readDeletionPlans(root)) {
    if (!isRestorable(db, plan, now)) continue;
    listed.push({ id: plan.id, name: plan.name ?? "", deleted_at: plan.deletedAt ?? 0 });
  }
  return listed.sort((a, b) => b.deleted_at - a.deleted_at);
}

/** Re-inserts the deleted rows, then moves the files back through the same path startup reconciliation uses. */
export async function restoreDeletedProject(db: Database, projectId: string, options: { readonly projectsRoot?: string; readonly now?: number } = {}): Promise<void> {
  const root = options.projectsRoot ?? projectsDir;
  let plan: DeletionPlan | null = null;
  try {
    const trash = resolveWithin(root, ".deletions");
    if (existsSync(trash) && !projectId.includes(".quarantined-")) plan = readDeletionPlan(root, trash, projectId);
  } catch { plan = null; }
  const now = options.now ?? Date.now();
  if (plan === null || plan.deletedAt === null || plan.deletedAt + PROJECT_DELETION_RETENTION_MS <= now || !existsSync(plan.files)) throw new ProjectDeletionError("project_restore_unavailable");
  let snapshot;
  try { snapshot = parseProjectRowSnapshot(JSON.parse(readFileSync(resolveWithin(plan.tombstone, "rows.json"), "utf8")), plan.id); }
  catch { snapshot = null; }
  const dirPath = snapshot?.tables[0]?.rows[0]?.dir_path;
  if (snapshot === null || typeof dirPath !== "string") throw new ProjectDeletionError("project_restore_unavailable");
  let expected: string | null = null;
  try { expected = resolveManagedPath(root, dirPath); } catch { /* handled below */ }
  if (expected !== plan.original) throw new ProjectDeletionError("project_restore_unavailable");
  // Never overwrite: a project with this id or folder, or any bytes at the original path, refuse the restore.
  if (db.query("SELECT 1 FROM projects WHERE id=? OR dir_path=? LIMIT 1").get(plan.id, dirPath) !== null || existsSync(plan.original)) throw new ProjectDeletionError("project_restore_conflict");
  try { db.transaction(() => restoreProjectRows(db, snapshot))(); }
  catch { throw new ProjectDeletionError("project_restore_failed"); }
  try { await restoreTombstone(plan); }
  catch {
    // The files did not move; drop the re-inserted rows so the tombstone stays the only copy.
    db.prepare("DELETE FROM projects WHERE id=?").run(plan.id);
    throw new ProjectDeletionError("project_restore_failed");
  }
  await ensureProjectWatcher(plan.id);
}

/** Removes committed deletions older than the retention window; quarantined and unreadable tombstones are never touched. */
export async function purgeExpiredProjectDeletions(db: Database, options: { readonly projectsRoot?: string; readonly now?: number } = {}): Promise<number> {
  const root = options.projectsRoot ?? projectsDir;
  const now = options.now ?? Date.now();
  let purged = 0;
  for (const plan of await readDeletionPlans(root)) {
    if (plan.deletedAt === null || plan.deletedAt + PROJECT_DELETION_RETENTION_MS > now || db.query("SELECT 1 FROM projects WHERE id=?").get(plan.id) !== null) continue;
    try { await rm(plan.tombstone, { recursive: true, force: true }); purged += 1; }
    catch { console.warn("[project] deferred deleted project cleanup", plan.id); }
  }
  return purged;
}

let purgeTimer: ReturnType<typeof setInterval> | null = null;

export function startProjectDeletionPurgeScheduler(db: Database): void {
  if (purgeTimer !== null) return;
  purgeTimer = setInterval(() => { void purgeExpiredProjectDeletions(db).catch(() => { console.warn("[project] deleted project purge failed"); }); }, PURGE_INTERVAL_MS);
  purgeTimer.unref();
}

function isRestorable(db: Database, plan: DeletionPlan, now: number): boolean {
  return plan.deletedAt !== null && plan.name !== null && plan.deletedAt + PROJECT_DELETION_RETENTION_MS > now && existsSync(plan.files)
    && existsSync(path.join(plan.tombstone, "rows.json")) && db.query("SELECT 1 FROM projects WHERE id=?").get(plan.id) === null;
}

async function readDeletionPlans(root: string): Promise<DeletionPlan[]> {
  const trash = resolveWithin(root, ".deletions");
  if (!existsSync(trash)) return [];
  const plans: DeletionPlan[] = [];
  for (const entry of await readdir(trash, { withFileTypes: true })) {
    // Quarantined tombstones (startup or deletion set them aside) belong to unverified bytes: never listed, never purged.
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.includes(".quarantined-")) continue;
    const plan = readDeletionPlan(root, trash, entry.name);
    if (plan !== null) plans.push(plan);
  }
  return plans;
}

/** Moves a tombstone's files back to their original folder; false when there is nothing recoverable to move. */
async function restoreTombstone(plan: DeletionPlan): Promise<boolean> {
  if (existsSync(plan.files)) {
    if (existsSync(plan.original)) throw new ProjectDeletionError("project_delete_failed");
    renameSync(plan.files, plan.original);
  } else if (!existsSync(plan.original)) return false;
  // A leftover tombstone whose files are back is collected by the next startup reconciliation.
  try { await rm(plan.tombstone, { recursive: true, force: true }); }
  catch { console.warn("[project] deferred restored project cleanup", plan.id); }
  return true;
}

/** Crash between rename and DB commit: row exists => restore; absent => keep as recently deleted (legacy receipts are collected). */
export async function reconcileProjectDeletions(db: Database, root = projectsDir): Promise<void> {
  const trash = resolveWithin(root, ".deletions");
  if (!existsSync(trash)) return;
  for (const entry of await readdir(trash, { withFileTypes: true })) {
    // Stray files (.DS_Store) and unrecognized tombstones are left untouched; one must never lock out every project.
    if (!entry.isDirectory() || entry.isSymbolicLink()) { console.warn("[project] skipped unexpected deletion entry"); continue; }
    const plan = readDeletionPlan(root, trash, entry.name);
    if (plan === null) { console.warn("[project] quarantined unreadable deletion receipt"); continue; }
    const { id, tombstone, original } = plan;
    const project = db.query<{ dir_path: string }, [string]>("SELECT dir_path FROM projects WHERE id=?").get(id);
    if (project === null) {
      // A committed deletion stays restorable until purgeExpiredProjectDeletions; a legacy receipt has no row snapshot to restore from.
      if (plan.deletedAt === null) await rm(tombstone, { recursive: true, force: true });
    } else {
      let expected: string | null = null;
      try { expected = resolveManagedPath(root, project.dir_path); } catch { /* handled below */ }
      if (expected !== original) { console.warn("[project] quarantined deletion receipt that does not match its project", id); continue; }
      if (!await restoreTombstone(plan)) { console.warn("[project] quarantined deletion receipt without recoverable files", id); continue; }
    }
  }
}

/** Returns null when the tombstone or its receipt is unreadable or malformed; the tombstone is then left in place. */
function readDeletionPlan(root: string, trash: string, name: string): DeletionPlan | null {
  try {
    const id = assertSafeName(name);
    const tombstone = resolveWithin(trash, id);
    const receipt: unknown = JSON.parse(readFileSync(resolveWithin(tombstone, "receipt.json"), "utf8"));
    if (typeof receipt !== "object" || receipt === null || Array.isArray(receipt)) return null;
    const keys = Object.keys(receipt).sort().join(",");
    // Version 1 (before retention) carries no name or deletion time; version 2 adds both.
    const legacy = keys === "project_id,schema_version,source_relative_path" && "schema_version" in receipt && receipt.schema_version === 1;
    const retained = keys === "deleted_at,name,project_id,schema_version,source_relative_path" && "schema_version" in receipt && receipt.schema_version === 2
      && "deleted_at" in receipt && typeof receipt.deleted_at === "number" && Number.isFinite(receipt.deleted_at) && "name" in receipt && typeof receipt.name === "string";
    if ((!legacy && !retained) || !("project_id" in receipt) || receipt.project_id !== id
      || !("source_relative_path" in receipt) || typeof receipt.source_relative_path !== "string" || receipt.source_relative_path.length === 0) return null;
    const original = resolveWithin(root, receipt.source_relative_path);
    if (original === path.resolve(root) || path.relative(trash, original).split(path.sep)[0] !== "..") return null;
    return { id, tombstone, original, files: resolveWithin(tombstone, "files"), name: retained && "name" in receipt && typeof receipt.name === "string" ? receipt.name : null, deletedAt: retained && "deleted_at" in receipt && typeof receipt.deleted_at === "number" ? receipt.deleted_at : null };
  } catch { return null; }
}
