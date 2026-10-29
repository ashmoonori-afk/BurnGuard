import type { Database } from "bun:sqlite";
import { readdir, rm } from "node:fs/promises";
import {
  CatalogRepositoryError, commitCatalogOperation, createCatalogChild, deleteCatalogSystem, failCatalogOperation,
  getCatalogRow, getCatalogUsage, getCurrentSystemContent, getPendingSystemOperation, getLatestCatalogOperation, listPendingCatalogReceipts,
  prepareCatalogOperation, type CatalogReceiptRow, type CatalogRow,
} from "../db/catalog-repository";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import {
  CatalogFileError, catalogPaths, copyCatalogTree, exists, moveCatalogTree,
  publishCatalogCopy, removeCatalogTree, validateCatalogReceiptTree,
} from "./catalog-files";
import { withSystemContentAccess, withSystemContentLocks } from "./system-content-access";
import type { CatalogAccessEvents } from "./catalog-snapshot";
import { SystemContentError } from "./system-content-format";
import { pathStat, safeContentChild } from "./system-content-tree";

export class CatalogLifecycleError extends Error {
  readonly name = "CatalogLifecycleError";
  constructor(readonly code: "design_system_not_found" | "id_conflict" | "lineage_parent_mismatch" | "has_active_projects" | "is_template" | "invalid_lifecycle" | "unsafe_catalog_path" | "catalog_digest_mismatch" | "catalog_manifest_unverifiable" | "catalog_operation_conflict" | "catalog_operation_failed", message: string) {
    super(message);
  }
}

type ChildInput = {
  readonly id: string; readonly name: string; readonly operation: "duplicate" | "derive";
  readonly parentReceiptId?: string; readonly parentDigest?: string; readonly reason: string | null;
  readonly metadata: Readonly<Record<string, string>>;
};

export async function copyCatalogSystem(db: Database, root: string, parentId: string, input: ChildInput, events: CatalogAccessEvents = {}): Promise<string> {
  const pending = withSystemContentAccess(db, root, [parentId, input.id], async () => {
    const parent = requiredRow(db, parentId);
    const parentReceipt = getCurrentSystemContent(db, parentId);
    if (parentReceipt === null || parentReceipt.status !== "committed") throw new CatalogLifecycleError("lineage_parent_mismatch", "Parent content receipt is unavailable");
    if (input.parentReceiptId !== undefined && input.parentReceiptId !== parentReceipt.id) throw new CatalogLifecycleError("lineage_parent_mismatch", "Parent receipt is stale");
    if (input.parentDigest !== undefined && input.parentDigest !== parentReceipt.digest) throw new CatalogLifecycleError("lineage_parent_mismatch", "Parent digest is stale");
    const paths = await catalogPaths(root, parent.id, parent.dirPath);
    await validateReceiptTree(paths.live, parentReceipt, parent.id);
    if (getCatalogRow(db, input.id) !== null) throw new CatalogLifecycleError("id_conflict", "Child ID already exists");
    const destination = resolveWithin(root, assertSafeName(input.id));
    const childPaths = await catalogPaths(root, input.id, destination);
    if (await exists(childPaths.live) || await exists(childPaths.trash)) throw new CatalogLifecycleError("id_conflict", "Child storage is occupied");
    const now = Date.now();
    const operation = operationInput(input.id, input.operation, parentReceipt, parent, paths.live, destination, input.reason, input.metadata, now);
    const receiptId = createCatalogChild(db, parent, input.id, input.name, operation);
    if (fault(`prepared:${input.operation}:${input.id}`)) throw new CatalogLifecycleError("catalog_operation_failed", "Injected prepared receipt fault");
    let staging: string | null = null;
    let published = false;
    try {
      const copy = await copyCatalogTree(root, input.id, paths.live);
      staging = copy.staging;
      await validateReceiptTree(copy.staging, parentReceipt, parent.id);
      await publishCatalogCopy(copy.staging, copy.destination);
      published = true;
      staging = null;
      await validateReceiptTree(copy.destination, parentReceipt, parent.id);
      if (fault(`db-after-fs:${input.operation}:${input.id}`)) throw new InjectedCatalogFault();
      commitCatalogOperation(db, receiptId, "active", Date.now());
      return input.id;
    } catch (error) {
      if (error instanceof InjectedCatalogFault) throw new CatalogLifecycleError("catalog_operation_failed", error.message);
      // Once published, recovery owns the receipt and destination. A failed validation is not
      // permission to delete newly divergent bytes or erase the child's durable ownership.
      if (published) throw translate(error);
      if (staging !== null) await removeCatalogTree(staging);
      deleteCatalogSystem(db, input.id);
      throw translate(error);
    }
  });
  events.onAccessQueued?.();
  try { return await pending; }
  catch (error) {
    if (error instanceof SystemContentError && error.code === "system_content_unavailable") throw new CatalogRepositoryError("operation_conflict", parentId);
    throw error;
  }
}

