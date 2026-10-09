#!/usr/bin/env bun
/**
 * Migration-order guard. Applied SQLite migrations are append-only: a migration that was applied once must never be
 * rewritten or deleted, and a new one must sort after every migration the merge base already had. A branch that fills
 * an earlier gap (`0019`) or reuses the highest number with a lexically later name (`0021_zzz` after
 * `0021_visual_alternatives`) breaks replay for anyone whose database already stopped at the highest applied number.
 *
 *   bun scripts/qa/check-migration-order.ts [--base-ref <git ref>]   check; with a base ref the migrations at the
 *                                                                    merge base of HEAD and that ref are the baseline
 *
 * A branch uses the merge base, not the ref's tip. If the ref points to HEAD, main-push CI uses the first parent
 * when available. Without a base ref only the name shape is checked.
 */
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

export const MIGRATIONS_DIR = "packages/backend/src/db/migrations";
const SQL_FILE = /\.sql$/;
const NAMED_MIGRATION = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export type MigrationOrderProblemCode = "malformed_name" | "duplicate_number" | "new_not_after_base" | "existing_rewritten" | "existing_deleted";
export type MigrationOrderProblem = { readonly code: MigrationOrderProblemCode; readonly path: string; readonly source: string };
export type GitRunner = (args: readonly string[]) => { readonly exitCode: number; readonly stdout: string };
/** Inventory content is a Git-normalized blob identity, not checkout newline bytes. */
export interface MigrationFile { readonly path: string; readonly name: string; readonly content: string }
export interface MigrationOrderInput { readonly head: readonly MigrationFile[]; readonly base: readonly MigrationFile[] | null }

