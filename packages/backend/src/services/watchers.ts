import { watch, type FSWatcher } from "node:fs";
import { getSqlite } from "../db/sqlite-client";
import { getLatestProjectSession, getProjectDetail, listProjectIds } from "../db/project-read-repository";
import { ArtifactCoordinator, ArtifactOperationError } from "./artifact-coordinator";
import { waitForArtifactPublication } from "./artifact-publication-registry";
import { appendSessionTrace } from "./trace";
import { isTransientFilePath } from "./files";
import { isProjectDocumentPath } from "./project-document-paths";
import { isAgentControlPath } from "../security/agent-control-files";
import {
  RESERVED_PROJECT_WATCHER,
  closeProjectWatcher,
  projectSessionIds as sessionIdCache,
  projectWatchers as watchers,
  setProjectReadiness,
  setProjectReadinessRegistration,
} from "./watcher-registry";

const IGNORED_TOP_LEVEL = new Set([".meta", ".attachments", ".burnguard-inputs", ".git", ".omc", ".claude", ".codex"]);
const pendingSignals = new Map<string, Promise<void>>();
const dirtySignals = new Set<string>();
const STARTUP_WATCHER_CONCURRENCY = 3;

type ObserveProject = (projectId: string, projectDir: string) => Promise<unknown>;
const observeProject: ObserveProject = (projectId, projectDir) => new ArtifactCoordinator(getSqlite()).observeExternal(projectId, projectDir);

export function isProjectSignalPending(projectId: string): boolean { return pendingSignals.has(projectId); }

type ErrorAwareWatcher = FSWatcher & {
  on(event: "error", listener: (error: Error) => void): ErrorAwareWatcher;
};

export async function ensureProjectWatcher(projectId: string, observe: ObserveProject = observeProject): Promise<void> {
  if (watchers.has(projectId)) return;
  const project = await getProjectDetail(projectId);
  if (project === null) return;
  watchers.set(projectId, RESERVED_PROJECT_WATCHER);
  let watcher: ErrorAwareWatcher;
  try {
    await observe(projectId, project.dir_path);
    // Deletion or shutdown released the reservation while the project was being observed.
    if (watchers.get(projectId) !== RESERVED_PROJECT_WATCHER) return;
    watcher = watch(project.dir_path, { recursive: true }, (_eventType, filename) => {
      if (filename === null) return;
      const relPath = String(filename).replaceAll("\\", "/");
      if (shouldSkipPath(relPath)) return;
      void scheduleProjectSignal(projectId, project.dir_path);
    }) as ErrorAwareWatcher;
  } catch (error) {
    if (watchers.get(projectId) === RESERVED_PROJECT_WATCHER) watchers.delete(projectId);
    throw error;
  }
  watcher.on("error", (error) => { void recordWatcherFailure(projectId, error); });
  watchers.set(projectId, watcher);
}

export async function ensureAllProjectWatchers(projectIds?: readonly string[]): Promise<void> {
  await startProjectWatchers({ projectIds }).settled;
}

export type ProjectWatcherStartup = {
  /** Every project was observed (or reported unavailable), or startup was stopped. */
  readonly settled: Promise<void>;
  /** Stop starting queued projects, let in-flight observations finish, then close every watcher. */
  stop(): Promise<void>;
};

type QueuedProject = { readonly projectId: string; readonly resolve: () => void; readonly reject: (error: unknown) => void };

/**
 * Observe persisted projects and attach their watchers in the background, a few projects at a time.
 * Each project's artifact mutations wait for its own first observation (`waitForProjectReady`).
 */
export function startProjectWatchers(options: { readonly projectIds?: readonly string[]; readonly concurrency?: number; readonly observe?: ObserveProject } = {}): ProjectWatcherStartup {
  const observe = options.observe ?? observeProject;
  const queue: QueuedProject[] = [];
  let stopped = false;
  const registration = (async () => {
    let projectIds: readonly string[] = [];
    try { projectIds = options.projectIds ?? await listProjectIds(); }
    catch { console.warn("[watcher] project list unavailable at startup"); }
    if (stopped) return;
    for (const projectId of projectIds) {
      const ready = Promise.withResolvers<void>();
      setProjectReadiness(projectId, ready.promise);
      queue.push({ projectId, resolve: ready.resolve, reject: ready.reject });
    }
  })();
  setProjectReadinessRegistration(registration);
  const worker = async (): Promise<void> => {
    while (!stopped) {
      const next = queue.shift();
      if (next === undefined) return;
      try { await ensureProjectWatcher(next.projectId, observe); next.resolve(); }
      catch (error) {
        console.warn("[watcher] project watcher unavailable", next.projectId, error instanceof ArtifactOperationError ? error.code : "observation_failed");
        next.reject(error);
      }
    }
  };
  const settled = registration.then(async () => {
    await Promise.all(Array.from({ length: Math.min(options.concurrency ?? STARTUP_WATCHER_CONCURRENCY, queue.length) }, worker));
  });
  return {
    settled,
    async stop() {
      stopped = true;
      for (const queued of queue.splice(0)) queued.reject(new ArtifactOperationError("recovery_unavailable", "The app is shutting down"));
      await settled;
      for (const projectId of [...watchers.keys()]) closeProjectWatcher(projectId);
    },
  };
}

export function shouldSkipPath(relPath: string): boolean {
  const top = relPath.split("/")[0];
  return top !== undefined && (IGNORED_TOP_LEVEL.has(top) || isTransientFilePath(relPath) || isProjectDocumentPath(relPath) || isAgentControlPath(relPath));
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
