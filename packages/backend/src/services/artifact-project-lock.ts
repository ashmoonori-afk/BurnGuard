import type { Database } from "bun:sqlite";

const queues = new WeakMap<Database, Map<string, Promise<void>>>();
export function isArtifactProjectBusy(db: Database, projectId: string): boolean { return queues.get(db)?.has(projectId) ?? false; }

/** Serialize local observation/publication IO; SQLite receipts still own identity. */
export async function acquireArtifactProjectLock(db: Database, projectId: string): Promise<() => void> {
  let projects = queues.get(db);
  if (projects === undefined) { projects = new Map(); queues.set(db, projects); }
  const previous = projects.get(projectId) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => { release = resolve; });
  projects.set(projectId, current);
  await previous;
  return () => {
    release();
    if (projects.get(projectId) === current) projects.delete(projectId);
  };
}