export async function trashCatalogSystem(db: Database, root: string, id: string, events: CatalogAccessEvents = {}): Promise<void> {
  await catalogLock(db, root, id, async () => {
    const row = requiredRow(db, id);
    if (row.isTemplate === 1) throw new CatalogLifecycleError("is_template", "Template systems cannot be trashed");
    if (row.lifecycle !== "active") throw new CatalogLifecycleError("invalid_lifecycle", "Only active systems can be trashed");
    if (getCatalogUsage(db, id).length > 0) throw new CatalogLifecycleError("has_active_projects", "Active projects reference this system");
    const paths = await catalogPaths(root, id, row.dirPath);
    const content = await contentIdentity(db, paths.live, id);
    const receiptId = prepareCatalogOperation(db, operationInput(id, "trash", content.receipt, row, paths.live, paths.trash, null, {}, Date.now()));
    if (fault(`prepared:trash:${id}`)) throw new CatalogLifecycleError("catalog_operation_failed", "Injected prepared receipt fault");
    try {
      await moveCatalogTree(paths.live, paths.trash);
      if (fault(`db-after-fs:trash:${id}`)) throw new InjectedCatalogFault();
      commitCatalogOperation(db, receiptId, "trashed", Date.now());
    } catch (error) {
      if (error instanceof InjectedCatalogFault) throw new CatalogLifecycleError("catalog_operation_failed", error.message);
      failCatalogOperation(db, receiptId, Date.now());
      throw translate(error);
    }
  }, events);
}

export async function restoreCatalogSystem(db: Database, root: string, id: string): Promise<void> {
  await catalogLock(db, root, id, async () => {
    const row = requiredRow(db, id);
    if (row.lifecycle !== "trashed") throw new CatalogLifecycleError("invalid_lifecycle", "Only trashed systems can be restored");
    if (getCatalogUsage(db, id).length > 0) throw new CatalogLifecycleError("has_active_projects", "Active projects reference this system");
    const trashReceipt = getLatestCatalogOperation(db, id, "trash");
    if (trashReceipt === null) throw new CatalogLifecycleError("invalid_lifecycle", "Trash receipt is missing");
    const paths = await catalogPaths(root, id, row.dirPath);
    await validateReceiptTree(paths.trash, trashReceipt, row.id);
    const receiptId = prepareCatalogOperation(db, operationInput(id, "restore", trashReceipt, row, paths.trash, paths.live, null, {}, Date.now()));
    if (fault(`prepared:restore:${id}`)) throw new CatalogLifecycleError("catalog_operation_failed", "Injected prepared receipt fault");
    try {
      await moveCatalogTree(paths.trash, paths.live);
      if (fault(`db-after-fs:restore:${id}`)) throw new InjectedCatalogFault();
      commitCatalogOperation(db, receiptId, "active", Date.now());
    } catch (error) {
      if (error instanceof InjectedCatalogFault) throw new CatalogLifecycleError("catalog_operation_failed", error.message);
      failCatalogOperation(db, receiptId, Date.now());
      throw translate(error);
    }
  });
}