/** One spelling per file: forward slashes, no quotes, no leading "./", so a Windows-style entry names the same file. */
export function normalizeMigrationPath(spelling: string): string {
  return spelling.trim().replace(/^["']+|["']+$/g, "").replaceAll("\\", "/").replace(/\/{2,}/g, "/").replace(/^(?:\.\/)+/, "");
}

/** The file name of a repository path, spelled with POSIX separators. */
export function migrationNameOf(repoPath: string): string {
  const normalized = normalizeMigrationPath(repoPath);
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? normalized : normalized.slice(slash + 1);
}

/** The numeric prefix of an `NNNN_name.sql` migration, or null when the name has any other shape. */
export function parseMigrationName(name: string): { readonly number: number; readonly prefix: string } | null {
  const match = NAMED_MIGRATION.exec(name);
  if (match === null) return null;
  return { number: Number(match[1]), prefix: match[1]! };
}

const byCodeUnit = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

/**
 * Append-only rules for the migration inventory. `base` is the inventory at the merge base, or null when no base ref
 * was given; without it only the name shape is checked, because new-versus-existing is undecidable.
 */
export function checkMigrationOrder(input: MigrationOrderInput): MigrationOrderProblem[] {
  const head = input.head.map((file) => ({ ...file, name: migrationNameOf(file.name) }));
  const problems: MigrationOrderProblem[] = [];
  const parsed = new Map<string, { number: number; prefix: string }>();
  for (const file of head) {
    const name = parseMigrationName(file.name);
    if (name === null) problems.push({ code: "malformed_name", path: file.path, source: MIGRATIONS_DIR });
    else parsed.set(file.path, name);
  }
  const byNumber = new Map<number, string[]>();
  for (const [filePath, name] of parsed) byNumber.set(name.number, [...(byNumber.get(name.number) ?? []), filePath]);
  for (const filePaths of byNumber.values()) if (filePaths.length > 1) for (const filePath of filePaths) problems.push({ code: "duplicate_number", path: filePath, source: MIGRATIONS_DIR });

  if (input.base !== null) {
    const headByName = new Map(head.map((file) => [file.name, file]));
    let highestBase = 0;
    let hasBase = false;
    for (const file of input.base) {
      const baseName = migrationNameOf(file.name);
      const current = headByName.get(baseName);
      if (current === undefined) problems.push({ code: "existing_deleted", path: file.path, source: MIGRATIONS_DIR });
      else if (current.content !== file.content) problems.push({ code: "existing_rewritten", path: file.path, source: MIGRATIONS_DIR });
      const name = parseMigrationName(baseName);
      if (name !== null) { hasBase = true; highestBase = Math.max(highestBase, name.number); }
    }
    const baseNames = new Set(input.base.map((file) => migrationNameOf(file.name)));
    for (const file of head) {
      if (baseNames.has(file.name)) continue;
      const name = parsed.get(file.path);
      if (name !== undefined && hasBase && name.number <= highestBase) problems.push({ code: "new_not_after_base", path: file.path, source: MIGRATIONS_DIR });
    }
  }
  return problems.sort((left, right) => byCodeUnit(`${left.path}\u0000${left.code}`, `${right.path}\u0000${right.code}`));
}

/** The migrations checked into the working tree, in directory order. */
export async function headMigrations(root: string, git: GitRunner): Promise<MigrationFile[]> {
  const dir = path.join(root, ...MIGRATIONS_DIR.split("/"));
  if (!existsSync(dir)) return [];
  const files: MigrationFile[] = [];
  for (const name of (await readdir(dir)).filter((entry) => SQL_FILE.test(entry)).sort(byCodeUnit)) {
    const spelled = `${MIGRATIONS_DIR}/${name}`;
    const blob = git(["hash-object", "--path", spelled, "--", spelled]);
    if (blob.exitCode !== 0) throw new TypeError(`cannot hash ${spelled} in the working tree`);
    files.push({ path: spelled, name, content: blob.stdout.trim() });
  }
  return files;
}

/**
 * The fork inventory, or HEAD's first parent when the ref points to HEAD, normalized to POSIX paths.
 * An empty list means the baseline predates the directory; a ref without a merge base is refused.
 */
export async function baseMigrations(ref: string, git: GitRunner): Promise<MigrationFile[]> {
  const mergeBase = git(["merge-base", "HEAD", ref]);
  let base = mergeBase.stdout.trim();
  if (mergeBase.exitCode !== 0 || base === "") throw new TypeError("base ref has no merge base with HEAD in this checkout");
  const head = git(["rev-parse", "HEAD"]);
  if (head.exitCode !== 0 || head.stdout.trim() === "") throw new TypeError("cannot resolve HEAD in this checkout");
  if (base === head.stdout.trim()) {
    // Main-push CI must check the new commit, not compare it with itself.
    // Without a parent, keep the first commit for working-tree checks.
    const parent = git(["rev-parse", "--verify", "HEAD^"]);
    if (parent.exitCode === 0) base = parent.stdout.trim();
  }
  const listing = git(["ls-tree", "-r", "--name-only", base, "--", MIGRATIONS_DIR]);
  if (listing.exitCode !== 0) throw new TypeError("cannot read the migrations tree at the merge base");
  const files: MigrationFile[] = [];
  for (const spelled of listing.stdout.split(/\r?\n/).map(normalizeMigrationPath).filter((line) => line !== "")) {
    const name = migrationNameOf(spelled);
    if (!SQL_FILE.test(name)) continue;
    const blob = git(["rev-parse", `${base}:${spelled}`]);
    if (blob.exitCode !== 0) throw new TypeError(`cannot read ${spelled} at the merge base`);
    files.push({ path: spelled, name, content: blob.stdout.trim() });
  }
  return files;
}

export type MigrationOrderReport = { readonly head: readonly MigrationFile[]; readonly base: readonly MigrationFile[] | null; readonly problems: readonly MigrationOrderProblem[] };

/** Reads the working tree and, when `ref` is given, the merge base, then applies the append-only rules. */
export async function checkRepository(root: string, ref: string | null): Promise<MigrationOrderReport> {
  const git: GitRunner = (args) => {
    const result = Bun.spawnSync({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "ignore" });
    return { exitCode: result.exitCode, stdout: new TextDecoder().decode(result.stdout) };
  };
  const base = ref === null ? null : await baseMigrations(ref, git);
  const head = await headMigrations(root, git);
  return { head, base, problems: checkMigrationOrder({ head, base }) };
}

const HELP: Record<MigrationOrderProblemCode, string> = {
  malformed_name: "migration name must be NNNN_name.sql (four digits, an underscore, a lowercase name)",
  duplicate_number: "two migrations share a numeric prefix: give each a distinct number",
  new_not_after_base: "a new migration must have a strictly greater numeric prefix than the highest migration at the merge base; never fill an earlier gap or reuse a number",
  existing_rewritten: "an applied migration was rewritten: restore it and add a new, later migration instead",
  existing_deleted: "an applied migration was deleted: restore it and add a new, later migration instead",
};

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "..", "..");
  const args = process.argv.slice(2);
  const refIndex = args.indexOf("--base-ref");
  const ref = refIndex === -1 ? null : args[refIndex + 1] ?? "";
  if (refIndex !== -1 && ref === "") { console.error("migration order: --base-ref needs a git ref"); process.exit(2); }
  let report: MigrationOrderReport;
  try {
    report = await checkRepository(root, ref);
  } catch (error) {
    console.error(`migration order: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  for (const problem of report.problems) console.error(`${problem.code}\t${problem.path}\t(${problem.source}) ${HELP[problem.code]}`);
  const baseNote = report.base === null ? " (no base ref: name check only)" : ` (base ${report.base.length} migrations)`;
  console.log(`migration order: ${report.head.length} migrations${baseNote}, ${report.problems.length} problems`);
  process.exit(report.problems.length === 0 ? 0 : 1);
}
