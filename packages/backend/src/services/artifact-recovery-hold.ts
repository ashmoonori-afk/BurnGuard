import type { Database } from "bun:sqlite";

// Projects whose startup recovery failed keep their exact bytes and receipts for the whole process.
const held = new WeakMap<Database, ReadonlySet<string>>();

export function setArtifactRecoveryHold(db: Database, projectIds: Iterable<string>): void {
  held.set(db, new Set(projectIds));
}

export function isArtifactRecoveryHeld(db: Database, projectId: string): boolean {
  return held.get(db)?.has(projectId) === true;
}