export async function purgeCatalogSystem(db: Database, root: string, id: string): Promise<void> {
  await catalogLock(db, root, id, async () => {
    const row = requiredRow(db, id);
    if (row.lifecycle !== "trashed") throw new CatalogLifecycleError("invalid_lifecycle", "Only trashed systems can be purged");
    if (getCatalogUsage(db, id).length > 0) throw new CatalogLifecycleError("has_active_projects", "Active projects reference this system");
    const trashReceipt = getLatestCatalogOperation(db, id, "trash");
    if (trashReceipt === null) throw new CatalogLifecycleError("invalid_lifecycle", "Trash receipt is missing");
    const paths = await catalogPaths(root, id, row.dirPath);
    await validateReceiptTree(paths.trash, trashReceipt, row.id);
    prepareCatalogOperation(db, operationInput(id, "purge", trashReceipt, row, paths.trash, paths.live, null, {}, Date.now()));
    if (fault(`rm:purge:${id}`)) throw new CatalogLifecycleError("catalog_operation_failed", "Injected purge removal fault");
    await removeCatalogTree(paths.trash);
    if (fault(`db-after-fs:purge:${id}`)) throw new CatalogLifecycleError("catalog_operation_failed", "Injected post-removal DB fault");
    deleteCatalogSystem(db, id);
  });
}

export async function reconcileCatalogState(db: Database, root: string): Promise<{ readonly recovered: number; readonly failed: number }> {
  let recovered = 0;
  let failed = 0;
  for (const receipt of listPendingCatalogReceipts(db)) {
    const row = getCatalogRow(db, receipt.designSystemId);
    try {
      parseReceiptPayload(receipt);
      if (receipt.operation === "duplicate" || receipt.operation === "derive") {
        if (row === null || receipt.destinationPath === null || !(await exists(receipt.destinationPath))) throw new MissingCatalogState();
        await validateReceiptTree(receipt.destinationPath, receipt, receipt.designSystemId);
        commitCatalogOperation(db, receipt.id, "active", Date.now());
      } else if (receipt.operation === "trash" || receipt.operation === "restore") {
        if (row === null) throw new MissingCatalogState();
        const paths = await catalogPaths(root, row.id, row.dirPath);
        const source = receipt.operation === "trash" ? paths.live : paths.trash;
        const destination = receipt.operation === "trash" ? paths.trash : paths.live;
        const sourceExists = await exists(source);
        const destinationExists = await exists(destination);
        if (sourceExists === destinationExists) throw new MissingCatalogState();
        const occupied = sourceExists ? source : destination;
        await validateReceiptTree(occupied, receipt, receipt.designSystemId);
        if (sourceExists) await moveCatalogTree(source, destination);
        commitCatalogOperation(db, receipt.id, receipt.operation === "trash" ? "trashed" : "active", Date.now());
      } else if (receipt.operation === "purge") {
        if (row !== null) {
          const paths = await catalogPaths(root, row.id, row.dirPath);
          if (await exists(paths.trash)) {
            await validateReceiptTree(paths.trash, receipt, receipt.designSystemId);
            await removeCatalogTree(paths.trash);
          } else {
            parseReceiptPayload(receipt);
            if (receipt.parentDigest !== receipt.digest) throw new CatalogFileError("catalog_digest_mismatch", "Catalog parent digest is stale");
          }
          deleteCatalogSystem(db, row.id);
        }
      }
      recovered += 1;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (!(error instanceof CatalogFileError)) {
        failCatalogOperation(db, receipt.id, Date.now());
        if ((receipt.operation === "duplicate" || receipt.operation === "derive") && row !== null && !(await exists(receipt.destinationPath ?? ""))) deleteCatalogSystem(db, row.id);
      }
      failed += 1;
    }
  }
  await cleanupCatalogControls(root);
  return { recovered, failed };
}

function operationInput(systemId: string, operation: Exclude<CatalogReceiptRow["operation"], "content">, receipt: CatalogReceiptRow, parent: CatalogRow, sourcePath: string, destinationPath: string, reason: string | null, metadata: Readonly<Record<string, string>>, now: number) {
  return { systemId, operation, digest: receipt.digest, manifestJson: receipt.manifestJson, provenanceJson: receipt.provenanceJson, parentSystemId: parent.id, parentReceiptId: operation === "duplicate" || operation === "derive" || receipt.operation === "content" ? receipt.id : receipt.parentReceiptId, parentDigest: receipt.digest, reason, metadata, sourcePath, destinationPath, now };
}

