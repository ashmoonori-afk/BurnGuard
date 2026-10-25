import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { NORTHVALE_PREVIEW_HISTORY } from "../data/northvale-preview-history";
import { getCatalogRow } from "../db/catalog-repository";
import { resolveManagedPath } from "../lib/paths";
import { PathBoundaryError, resolveWithin } from "../security/path-boundary";
import { writeTextFileAtomically } from "./atomic-text-file";

const SYSTEM_ID = "northvale-capital";
const TOKEN_FILE = "colors_and_type.css";

export type NorthvalePreviewPaths = {
  readonly systemsRoot: string;
  readonly sourceRoot: string;
};

export type NorthvalePreviewRepair = {
  readonly repaired: readonly string[];
  readonly current: readonly string[];
  readonly preserved: readonly string[];
  readonly reason: "file_identity" | "receipt_owned" | "system_identity" | null;
};

class UnsafeNorthvaleFile extends Error {
  readonly code = "unsafe_northvale_file";
  constructor() { super("Northvale repair requires an unlinked managed file"); }
}

async function readRepairFile(root: string, relative: string): Promise<string | null> {
  // Compare lexical and resolved spellings too: a link to another file inside the
  // same root must not turn an allowlisted name into permission to replace it.
  const target = resolveWithin(root, ...relative.split("/"));
  if (target !== path.join(resolveWithin(root), ...relative.split("/"))) throw new UnsafeNorthvaleFile();
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new UnsafeNorthvaleFile();
    return await readFile(target, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Startup-only repair, after migrations and receipt recovery and before the listener.
 * A seeded sample has no receipt: catalog identity is its live tree digest. Any
 * receipt or extraction marker makes this a different, receipt-owned system and
 * is preserved in full, never silently rewritten under that identity.
 *
 * Token authority is published first. Each atomic replacement advances a file
 * from an explicit legacy hash to current bytes; a restart can resume from any
 * such prefix without a separate completion flag or blanket directory swap.
 */
export async function repairNorthvalePreviews(
  db: Database,
  paths: NorthvalePreviewPaths,
  replace: typeof writeTextFileAtomically = writeTextFileAtomically,
): Promise<NorthvalePreviewRepair> {
  const files = Object.keys(NORTHVALE_PREVIEW_HISTORY);
  const preservedSystem = (reason: NorthvalePreviewRepair["reason"]): NorthvalePreviewRepair =>
    ({ repaired: [], current: [], preserved: files, reason });
  const row = getCatalogRow(db, SYSTEM_ID);
  if (row === null || row.sourceType !== "sample" || row.lifecycle === "trashed") return preservedSystem("system_identity");
  const receipt = db.query<{ readonly id: string }, [string]>(
    "SELECT id FROM design_system_receipts WHERE design_system_id=? LIMIT 1",
  ).get(SYSTEM_ID);
  if (receipt !== null) return preservedSystem("receipt_owned");

  let destination: string;
  try {
    destination = resolveManagedPath(paths.systemsRoot, row.dirPath);
    const canonical = resolveWithin(paths.systemsRoot, SYSTEM_ID);
    const info = await lstat(path.join(paths.systemsRoot, SYSTEM_ID));
    if (!info.isDirectory() || info.isSymbolicLink() || destination !== canonical) return preservedSystem("system_identity");
    for (const marker of ["extraction-provenance.json", ".burnguard-publication"]) {
      try {
        await lstat(resolveWithin(destination, marker));
        return preservedSystem("receipt_owned");
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
  } catch (error) {
    if (error instanceof PathBoundaryError || error instanceof Error && "code" in error && error.code === "ENOENT") {
      return preservedSystem("system_identity");
    }
    throw error;
  }

  const repaired: string[] = [];
  const current: string[] = [];
  const preserved: string[] = [];
  let tokensCurrent = false;
  for (const [relative, legacyHashes] of Object.entries(NORTHVALE_PREVIEW_HISTORY)) {
    try {
      const installed = await readRepairFile(destination, relative);
      const shipped = await readRepairFile(paths.sourceRoot, relative);
      if (shipped === null) throw new UnsafeNorthvaleFile();
      if (installed !== null && installed.replaceAll("\r\n", "\n") === shipped.replaceAll("\r\n", "\n")) {
        current.push(relative);
        if (relative === TOKEN_FILE) tokensCurrent = true;
        continue;
      }
      const digest = installed === null ? null : createHash("sha256").update(installed).digest("hex");
      if (digest === null || !legacyHashes.some(hash => hash === digest) || relative === "preview/colors-ramps.html" && !tokensCurrent) {
        preserved.push(relative);
        continue;
      }
      // No server or watcher is running yet. Re-resolve at publication so the
      // atomic writer receives the same contained file we authorized by bytes.
      const target = resolveWithin(destination, ...relative.split("/"));
      await replace(target, shipped);
      repaired.push(relative);
      if (relative === TOKEN_FILE) tokensCurrent = true;
    } catch (error) {
      if (error instanceof PathBoundaryError || error instanceof UnsafeNorthvaleFile) {
        preserved.push(relative);
        continue;
      }
      throw error;
    }
  }
  return { repaired, current, preserved, reason: preserved.length > 0 ? "file_identity" : null };
}
