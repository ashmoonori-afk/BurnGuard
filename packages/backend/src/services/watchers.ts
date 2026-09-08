import { watch, type FSWatcher } from "node:fs";
import { getSqlite } from "../db/sqlite-client";
import { getLatestProjectSession, getProjectDetail, listProjectIds } from "../db/project-read-repository";
import { ArtifactCoordinator } from "./artifact-coordinator";
import { waitForArtifactPublication } from "./artifact-publication-registry";
import { appendSessionTrace } from "./trace";
import { isTransientFilePath } from "./files";
import {
  RESERVED_PROJECT_WATCHER,
  projectSessionIds as sessionIdCache,
  projectWatchers as watchers,
} from "./watcher-registry";

const IGNORED_TOP_LEVEL = new Set([".meta", ".attachments", ".burnguard-inputs", ".git", ".omc", ".claude"]);
const pendingSignals = new Map<string, Promise<void>>();
const dirtySignals = new Set<string>();

export function isProjectSignalPending(projectId: string): boolean { return pendingSignals.has(projectId); }

type ErrorAwareWatcher = FSWatcher & {
  on(event: "error", listener: (error: Error) => void): ErrorAwareWatcher;
};

export async function ensureProjectWatcher(projectId: string): Promise<void> {
  if (watchers.has(projectId)) return;
  const project = await getProjectDetail(projectId);
  if (project === null) return;
  watchers.set(projectId, RESERVED_PROJECT_WATCHER);
  let watcher: ErrorAwareWatcher;
  try {
    const coordinator = new ArtifactCoordinator(getSqlite());
    await coordinator.observeExternal(projectId, project.dir_path);
    watcher = watch(project.dir_path, { recursive: true }, (_eventType, filename) => {
      if (filename === null) return;
      const relPath = String(filename).replaceAll("\\", "/");
      if (shouldSkipPath(relPath)) return;
      void scheduleProjectSignal(projectId, project.dir_path);
    }) as ErrorAwareWatcher;
  } catch (error) {
    watchers.delete(projectId);
    throw error;
  }
  watcher.on("error", (error) => { void recordWatcherFailure(projectId, error); });
  watchers.set(projectId, watcher);
}

export async function ensureAllProjectWatchers(projectIds?: readonly string[]): Promise<void> {
  for (const projectId of projectIds ?? await listProjectIds()) {
    try { await ensureProjectWatcher(projectId); }
    catch (error) { console.warn("[watcher] project watcher unavailable", projectId, error); }
  }
}

export function shouldSkipPath(relPath: string): boolean {
  const top = relPath.split("/")[0];
  return top !== undefined && (IGNORED_TOP_LEVEL.has(top) || isTransientFilePath(relPath));
}

export async function processProjectFilesystemSignal(projectId: string, projectDir: string) {
  await waitForArtifactPublication(projectId);
  return new ArtifactCoordinator(getSqlite()).observeExternal(projectId, projectDir);
}

export function scheduleProjectSignal(projectId: string, projectDir: string, processSignal = processProjectFilesystemSignal): Promise<void> {
  dirtySignals.add(projectId);
  const pending = pendingSignals.get(projectId);
  if (pending !== undefined) return pending;
  const task = (async () => {
    do {
      dirtySignals.delete(projectId);
      try { await processSignal(projectId, projectDir); }
      catch (error) { await recordWatcherFailure(projectId, error instanceof Error ? error : new Error("Watcher persistence failed")); }
    } while (dirtySignals.has(projectId));
  })().finally(() => { pendingSignals.delete(projectId); });
  pendingSignals.set(projectId, task);
  return task;
}

async function recordWatcherFailure(projectId: string, error: Error): Promise<void> {
  const sessionId = await resolveSessionId(projectId);
  if (sessionId === null) { console.warn("[watcher] project has no session for failure trace", projectId); return; }
  await appendSessionTrace(sessionId, { level: "watcher_error", project_id: projectId, message: error.message });
}

async function resolveSessionId(projectId: string): Promise<string | null> {
  const cached = sessionIdCache.get(projectId);
  if (cached !== undefined) return cached;
  const session = await getLatestProjectSession(projectId);
  if (session === null) return null;
  sessionIdCache.set(projectId, session.id);
  return session.id;
}
