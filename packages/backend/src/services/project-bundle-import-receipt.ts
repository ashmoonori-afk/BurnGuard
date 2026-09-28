import type { Database } from "bun:sqlite";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { projectsDir, resolveManagedPath, systemsDir } from "../lib/paths";
import { PathBoundaryError, assertSafeName, resolveWithin } from "../security/path-boundary";

/**
 * A bundle import owns a durable receipt from before its first visible side effect until commit.
 * A receipt left behind by a crash means the import never committed, so startup removes every
 * row and directory it names.
 */
export type ProjectBundleImportReceipt = {
  readonly schema_version: 1;
  readonly operation_id: string;
  readonly project_id: string;
  readonly system_id: string | null;
  readonly staging_paths: readonly string[];
};

export function projectBundleImportReceiptsDir(): string {
  return resolveWithin(projectsDir, ".bundle-imports");
}

export async function writeProjectBundleImportReceipt(receipt: ProjectBundleImportReceipt): Promise<void> {
  const root = projectBundleImportReceiptsDir();
  await mkdir(root, { recursive: true });
  const name = `${assertSafeName(receipt.operation_id)}.json`;
  const temporary = resolveWithin(root, `${name}.tmp`);
  await writeFile(temporary, JSON.stringify(receipt), { encoding: "utf8", flag: "w" });
  await rename(temporary, resolveWithin(root, name));
}

export async function clearProjectBundleImportReceipt(operationId: string): Promise<void> {
  await rm(resolveWithin(projectBundleImportReceiptsDir(), `${assertSafeName(operationId)}.json`), { force: true });
}

export async function reconcileProjectBundleImports(db: Database): Promise<{ readonly rolled_back: number }> {
  const root = projectBundleImportReceiptsDir();
  let names: string[];
  try { names = await readdir(root); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { rolled_back: 0 };
    throw error;
  }
  let rolledBack = 0;
  for (const name of names.sort()) {
    const target = resolveWithin(root, name);
    if (name.endsWith(".json.tmp")) { await rm(target, { force: true }); continue; }
    if (!name.endsWith(".json")) continue;
    const receipt = parseReceipt(await readFile(target, "utf8"));
    if (receipt === null) { await rm(target, { force: true }); continue; }
    await rollBack(db, receipt);
    await rm(target, { force: true });
    rolledBack += 1;
  }
  return { rolled_back: rolledBack };
}

async function rollBack(db: Database, receipt: ProjectBundleImportReceipt): Promise<void> {
  db.prepare("DELETE FROM projects WHERE id=?").run(receipt.project_id);
  if (receipt.system_id !== null) {
    db.prepare("DELETE FROM design_system_receipts WHERE design_system_id=?").run(receipt.system_id);
    db.prepare("DELETE FROM design_systems WHERE id=?").run(receipt.system_id);
  }
  const directories = [
    managedChild(projectsDir, receipt.project_id),
    ...(receipt.system_id === null ? [] : [managedChild(systemsDir, receipt.system_id)]),
    ...receipt.staging_paths.map((stage) => managedStage(stage)),
  ].filter((value): value is string => value !== null);
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
}

function managedChild(root: string, id: string): string | null {
  try { return resolveWithin(root, assertSafeName(id)); }
  catch (error) {
    if (error instanceof PathBoundaryError) return null;
    throw error;
  }
}

function managedStage(stage: string): string | null {
  for (const root of [projectsDir, systemsDir]) {
    try { return resolveManagedPath(root, stage); }
    catch (error) { if (!(error instanceof PathBoundaryError)) throw error; }
  }
  return null;
}

function parseReceipt(source: string): ProjectBundleImportReceipt | null {
  let value: unknown;
  try { value = JSON.parse(source); }
  catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record["schema_version"] !== 1 || typeof record["operation_id"] !== "string" || typeof record["project_id"] !== "string" ||
    (record["system_id"] !== null && typeof record["system_id"] !== "string") || !Array.isArray(record["staging_paths"]) ||
    !record["staging_paths"].every((entry) => typeof entry === "string")) return null;
  return {
    schema_version: 1,
    operation_id: record["operation_id"],
    project_id: record["project_id"],
    system_id: record["system_id"] as string | null,
    staging_paths: record["staging_paths"] as string[],
  };
}
