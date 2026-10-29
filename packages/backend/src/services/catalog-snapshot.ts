import type { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { withSystemContentAccess, type SystemContentLease } from "./system-content-access";

export type CatalogAccessEvents = {
  /** Emitted after entering the real shared scheduler, without granting access. */
  readonly onAccessQueued?: () => void;
  /** Runs while the genuine lease still owns the fully materialized result. */
  readonly onSnapshot?: () => Promise<void>;
};

export async function withCatalogSnapshot<T>(
  db: Database, root: string, id: string,
  read: (lease: SystemContentLease) => Promise<T>, events: CatalogAccessEvents = {},
): Promise<T> {
  await mkdir(root, { recursive: true });
  const pending = withSystemContentAccess(db, root, [id], async lease => {
    const result = await read(lease);
    await events.onSnapshot?.();
    return result;
  });
  events.onAccessQueued?.();
  return pending;
}
