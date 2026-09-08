import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { appRootDir } from "../lib/app-paths";

let sqliteInstance: Database | null = null;

/** Close the owned connection before removing a test profile or shutting down. */
export function closeSqlite(): void {
  sqliteInstance?.close();
  sqliteInstance = null;
}

export function getSqlite(): Database {
  if (sqliteInstance !== null) return sqliteInstance;
  const dbPath = path.join(appRootDir, "burnguard.db");
  mkdirSync(path.dirname(dbPath), { recursive: true });
  sqliteInstance = new Database(dbPath, { create: true });
  sqliteInstance.exec("PRAGMA journal_mode = WAL;");
  sqliteInstance.exec("PRAGMA busy_timeout = 5000;");
  sqliteInstance.exec("PRAGMA foreign_keys = ON;");
  return sqliteInstance;
}