async function contentIdentity(db: Database, treePath: string, id: string): Promise<{ readonly receipt: CatalogReceiptRow }> {
  const receipt = getCurrentSystemContent(db, id);
  if (receipt !== null) {
    if (receipt.status !== "committed") throw new CatalogFileError("catalog_digest_mismatch", "Catalog content receipt is not committed");
    await validateReceiptTree(treePath, receipt, id);
    return { receipt };
  }
  throw new CatalogFileError("catalog_manifest_unverifiable", `Catalog ${id} has no trusted tree manifest`);
}

async function validateReceiptTree(target: string, receipt: CatalogReceiptRow, expectedSystemId: string): Promise<void> {
  parseReceiptPayload(receipt);
  if (receipt.designSystemId !== expectedSystemId) throw new CatalogFileError("catalog_digest_mismatch", "Catalog receipt system identity is stale");
  if (receipt.operation !== "content" && (receipt.parentSystemId === null || receipt.parentReceiptId === null || receipt.parentDigest === null)) {
    throw new CatalogFileError("catalog_digest_mismatch", "Catalog receipt lineage is incomplete");
  }
  await validateCatalogReceiptTree(target, receipt);
}

function parseReceiptPayload(receipt: CatalogReceiptRow): void {
  for (const raw of [receipt.manifestJson, receipt.provenanceJson, receipt.metadataJson]) {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new MissingCatalogState();
  }
}

function requiredRow(db: Database, id: string): CatalogRow {
  const row = getCatalogRow(db, id);
  if (row === null) throw new CatalogLifecycleError("design_system_not_found", "Design system not found");
  return row;
}

async function catalogLock<T>(db: Database, root: string, id: string, operation: () => Promise<T>, events: CatalogAccessEvents = {}): Promise<T> {
  const pending = withSystemContentLocks(root, [id], async () => {
    if (getPendingSystemOperation(db, id) !== null) throw new CatalogRepositoryError("operation_conflict", id);
    return operation();
  });
  events.onAccessQueued?.();
  try { return await pending; }
  catch (error) {
    if (error instanceof SystemContentError && error.code === "system_content_unavailable") throw new CatalogRepositoryError("operation_conflict", id);
    throw error;
  }
}

async function cleanupCatalogControls(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.some((entry) => entry.isDirectory() && /^\..+\.catalog-staging-/.test(entry.name))) return;
  const lockRoot = await safeContentChild(root, ".catalog-locks");
  if (await pathStat(lockRoot) === null) return;
  // Occupied locks, including incomplete/unknown owners, need startup classification rather than blanket deletion.
  if ((await readdir(lockRoot)).length === 0) await rm(lockRoot, { recursive: true });
}

function translate(error: unknown): CatalogLifecycleError {
  if (error instanceof CatalogLifecycleError) return error;
  if (error instanceof CatalogFileError) {
    const code = error.code === "unsafe_catalog_path" ? "unsafe_catalog_path" : error.code === "catalog_digest_mismatch" ? "catalog_digest_mismatch" : error.code === "catalog_manifest_unverifiable" ? "catalog_manifest_unverifiable" : "catalog_operation_failed";
    return new CatalogLifecycleError(code, error.message);
  }
  if (error instanceof CatalogRepositoryError) {
    const code = error.code === "id_conflict" ? "id_conflict" : "catalog_operation_conflict";
    return new CatalogLifecycleError(code, error.message);
  }
  if (error instanceof Error) return new CatalogLifecycleError("catalog_operation_failed", error.message);
  return new CatalogLifecycleError("catalog_operation_failed", "Unknown catalog operation failure");
}

function fault(value: string): boolean {
  if (process.env.BG_CATALOG_FAULT === value) return true;
  const [phase, operation, id] = value.split(":");
  if (phase === "prepared") return process.env.BG_CATALOG_FAULT_PREPARED_ID === id;
  if (phase === "db-after-fs") return process.env.BG_CATALOG_FAULT_DB_AFTER_FS_ID === id || process.env.BG_CATALOG_FAULT_PURGE_DB_ID === id && operation === "purge";
  if (phase === "rm" && operation === "purge") return process.env.BG_CATALOG_FAULT_RM_ID === id;
  return false;
}
class InjectedCatalogFault extends Error { readonly name = "InjectedCatalogFault"; }
class MissingCatalogState extends Error { readonly name = "MissingCatalogState"; }
