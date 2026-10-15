import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PHOTO_PLACEMENTS_FILE, PHOTO_REFERENCE_DIR, UpgradeContractError, parsePhotoPlacementsV1 } from "@bg/shared";
import { resolveWithin } from "../security/path-boundary";
import { readContainedFile } from "./photo-placements";

/**
 * Owned publication of the photographic placement record (doc/image-production). The agent writes
 * `.meta/photo-placements.json` and its reference photos under `.meta/references/` in the operation stage, but the
 * canonical artifact tree excludes `.meta`, so the normal publication drops them. This module validates exactly that
 * record and the files it names, then installs them in the live project beside the tree publication and restores the
 * previous ones when the operation rolls back. No other metadata is ever copied.
 */

const MAX_RECORD_BYTES = 256 * 1024;
const MAX_REFERENCE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 128 * 1024 * 1024;

export type PreparedPhotoRecord =
  | { readonly kind: "absent" }
  | { readonly kind: "invalid" }
  | { readonly kind: "ready"; readonly record: Buffer; readonly files: readonly { readonly relative: string; readonly bytes: Buffer }[] };

/**
 * Reads and validates the record under `root` (a stage or a live project): the shared parser accepts it, every
 * referenced file is a regular single-link file within bounds, and its bytes match the declared hash. A symlink,
 * hard link, escaping name, missing file or hash mismatch makes the whole record invalid.
 */
export async function prepareStagedPhotoRecord(root: string): Promise<PreparedPhotoRecord> {
  const record = await readContainedFile(root, PHOTO_PLACEMENTS_FILE, MAX_RECORD_BYTES);
  if (record === null) return { kind: "absent" };
  let names: readonly string[];
  let hashes: ReadonlyMap<string, string>;
  try {
    const parsed = parsePhotoPlacementsV1(record.toString("utf8"));
    const declared = new Map<string, string>();
    for (const placement of parsed.placements) {
      for (const reference of placement.references) {
        if (declared.get(reference.local_file) !== undefined && declared.get(reference.local_file) !== reference.sha256) return { kind: "invalid" };
        declared.set(reference.local_file, reference.sha256);
      }
    }
    names = [...declared.keys()].sort();
    hashes = declared;
  } catch (error) {
    if (error instanceof UpgradeContractError) return { kind: "invalid" };
    throw error;
  }
  const files: { relative: string; bytes: Buffer }[] = [];
  let total = 0;
  for (const relative of names) {
    const bytes = await readContainedFile(root, relative, MAX_REFERENCE_BYTES);
    if (bytes === null || createHash("sha256").update(bytes).digest("hex") !== hashes.get(relative)) return { kind: "invalid" };
    total += bytes.length;
    if (total > MAX_TOTAL_REFERENCE_BYTES) return { kind: "invalid" };
    files.push({ relative, bytes });
  }
  return { kind: "ready", record, files };
}

async function writeAtomic(target: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return false;
    throw error;
  }
}

/** Writes a prepared record and its files into `root`, each file atomically and the record last. */
export async function writePreparedPhotoRecord(prepared: Extract<PreparedPhotoRecord, { kind: "ready" }>, root: string): Promise<void> {
  for (const file of prepared.files) await writeAtomic(resolveWithin(root, ...file.relative.split("/")), file.bytes);
  await writeAtomic(resolveWithin(root, ...PHOTO_PLACEMENTS_FILE.split("/")), prepared.record);
}

/**
 * One operation's installation of a prepared record in the live project. `install` moves the previous record and
 * reference directory into `backupDir` (inside the operation's own storage) before writing the new ones;
 * `rollback` removes what was installed and moves the previous ones back. Both are idempotent per step.
 */
export class PhotoRecordPublication {
  private movedReferences = false;
  private movedRecord = false;
  private installedReferences = false;
  private installedRecord = false;

  constructor(private readonly prepared: Extract<PreparedPhotoRecord, { kind: "ready" }>, private readonly projectDir: string, private readonly backupDir: string) {}

  private live(relative: string): string { return resolveWithin(this.projectDir, ...relative.split("/")); }

  async install(): Promise<void> {
    const references = this.live(PHOTO_REFERENCE_DIR);
    const record = this.live(PHOTO_PLACEMENTS_FILE);
    await mkdir(this.backupDir, { recursive: true });
    if (await exists(references)) { await rename(references, path.join(this.backupDir, "references")); this.movedReferences = true; }
    if (await exists(record)) { await rename(record, path.join(this.backupDir, "photo-placements.json")); this.movedRecord = true; }
    this.installedReferences = true;
    this.installedRecord = true;
    await writePreparedPhotoRecord(this.prepared, this.projectDir);
  }

  async rollback(): Promise<void> {
    const references = this.live(PHOTO_REFERENCE_DIR);
    const record = this.live(PHOTO_PLACEMENTS_FILE);
    if (this.installedReferences) await rm(references, { recursive: true, force: true });
    if (this.installedRecord) await rm(record, { force: true });
    if (this.movedReferences) await rename(path.join(this.backupDir, "references"), references);
    if (this.movedRecord) await rename(path.join(this.backupDir, "photo-placements.json"), record);
    this.movedReferences = this.movedRecord = this.installedReferences = this.installedRecord = false;
  }
}

/** Copies the live project's valid record into a new stage so the next generation starts from, and can amend, it. */
export async function seedStagedPhotoRecord(projectDir: string, stageDir: string): Promise<void> {
  const live = await prepareStagedPhotoRecord(projectDir);
  if (live.kind === "ready") await writePreparedPhotoRecord(live, stageDir);
}
