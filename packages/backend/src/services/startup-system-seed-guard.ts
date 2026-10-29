import type { Database } from "bun:sqlite";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { getSqlite } from "../db/sqlite-client";
import { systemsDir } from "../lib/paths";
import { assertSafeName } from "../security/path-boundary";

async function occupied(target: string): Promise<boolean> {
  try { await lstat(target); return true; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

/** Startup only: neither absent live bytes nor a failed attempt grants seeding authority. */
export async function preserveSystemFromSeed(
  id: string, root = systemsDir, db: Database = getSqlite(),
): Promise<boolean> {
  assertSafeName(id);
  if (db.query("SELECT 1 FROM design_system_receipts WHERE design_system_id=? LIMIT 1").get(id) !== null) return true;
  const row = db.query<{ readonly lifecycle: string; readonly revision: number }, [string]>(
    "SELECT lifecycle,metadata_revision revision FROM design_systems WHERE id=?",
  ).get(id);
  if (row !== null && (row.lifecycle !== "active" || row.revision > 0)) return true;
  return await occupied(path.join(root, ".catalog-locks", id)) ||
    await occupied(path.join(root, id, ".meta", "bundle-import-owner.json"));
}

/** A missing-only installer must also preserve an occupied file/link or an unregistered user tree. */
export async function canCreateSeedSystem(id: string, root = systemsDir, db: Database = getSqlite()): Promise<boolean> {
  return !(await preserveSystemFromSeed(id, root, db)) && !(await occupied(path.join(root, id)));
}
