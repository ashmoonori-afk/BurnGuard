import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

export const SCHEMA_NEWER_THAN_APP = "schema_newer_than_app";
export const MIGRATION_FOREIGN_KEY_VIOLATION = "migration_foreign_key_violation";
const BACKUPS_KEPT = 3;

export class MigrationError extends Error {
  constructor(readonly code: typeof SCHEMA_NEWER_THAN_APP | typeof MIGRATION_FOREIGN_KEY_VIOLATION) {
    super(code);
    this.name = "MigrationError";
  }
}

export interface MigrationBackupOptions {
  /** Directory that receives `<timestamp>-<appVersion>.sqlite` snapshots taken before pending migrations run. */
  readonly directory: string;
  readonly appVersion: string;
}

async function snapshotBeforeMigrating(db: Database, backup: MigrationBackupOptions): Promise<void> {
  await mkdir(backup.directory, { recursive: true });
  // Millisecond stamps sort lexically; bump on collision so names stay unique and ordered.
  let at = Date.now();
  const nameAt = (ms: number) => `${new Date(ms).toISOString().replace(/[:.]/g, "-")}-${backup.appVersion}.sqlite`;
  while (existsSync(path.join(backup.directory, nameAt(at)))) at += 1;
  const target = path.join(backup.directory, nameAt(at));
  db.query("VACUUM INTO ?").run(target);
  const snapshots = (await readdir(backup.directory)).filter((name) => name.endsWith(".sqlite")).sort();
  for (const stale of snapshots.slice(0, Math.max(0, snapshots.length - BACKUPS_KEPT))) {
    await rm(path.join(backup.directory, stale), { force: true });
  }
}

export async function runMigrationsFrom(
  db: Database,
  migrationsDir: string,
  backup?: MigrationBackupOptions,
): Promise<void> {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);",
  );

  const rows = db
    .query<{ readonly id: string }, []>("SELECT id FROM schema_migrations")
    .all();
  const applied = new Set(rows.map((row) => row.id));
  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  // An older binary opened over a newer profile must not write against a
  // schema it does not know.
  const known = new Set(files);
  if ([...applied].some((id) => !known.has(id))) throw new MigrationError(SCHEMA_NEWER_THAN_APP);

  const pending = files.filter((file) => !applied.has(file));
  if (pending.length === 0) return;

  if (backup !== undefined) await snapshotBeforeMigrating(db, backup);

  // Some migrations rebuild a table to swap a CHECK constraint — that
  // involves DROP+RENAME on a parent the projects FK points at, which
  // trips under foreign_keys=ON. PRAGMA is a no-op inside a transaction,
  // so it has to toggle at the outer loop. Re-enabled in `finally` so a
  // failing migration still leaves the connection in the normal state.
  db.exec("PRAGMA foreign_keys = OFF;");
  try {
    for (const file of pending) {
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      const txn = db.transaction(() => {
        db.exec(sql);
        // With foreign keys off nothing else notices orphans a rebuild leaves behind.
        if (db.query("PRAGMA foreign_key_check").all().length > 0) {
          throw new MigrationError(MIGRATION_FOREIGN_KEY_VIOLATION);
        }
        db
          .prepare(
            "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
          )
          .run(file, Date.now());
      });
      txn();
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }
}
