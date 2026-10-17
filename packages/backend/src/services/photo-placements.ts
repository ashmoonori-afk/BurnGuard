import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { PHOTO_PLACEMENTS_FILE, UpgradeContractError, parsePhotoPlacementsV1, type PhotoPlacementsV1 } from "@bg/shared";
import { PathBoundaryError, resolveWithin } from "../security/path-boundary";
import type { CanonicalTreeEntry } from "./canonical-tree-manifest";

/**
 * Backend side of the photographic placement record (doc/image-production). The agent writes
 * `.meta/photo-placements.json`; this module reads it, contained beneath the project root, and treats a
 * missing or malformed file as absent state. `.meta/` is outside the canonical artifact tree, so reference
 * photos stored there cannot ship by location; the leak check catches a copy placed into the tree itself.
 */

const MAX_RECORD_BYTES = 256 * 1024;
const MAX_REFERENCE_BYTES = 32 * 1024 * 1024;

export type PhotoPlacementsRead =
  | { readonly kind: "absent" }
  | { readonly kind: "invalid" }
  | { readonly kind: "present"; readonly record: PhotoPlacementsV1 };

export type ReferenceLeak = { readonly placement_id: string; readonly reference_file: string; readonly deliverable_path: string };

export async function readContainedFile(projectDir: string, relative: string, maxBytes: number): Promise<Buffer | null> {
  try {
    const target = resolveWithin(projectDir, ...relative.split("/"));
    const info = await lstat(target);
    if (!info.isFile() || info.nlink !== 1 || info.size > maxBytes) return null;
    return await readFile(target);
  } catch (error) {
    if (error instanceof PathBoundaryError) return null;
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return null;
    throw error;
  }
}

export async function readPhotoPlacements(projectDir: string): Promise<PhotoPlacementsRead> {
  const bytes = await readContainedFile(projectDir, PHOTO_PLACEMENTS_FILE, MAX_RECORD_BYTES);
  if (bytes === null) return { kind: "absent" };
  try {
    return { kind: "present", record: parsePhotoPlacementsV1(bytes.toString("utf8")) };
  } catch (error) {
    if (error instanceof UpgradeContractError) return { kind: "invalid" };
    throw error;
  }
}

/**
 * A reference photo's bytes must never appear in the published tree. Both the hash the record declares and the
 * hash of the stored reference file are compared with every deliverable file, so a wrong declared hash cannot hide a copy.
 */
export async function findReferencePhotoLeaks(projectDir: string, files: readonly CanonicalTreeEntry[]): Promise<readonly ReferenceLeak[]> {
  const read = await readPhotoPlacements(projectDir);
  if (read.kind !== "present") return [];
  const leaks: ReferenceLeak[] = [];
  for (const placement of read.record.placements) {
    for (const reference of placement.references) {
      const stored = await readContainedFile(projectDir, reference.local_file, MAX_REFERENCE_BYTES);
      const hashes = new Set([reference.sha256]);
      if (stored !== null) hashes.add(createHash("sha256").update(stored).digest("hex"));
      for (const file of files) if (hashes.has(file.sha256)) leaks.push({ placement_id: placement.id, reference_file: reference.local_file, deliverable_path: file.path });
    }
  }
  return leaks;
}
