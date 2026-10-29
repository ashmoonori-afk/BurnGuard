import type { Database } from "bun:sqlite";
import { mkdir, open, readdir, rm } from "node:fs/promises";
import { getCatalogRow, getPendingSystemOperation } from "../db/catalog-repository";
import { getSystemContentReceipt } from "../db/design-system-repository";
import { assertSafeName } from "../security/path-boundary";
import { exactRecord, parseContentJournal, parseContentProvenance, SystemContentError } from "./system-content-format";
import { pathStat, readPreservedFile, requireDirectory, safeContentChild } from "./system-content-tree";

const queues = new Map<string, Promise<void>>();
const leases = new WeakMap<SystemContentLease, { readonly root: string; readonly ids: ReadonlySet<string> }>();
export type SystemContentLease = { readonly systemIds: readonly string[] };

/** Shared scheduling and the existing catalog lock namespace; no durable-read bypass here. */
export async function withSystemContentLocks<T>(root: string, ids: readonly string[], run: () => Promise<T>): Promise<T> {
  const sorted = [...new Set(ids.map(assertSafeName))].sort();
  const acquire = async (index: number): Promise<T> => {
    const id = sorted[index];
    if (id === undefined) return run();
    const key = `${root}\0${id}`;
    const previous = queues.get(key) ?? Promise.resolve();
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    queues.set(key, tail);
    await previous;
    let owned = false;
    try {
      const lockRoot = await safeContentChild(root, ".catalog-locks");
      await mkdir(lockRoot, { recursive: true });
      const lock = await safeContentChild(lockRoot, id);
      try { await mkdir(lock); owned = true; }
      catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new SystemContentError("system_content_unavailable");
        throw error;
      }
      const marker = await open(await safeContentChild(lock, "owner.json"), "wx");
      try { await marker.writeFile(JSON.stringify({ version: 1, system_id: id })); await marker.sync(); }
      finally { await marker.close(); }
      return await acquire(index + 1);
    } finally {
      try {
        if (owned) {
          const lock = await safeContentChild(root, ".catalog-locks", id);
          const owner = exactRecord(JSON.parse((await readPreservedFile(lock, "owner.json", undefined, 1024)).toString("utf8")), ["version", "system_id"]);
          if (owner["version"] !== 1 || owner["system_id"] !== id || (await readdir(lock)).length !== 1) throw new SystemContentError("system_content_conflict");
          await rm(lock, { recursive: true });
        }
      } finally {
        release();
        if (queues.get(key) === tail) queues.delete(key);
      }
    }
  };
  return acquire(0);
}
export async function withSystemContentAccess<T>(
  db: Database, root: string, ids: readonly string[], run: (lease: SystemContentLease) => Promise<T>,
  recoveryReceiptId?: string,
): Promise<T> {
  return withSystemContentLocks(root, ids, async () => {
    for (const id of ids) {
      if (recoveryReceiptId !== undefined) {
        const receipt = getSystemContentReceipt(db, recoveryReceiptId);
        if (ids.length !== 1 || receipt?.designSystemId !== id) throw new SystemContentError("system_content_unavailable");
      }
      const pending = getPendingSystemOperation(db, id);
      if (pending !== null && pending.id !== recoveryReceiptId) throw new SystemContentError("system_content_unavailable");
      if (recoveryReceiptId !== undefined && pending !== null && (pending.schemaVersion !== 2 || pending.operation !== "content")) throw new SystemContentError("system_content_unavailable");
      const row = getCatalogRow(db, id);
      if (recoveryReceiptId === undefined && row?.lifecycle === "trashed") throw new SystemContentError("system_content_unavailable");
    }
    const lease: SystemContentLease = { systemIds: [...new Set(ids)].sort() };
    leases.set(lease, { root, ids: new Set(ids) });
    try { return await run(lease); } finally { leases.delete(lease); }
  });
}
export function assertSystemContentLease(lease: SystemContentLease, root: string, id: string): void {
  const owned = leases.get(lease);
  if (owned?.root !== root || !owned.ids.has(id)) throw new SystemContentError("system_content_unavailable");
}
/** Startup only, after exclusive profile ownership and before any access. Unknown legacy locks stay held. */
export async function reconcileSystemContentLocks(db: Database, root: string): Promise<{ readonly cleared: number; readonly held: readonly string[] }> {
  const lockRoot = await safeContentChild(root, ".catalog-locks");
  if (await pathStat(lockRoot) === null) return { cleared: 0, held: [] };
  await requireDirectory(lockRoot);
  const held: string[] = [];
  let cleared = 0;
  for (const id of await readdir(lockRoot)) {
    try {
      assertSafeName(id);
      const lock = await safeContentChild(lockRoot, id);
      const owner = exactRecord(JSON.parse((await readPreservedFile(lock, "owner.json", undefined, 1024)).toString("utf8")), ["version", "system_id"]);
      const pending = getPendingSystemOperation(db, id);
      if (owner["version"] !== 1 || owner["system_id"] !== id || (await readdir(lock)).length !== 1) throw new SystemContentError("system_content_conflict");
      // Classify durable ownership before clearing a process-crash lock. Recovery still proves all storage.
      if (pending !== null) {
        if (pending.operation !== "content" || pending.schemaVersion !== 2) throw new SystemContentError("system_content_unavailable");
        const journal = parseContentJournal(JSON.parse(pending.metadataJson));
        parseContentProvenance(JSON.parse(pending.provenanceJson));
        if (journal.system_id !== id || pending.id !== `system-content-${journal.operation_id}`) throw new SystemContentError("system_content_conflict");
      }
      await rm(lock, { recursive: true });
      cleared += 1;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      held.push(id);
    }
  }
  return { cleared, held };
}
