import { watch, type FSWatcher } from "node:fs";
import { getSqlite } from "../db/sqlite-client";
import { getLatestProjectSession, getProjectDetail, listProjectIds } from "../db/project-read-repository";
import { ArtifactCoordinator, ArtifactOperationError } from "./artifact-coordinator";
import { waitForArtifactPublication } from "./artifact-publication-registry";
import { isArtifactRecoveryHeld } from "./artifact-recovery-hold";
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

export type ProjectWatcherStartup = {
  /** Every project was observed (or reported unavailable), or startup was stopped. */
  readonly settled: Promise<void>;
  /** Synchronously stop dequeuing and reject queued projects' waiters; in-flight observations keep running. */
  halt(): void;
  /** `halt()`, then wait for in-flight observations to finish and close every watcher. */
  stop(): Promise<void>;
};

/**
 * Shutdown order: halt startup, run `interruptWork` (turns, export browsers) without waiting behind in-flight
 * startup hashing, then wait for that hashing and close every watcher.
 */
export async function shutdownProjectWatchers(startup: ProjectWatcherStartup | null, interruptWork: () => Promise<void>): Promise<void> {
  startup?.halt();
  await interruptWork();
  await startup?.stop();
}

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
      // Startup recovery failed for this project: it stays untouched (no observation, no watcher) until the next
      // restart, and its mutations refuse with recovery_unavailable before waiting on readiness.
      if (isArtifactRecoveryHeld(getSqlite(), projectId)) continue;
      const ready = Promise.withResolvers<void>();
      setProjectReadiness(projectId, ready.promise);
      queue.push({ projectId, resolve: ready.resolve, reject: ready.reject });
    }
  })();
  // A mutation that waits on a still-queued project moves it to the front of the queue.
  setProjectReadinessRegistration(registration, (projectId) => {
    const index = queue.findIndex((queued) => queued.projectId === projectId);
    if (index > 0) queue.unshift(...queue.splice(index, 1));
  });
  const worker = async (): Promise<void> => {
    while (!stopped) {
      const next = queue.shift();
      if (next === undefined) return;
      try { await ensureProjectWatcher(next.projectId, observe); next.resolve(); }
      catch (error) {
        console.warn("[watcher] project watcher unavailable", next.projectId, error instanceof ArtifactOperationError ? error.code : errorCode(error));
        next.reject(error);
      }
    }
  };
  const settled = registration.then(async () => {
    await Promise.all(Array.from({ length: Math.min(Math.max(1, options.concurrency ?? STARTUP_WATCHER_CONCURRENCY), queue.length) }, worker));
  });
  const halt = (): void => {
    stopped = true;
    for (const queued of queue.splice(0)) queued.reject(new ArtifactOperationError("recovery_unavailable", "The app is shutting down"));
  };
  return {
    settled,
    halt,
    async stop() {
      halt();
      await settled;
      for (const projectId of [...watchers.keys()]) closeProjectWatcher(projectId);
    },
  };
}

function errorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "unknown";
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
