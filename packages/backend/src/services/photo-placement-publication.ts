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

const BEGIN_FILE = "begin.json";
type PhotoBackupBegin = { readonly had_references: boolean; readonly had_record: boolean };

async function readBegin(backupDir: string): Promise<PhotoBackupBegin | null> {
  const bytes = await readContainedFile(backupDir, BEGIN_FILE, 1024);
  if (bytes === null) return null;
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("photo_backup_corrupt");
  const hadReferences = Reflect.get(value, "had_references");
  const hadRecord = Reflect.get(value, "had_record");
  if (typeof hadReferences !== "boolean" || typeof hadRecord !== "boolean") throw new Error("photo_backup_corrupt");
  return { had_references: hadReferences, had_record: hadRecord };
}

/**
 * One operation's installation of a prepared record in the live project. All progress lives on disk in `backupDir`
 * (inside the operation's own storage), never in memory, so startup recovery can finish or undo it after a crash:
 * `begin.json` records, before anything moves, whether the project already had a record and a reference directory;
 * `install` then moves those into `backupDir` and writes the new files (references first, the record last);
 * `rollback` removes what was installed and moves the previous ones back. Both can be repeated any number of times.
 */
export class PhotoRecordPublication {
  constructor(private readonly prepared: Extract<PreparedPhotoRecord, { kind: "ready" }> | null, private readonly projectDir: string, private readonly backupDir: string) {}

  private live(relative: string): string { return resolveWithin(this.projectDir, ...relative.split("/")); }

  async install(): Promise<void> {
    if (this.prepared === null) throw new Error("photo_record_not_prepared");
    const references = this.live(PHOTO_REFERENCE_DIR);
    const record = this.live(PHOTO_PLACEMENTS_FILE);
    await mkdir(this.backupDir, { recursive: true });
    let begin = await readBegin(this.backupDir);
    if (begin === null) {
      begin = { had_references: await exists(references), had_record: await exists(record) };
      await writeAtomic(path.join(this.backupDir, BEGIN_FILE), Buffer.from(JSON.stringify(begin)));
    }
    const savedReferences = path.join(this.backupDir, "references");
    const savedRecord = path.join(this.backupDir, "photo-placements.json");
    if (begin.had_references && !(await exists(savedReferences))) await rename(references, savedReferences);
    if (begin.had_record && !(await exists(savedRecord))) await rename(record, savedRecord);
    await writePreparedPhotoRecord(this.prepared, this.projectDir);
  }

  async rollback(): Promise<void> {
    const begin = await readBegin(this.backupDir);
    if (begin === null) return;
    await this.restore(PHOTO_REFERENCE_DIR, path.join(this.backupDir, "references"), begin.had_references, true);
    await this.restore(PHOTO_PLACEMENTS_FILE, path.join(this.backupDir, "photo-placements.json"), begin.had_record, false);
  }

  private async restore(relative: string, saved: string, hadIt: boolean, directory: boolean): Promise<void> {
    const live = this.live(relative);
    if (await exists(saved)) {
      await rm(live, { recursive: directory, force: true });
      await rename(saved, live);
    } else if (!hadIt) await rm(live, { recursive: directory, force: true });
  }
}

/** Copies the live project's valid record into a new stage so the next generation starts from, and can amend, it. */
export async function seedStagedPhotoRecord(projectDir: string, stageDir: string): Promise<void> {
  const live = await prepareStagedPhotoRecord(projectDir);
  if (live.kind === "ready") await writePreparedPhotoRecord(live, stageDir);
}
