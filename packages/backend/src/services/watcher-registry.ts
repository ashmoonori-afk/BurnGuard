import type { FSWatcher } from "node:fs";

export const RESERVED_PROJECT_WATCHER = Symbol("bg-reserved-watcher");
export const projectWatchers = new Map<string, FSWatcher | typeof RESERVED_PROJECT_WATCHER>();
export const projectSessionIds = new Map<string, string>();
export function closeProjectWatcher(projectId: string): void {
  const watcher = projectWatchers.get(projectId);
  if (watcher && watcher !== RESERVED_PROJECT_WATCHER) {
    try { watcher.close(); }
    catch (error) {
      if (!(error instanceof Error)) throw error;
    }
  }
  projectWatchers.delete(projectId);
  projectSessionIds.delete(projectId);
}

// Startup observation runs after the listener; artifact mutations wait for their project's first observation.
const projectReadiness = new Map<string, Promise<void>>();
let readinessRegistration: Promise<void> | null = null;

export function setProjectReadinessRegistration(registration: Promise<void>): void {
  readinessRegistration = registration;
}

/** A failed observation rejects only the waiters it already had; the entry is then cleared so the project never wedges. */
export function setProjectReadiness(projectId: string, ready: Promise<void>): void {
  projectReadiness.set(projectId, ready);
  void ready.catch(() => undefined).finally(() => { if (projectReadiness.get(projectId) === ready) projectReadiness.delete(projectId); });
}

export async function waitForProjectReady(projectId: string): Promise<void> {
  if (readinessRegistration !== null) await readinessRegistration;
  await projectReadiness.get(projectId);
}
