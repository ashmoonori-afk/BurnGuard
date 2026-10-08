import type { Database } from "bun:sqlite";

type SqlValue = string | number | null | { readonly $base64: string };
type Row = Record<string, SqlValue>;
type ForeignKey = { readonly table: string; readonly parent: string; readonly from: readonly string[]; readonly to: readonly string[]; readonly onDelete: string };

/** Database rows a project deletion removes (ON DELETE CASCADE closure) plus the links it nulls (ON DELETE SET NULL). */
export type ProjectRowSnapshot = {
  readonly schema_version: 1;
  readonly tables: readonly { readonly table: string; readonly rows: readonly Row[] }[];
  readonly relinks: readonly { readonly table: string; readonly key: string; readonly column: string; readonly values: readonly SqlValue[] }[];
};

const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;

function foreignKeys(db: Database): ForeignKey[] {
  const keys: ForeignKey[] = [];
  for (const { name } of db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    const grouped = new Map<number, { table: string; from: string[]; to: string[]; on_delete: string }>();
    for (const fk of db.query<{ id: number; table: string; from: string; to: string; on_delete: string }, []>(`PRAGMA foreign_key_list(${quote(name)})`).all()) {
      const entry = grouped.get(fk.id) ?? { table: fk.table, from: [], to: [], on_delete: fk.on_delete };
      entry.from.push(fk.from); entry.to.push(fk.to); grouped.set(fk.id, entry);
    }
    for (const fk of grouped.values()) keys.push({ table: name, parent: fk.table, from: fk.from, to: fk.to, onDelete: fk.on_delete.toUpperCase() });
  }
  return keys;
}

function encode(row: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Uint8Array) out[key] = { $base64: Buffer.from(value).toString("base64") };
    else if (value === null || typeof value === "string" || typeof value === "number") out[key] = value;
    else throw new TypeError("unsupported column value");
  }
  return out;
}

const decode = (value: SqlValue): string | number | null | Uint8Array =>
  value !== null && typeof value === "object" ? new Uint8Array(Buffer.from(value.$base64, "base64")) : value;

/** Captures, inside the caller's transaction, every row that `DELETE FROM projects WHERE id=?` would remove or unlink. */
export function captureProjectRows(db: Database, projectId: string): ProjectRowSnapshot {
  const keys = foreignKeys(db);
  const rows = new Map<string, Map<string, Row>>([["projects", new Map()]]);
  const project = db.query<Record<string, unknown>, [string]>("SELECT * FROM projects WHERE id=?").get(projectId);
  if (project === null) throw new Error("project row missing");
  rows.get("projects")?.set(projectId, encode(project));
  const order = ["projects"];
  // Breadth-first over cascading foreign keys; a table reached twice keeps one copy of each row.
  for (let index = 0; index < order.length; index += 1) {
    const parent = order[index]!;
    const parentRows = [...(rows.get(parent)?.values() ?? [])];
    for (const fk of keys.filter((key) => key.parent === parent && key.onDelete === "CASCADE" && key.table !== parent)) {
      const values = [...new Set(parentRows.map((row) => row[fk.to[0]!]))];
      if (values.length === 0) continue;
      const found = db.query<Record<string, unknown>, [string]>(`SELECT * FROM ${quote(fk.table)} WHERE ${quote(fk.from[0]!)} IN (SELECT value FROM json_each(?))`).all(JSON.stringify(values)).map(encode)
        .filter((row) => fk.from.length === 1 || parentRows.some((parentRow) => fk.from.every((column, i) => row[column] === parentRow[fk.to[i]!])));
      if (found.length === 0) continue;
      const bucket = rows.get(fk.table) ?? new Map<string, Row>();
      for (const row of found) bucket.set(JSON.stringify(row), row);
      rows.set(fk.table, bucket);
      if (!order.includes(fk.table)) order.push(fk.table);
    }
  }
  const relinks: { table: string; key: string; column: string; values: SqlValue[] }[] = [];
  for (const fk of keys.filter((key) => key.parent === "projects" && key.onDelete === "SET NULL" && key.from.length === 1 && key.to[0] === "id")) {
    const primary = db.query<{ name: string; pk: number }, []>(`PRAGMA table_info(${quote(fk.table)})`).all().filter((column) => column.pk > 0);
    if (primary.length !== 1) continue;
    const key = primary[0]!.name;
    const values = db.query<Record<string, unknown>, [string]>(`SELECT ${quote(key)} AS k FROM ${quote(fk.table)} WHERE ${quote(fk.from[0]!)}=?`).all(projectId).map((row) => encode({ k: row.k }).k!);
    if (values.length > 0) relinks.push({ table: fk.table, key, column: fk.from[0]!, values });
  }
  return { schema_version: 1, tables: order.map((table) => ({ table, rows: [...(rows.get(table)?.values() ?? [])] })), relinks };
}

/** Re-inserts a snapshot inside the caller's transaction; foreign keys are checked once at commit. */
export function restoreProjectRows(db: Database, snapshot: ProjectRowSnapshot): void {
  db.exec("PRAGMA defer_foreign_keys = ON");
  for (const { table, rows } of snapshot.tables) {
    for (const row of rows) {
      const columns = Object.keys(row);
      db.prepare(`INSERT INTO ${quote(table)} (${columns.map(quote).join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map((column) => decode(row[column]!)));
    }
  }
  for (const link of snapshot.relinks) {
    const project = snapshot.tables[0]?.rows[0]?.id ?? null;
    const update = db.prepare(`UPDATE ${quote(link.table)} SET ${quote(link.column)}=? WHERE ${quote(link.key)}=? AND ${quote(link.column)} IS NULL`);
    for (const value of link.values) update.run(decode(project), decode(value));
  }
}

export function parseProjectRowSnapshot(value: unknown, projectId: string): ProjectRowSnapshot | null {
  if (typeof value !== "object" || value === null || !("schema_version" in value) || value.schema_version !== 1 || !("tables" in value) || !Array.isArray(value.tables) || !("relinks" in value) || !Array.isArray(value.relinks)) return null;
  const first: unknown = value.tables[0];
  if (typeof first !== "object" || first === null || !("table" in first) || first.table !== "projects" || !("rows" in first) || !Array.isArray(first.rows) || first.rows.length !== 1) return null;
  const row: unknown = first.rows[0];
  if (typeof row !== "object" || row === null || !("id" in row) || row.id !== projectId) return null;
  return value as ProjectRowSnapshot;
}
