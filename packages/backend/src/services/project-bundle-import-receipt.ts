import type { Database } from "bun:sqlite";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectsDir, systemsDir } from "../lib/paths";
import { resolveWithin } from "../security/path-boundary";

/**
 * A bundle import owns a durable receipt from before its first visible side effect. A "pending"
 * receipt left by a crash means the import never committed: startup removes the project and system
 * it names. A "committed" receipt only authorizes removing its staging directories. Receipts hold
 * ids only; every path is derived here and must be an existing, non-link child of its managed root.
 */
export type ProjectBundleImportReceipt = {
  readonly schema_version: 1;
  readonly operation_id: string;
  readonly project_id: string;
  readonly system_id: string | null;
  readonly phase: "pending" | "committed";
};

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const BUNDLE_SYSTEM_ID = /^bundle-[0-9a-hjkmnp-tv-z]{26}$/u;

export function projectBundleImportReceiptsDir(): string {
  return resolveWithin(projectsDir, ".bundle-imports");
}

export function projectBundlePayloadStage(operationId: string): string {
  if (!ULID.test(operationId)) throw new Error("invalid_bundle_operation_id");
  return resolveWithin(projectsDir, ".bundle-imports", `${operationId}-payload`);
}

export function projectBundleSystemStage(systemId: string): string {
  if (!BUNDLE_SYSTEM_ID.test(systemId)) throw new Error("invalid_bundle_system_id");
  return resolveWithin(systemsDir, `.${systemId}-stage`);
}

export async function writeProjectBundleImportReceipt(receipt: ProjectBundleImportReceipt): Promise<void> {
  if (!isValidReceipt(receipt)) throw new Error("invalid_bundle_import_receipt");
  const root = projectBundleImportReceiptsDir();
  await mkdir(root, { recursive: true });
  const temporary = resolveWithin(root, `${receipt.operation_id}.json.tmp`);
  await writeFile(temporary, JSON.stringify(receipt), { encoding: "utf8", flag: "w" });
  await rename(temporary, resolveWithin(root, `${receipt.operation_id}.json`));
}

export async function clearProjectBundleImportReceipt(operationId: string): Promise<void> {
  if (!ULID.test(operationId)) throw new Error("invalid_bundle_operation_id");
  await rm(resolveWithin(projectBundleImportReceiptsDir(), `${operationId}.json`), { force: true });
}

export async function reconcileProjectBundleImports(db: Database): Promise<{ readonly rolled_back: number; readonly quarantined: number }> {
  const root = projectBundleImportReceiptsDir();
  let names: string[];
  try { names = await readdir(root); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { rolled_back: 0, quarantined: 0 };
    throw error;
  }
  let rolledBack = 0;
  let quarantined = 0;
  for (const name of names.sort()) {
    if (name.endsWith(".json.tmp")) { await rm(resolveWithin(root, name), { force: true }); continue; }
    if (!name.endsWith(".json")) continue;
    const target = resolveWithin(root, name);
    const receipt = parseReceipt(await readFile(target, "utf8"));
    if (receipt === null || `${receipt.operation_id}.json` !== name) {
      await rename(target, resolveWithin(root, `${name}.quarantined`));
      quarantined += 1;
      continue;
    }
    if (receipt.phase === "pending") {
      if (await ownedByOperation(projectsDir, receipt.project_id, receipt.operation_id)) {
        db.prepare("DELETE FROM projects WHERE id=?").run(receipt.project_id);
        await removeOwnedDirectory(projectsDir, receipt.project_id);
      }
      if (receipt.system_id !== null && await ownedByOperation(systemsDir, receipt.system_id, receipt.operation_id)) {
        db.prepare("DELETE FROM design_system_receipts WHERE design_system_id=?").run(receipt.system_id);
        db.prepare("DELETE FROM design_systems WHERE id=?").run(receipt.system_id);
        await removeOwnedDirectory(systemsDir, receipt.system_id);
      }
      rolledBack += 1;
    }
    await removeOwnedDirectory(projectsDir, path.basename(projectBundlePayloadStage(receipt.operation_id)), ".bundle-imports");
    if (receipt.system_id !== null) await removeOwnedDirectory(systemsDir, path.basename(projectBundleSystemStage(receipt.system_id)));
    await rm(target, { force: true });
  }
  return { rolled_back: rolledBack, quarantined };
}

const OWNER_MARKER = [".meta", "bundle-import-owner.json"] as const;

/** Written before any row naming the directory exists, so recovery can prove the import created it. */
export async function writeBundleImportOwnerMarker(directory: string, operationId: string): Promise<void> {
  await mkdir(path.join(directory, OWNER_MARKER[0]), { recursive: true });
  await writeFile(path.join(directory, ...OWNER_MARKER), JSON.stringify({ operation_id: operationId }), { encoding: "utf8", flag: "wx" });
}

export async function removeBundleImportOwnerMarker(directory: string): Promise<void> {
  await rm(path.join(directory, ...OWNER_MARKER), { force: true });
}

async function ownedByOperation(root: string, name: string, operationId: string): Promise<boolean> {
  const directory = await ownedChildDirectory(root, name);
  if (directory === null) return false;
  const marker = path.join(directory, ...OWNER_MARKER);
  let info: Awaited<ReturnType<typeof lstat>>;
  try { info = await lstat(marker); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile() || info.size > 1024) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(marker, "utf8")); }
  catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
  return typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>)["operation_id"] === operationId;
}

/** Checks the lexical child with lstat before any realpath resolution, so a link is never followed. */
async function ownedChildDirectory(container: string, name: string): Promise<string | null> {
  const lexical = path.join(container, name);
  let info: Awaited<ReturnType<typeof lstat>>;
  try { info = await lstat(lexical); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) return null;
  if (path.dirname(await realpath(lexical)) !== await realpath(container)) return null;
  return lexical;
}

async function removeOwnedDirectory(root: string, name: string, parent?: string): Promise<void> {
  const container = parent === undefined ? root : path.join(root, parent);
  const target = await ownedChildDirectory(container, name);
  if (target !== null) await rm(target, { recursive: true, force: true });
}

function isValidReceipt(value: ProjectBundleImportReceipt): boolean {
  return value.schema_version === 1 && ULID.test(value.operation_id) && ULID.test(value.project_id) &&
    (value.system_id === null || BUNDLE_SYSTEM_ID.test(value.system_id)) && (value.phase === "pending" || value.phase === "committed");
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
  const keys = Object.keys(record).sort().join(",");
  if (keys !== "operation_id,phase,project_id,schema_version,system_id") return null;
  const candidate = {
    schema_version: record["schema_version"],
    operation_id: record["operation_id"],
    project_id: record["project_id"],
    system_id: record["system_id"],
    phase: record["phase"],
  };
  if (typeof candidate.operation_id !== "string" || typeof candidate.project_id !== "string" ||
    (candidate.system_id !== null && typeof candidate.system_id !== "string")) return null;
  const receipt = candidate as ProjectBundleImportReceipt;
  return isValidReceipt(receipt) ? receipt : null;
}
