import { watch, type FSWatcher } from "node:fs";
import { getSqlite } from "../db/sqlite-client";
import { getLatestProjectSession, getProjectDetail, listProjectIds } from "../db/project-read-repository";
import { ArtifactCoordinator } from "./artifact-coordinator";
import { waitForArtifactPublication } from "./artifact-publication-registry";
import { appendSessionTrace } from "./trace";
import { isTransientFilePath } from "./files";
import { isProjectDocumentPath } from "./project-document-paths";
import { isAgentControlPath } from "../security/agent-control-files";
import {
  RESERVED_PROJECT_WATCHER,
  projectSessionIds as sessionIdCache,
  projectWatchers as watchers,
} from "./watcher-registry";

const IGNORED_TOP_LEVEL = new Set([".meta", ".attachments", ".burnguard-inputs", ".git", ".omc", ".claude", ".codex"]);
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
  return top !== undefined && (IGNORED_TOP_LEVEL.has(top) || isTransientFilePath(relPath) || isProjectDocumentPath(relPath) || isAgentControlPath(relPath));
}

export async function processProjectFilesystemSignal(projectId: string, projectDir: string) {
  await waitForArtifactPublication(projectId);
  return new ArtifactCoordinator(getSqlite()).observeExternal(projectId, projectDir);
}

export interface SignalScheduler {
  readonly now: () => number;
  readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

export const SIGNAL_QUIET_MS = 300;
export const SIGNAL_MAX_WAIT_MS = 2000;

const realScheduler: SignalScheduler = {
  now: () => Date.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
const debouncedSignals = new Map<string, () => void>();

/**
 * Debounces a burst of filesystem events: the scan starts after SIGNAL_QUIET_MS without a new event,
 * or SIGNAL_MAX_WAIT_MS after the first one. Events during a running scan still queue exactly one more pass.
 */
export function scheduleProjectSignal(projectId: string, projectDir: string, processSignal = processProjectFilesystemSignal, scheduler: SignalScheduler = realScheduler): Promise<void> {
  dirtySignals.add(projectId);
  const pending = pendingSignals.get(projectId);
  if (pending !== undefined) { debouncedSignals.get(projectId)?.(); return pending; }
  const task = new Promise<void>((resolve) => {
    const firstAt = scheduler.now();
    let timer: unknown;
    const arm = () => {
      if (timer !== undefined) scheduler.clearTimer(timer);
      const remaining = SIGNAL_MAX_WAIT_MS - (scheduler.now() - firstAt);
      timer = scheduler.setTimer(start, Math.max(0, Math.min(SIGNAL_QUIET_MS, remaining)));
    };
    const start = () => { debouncedSignals.delete(projectId); resolve(runSignalLoop(projectId, projectDir, processSignal)); };
    debouncedSignals.set(projectId, arm);
    arm();
  }).finally(() => { pendingSignals.delete(projectId); });
  pendingSignals.set(projectId, task);
  return task;
}

async function runSignalLoop(projectId: string, projectDir: string, processSignal: typeof processProjectFilesystemSignal): Promise<void> {
  do {
    dirtySignals.delete(projectId);
    try { await processSignal(projectId, projectDir); }
    catch (error) { await recordWatcherFailure(projectId, error instanceof Error ? error : new Error("Watcher persistence failed")); }
  } while (dirtySignals.has(projectId));
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
