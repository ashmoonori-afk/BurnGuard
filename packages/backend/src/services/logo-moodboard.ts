import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MOODBOARD_LIMITS,
  MOODBOARD_MIME_TYPES,
  UpgradeContractError,
  parseLogoMoodboardV1,
  type LogoMoodboardV1,
  type MoodboardFileItemV1,
  type MoodboardItemV1,
  type MoodboardLinkItemV1,
  type MoodboardMimeType,
} from "@bg/shared";
import { PathBoundaryError, resolveWithin } from "../security/path-boundary";
import { ImageContainerError, assertDecodableImageContainer } from "./image-container";
import { ImageFingerprintError, isolatedImageFingerprint } from "./image-fingerprint-process";

/**
 * Project-local moodboard storage for the logo deliverable (doc/23-logo-design-deliverable).
 *
 * A board is a bounded, revisioned list of immutable visual references persisted beside the project
 * under `.meta/moodboard/manifest.json` with hash-named image copies under `.meta/moodboard/files/`.
 * Image bytes are never re-encoded; the manifest is the canonical authority and its `digest` is the
 * SHA-256 of the canonical JSON `{schema_version, revision, items sorted by id}`. Reads re-verify
 * every stored digest, size, hard link and symlink; mutations are serialized per project, compare
 * the caller's `expectedRevision`, recheck the persisted revision before committing, stage image
 * writes and publish the manifest with a single atomic rename.
 *
 * Links are metadata only and are never fetched; the board proves nothing about an opaque link's
 * pixels. No database migration is involved: every project directory is self-describing.
 */

export type LogoMoodboardErrorCode =
  | "moodboard_invalid"
  | "moodboard_limit"
  | "moodboard_conflict"
  | "moodboard_image_invalid"
  | "moodboard_not_found"
  | "moodboard_corrupt";

export class LogoMoodboardError extends Error {
  readonly name = "LogoMoodboardError";
  readonly code: LogoMoodboardErrorCode;
  /** A stable, path-free token naming the failed rule; never carries a filesystem path. */
  readonly detail: string;

  constructor(code: LogoMoodboardErrorCode, detail: string = code) {
    super(detail);
    this.code = code;
    this.detail = detail;
  }
}

export type MoodboardFileContent = {
  readonly item: MoodboardFileItemV1;
  readonly bytes: Buffer;
};

const MOODBOARD_DIRECTORY = [".meta", "moodboard"] as const;
const FILES_DIRECTORY = "files";
const MANIFEST_FILE = "manifest.json";
const SHA256_HEX = /^[0-9a-f]{64}$/;
const FINGERPRINT_HEX = /^[0-9a-f]{16}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function invalid(detail: string): LogoMoodboardError { return new LogoMoodboardError("moodboard_invalid", detail); }
function limit(detail: string): LogoMoodboardError { return new LogoMoodboardError("moodboard_limit", detail); }
function conflict(): LogoMoodboardError { return new LogoMoodboardError("moodboard_conflict"); }
function imageInvalid(detail: string): LogoMoodboardError { return new LogoMoodboardError("moodboard_image_invalid", detail); }
function notFound(): LogoMoodboardError { return new LogoMoodboardError("moodboard_not_found"); }
function corrupt(detail: string): LogoMoodboardError { return new LogoMoodboardError("moodboard_corrupt", detail); }

/** `.meta/moodboard` resolved beneath `projectDir` through junction/symlink containment. */
export function moodboardDirectoryPath(projectDir: string): string {
  return resolveStoragePath(projectDir);
}

/** `.meta/moodboard/manifest.json` resolved beneath `projectDir`. */
export function moodboardManifestPath(projectDir: string): string {
  return resolveStoragePath(projectDir, MANIFEST_FILE);
}

/** `.meta/moodboard/files/<id>` resolved beneath `projectDir`; `id` is the file's content hash. */
export function moodboardImagePath(projectDir: string, id: string): string {
  return resolveStoragePath(projectDir, FILES_DIRECTORY, id);
}

/** SHA-256 of the canonical JSON `{schema_version, revision, items sorted by id}`. */
export function moodboardDigest(revision: number, items: readonly MoodboardItemV1[]): string {
  const payload = { schema_version: 1, revision, items: orderedItems(items).map(canonicalItem) };
  return sha256Hex(Buffer.from(JSON.stringify(payload), "utf8"));
}

/**
 * Reads the persisted board. A missing project directory or manifest yields the canonical empty
 * board at revision 0; a present board is fully re-verified before it is returned, and any
 * mismatch, forged digest, hard link or symlink surfaces as `moodboard_corrupt`.
 */
export async function readLogoMoodboard(projectDir: string): Promise<LogoMoodboardV1> {
  return loadBoard(projectDir);
}

/** Reads one stored image file plus its manifest item; unknown ids surface as `moodboard_not_found`. */
export async function readMoodboardFile(projectDir: string, id: string): Promise<MoodboardFileContent> {
  if (!SHA256_HEX.test(id) || !(await pathExists(projectDir))) throw notFound();
  const board = await loadBoard(projectDir);
  const found = board.items.find((item) => item.kind === "file" && item.id === id);
  if (found === undefined || found.kind !== "file") throw notFound();
  const bytes = await verifyStoredFile(projectDir, found);
  return { item: found, bytes };
}

/**
 * Adds image files to the board at `expectedRevision`. Bytes are content-addressed and immutable:
 * re-adding identical content is an idempotent no-op that does not advance the revision. The
 * declared MIME must match the byte container (PNG/JPEG/WebP); limits and a failed CAS surface as
 * `moodboard_limit` and `moodboard_conflict`.
 */
export async function addMoodboardFiles(
  projectDir: string,
  files: readonly { readonly name: string; readonly mime_type: string; readonly bytes: Buffer }[],
  expectedRevision: number,
  options: { readonly signal?: AbortSignal; readonly fingerprint?: (bytes: Buffer, signal?: AbortSignal) => Promise<string> } = {},
): Promise<LogoMoodboardV1> {
  assertRevision(expectedRevision);
  if (!Array.isArray(files)) throw invalid("files");
  const fingerprint = options.fingerprint ?? isolatedImageFingerprint;
  const signal = options.signal;
  signal?.throwIfAborted();
  return withProjectLock(projectDir, async () => {
    await mkdir(projectDir, { recursive: true });
    const current = await loadBoard(projectDir);
    if (current.revision !== expectedRevision) throw conflict();
    const prepared = await prepareFiles(files, fingerprint, signal);
    const existing = new Set(current.items.map((item) => item.id));
    const additions = dedupeById(prepared).filter((candidate) => !existing.has(candidate.item.id));
    if (additions.length === 0) return current;
    const items = [...current.items, ...additions.map((candidate) => candidate.item)];
    assertBoardLimits(items);
    const next = buildBoard(current.revision + 1, items);
    const created: string[] = [];
    try {
      for (const candidate of additions) await stageImage(projectDir, candidate, created);
      await commitBoard(projectDir, next, expectedRevision);
    } catch (error) {
      await rollback(created);
      throw error;
    }
    return next;
  });
}

/**
 * Adds a bounded HTTPS bookmark (metadata only, never fetched). The URL is canonicalized with the
 * WHATWG parser and hashed for identity, so a repeat add of the same canonical URL is idempotent.
 */
export async function addMoodboardLink(projectDir: string, url: string, expectedRevision: number): Promise<LogoMoodboardV1> {
  assertRevision(expectedRevision);
  const canonical = canonicalLinkUrl(url);
  const id = sha256Hex(Buffer.from(canonical, "utf8"));
  return withProjectLock(projectDir, async () => {
    await mkdir(projectDir, { recursive: true });
    const current = await loadBoard(projectDir);
    if (current.revision !== expectedRevision) throw conflict();
    if (current.items.some((item) => item.id === id)) return current;
    const item: MoodboardLinkItemV1 = { kind: "link", id, url: canonical, added_at: Date.now() };
    const items = [...current.items, item];
    assertBoardLimits(items);
    const next = buildBoard(current.revision + 1, items);
    await commitBoard(projectDir, next, expectedRevision);
    return next;
  });
}

/**
 * Removes one item at `expectedRevision` and reclaims a removed file's immutable bytes after the
 * manifest commit. Unknown ids surface as `moodboard_not_found`.
 */
export async function removeMoodboardItem(projectDir: string, id: string, expectedRevision: number): Promise<LogoMoodboardV1> {
  assertRevision(expectedRevision);
  if (!SHA256_HEX.test(id)) throw notFound();
  return withProjectLock(projectDir, async () => {
    await mkdir(projectDir, { recursive: true });
    const current = await loadBoard(projectDir);
    if (current.revision !== expectedRevision) throw conflict();
    const target = current.items.find((item) => item.id === id);
    if (target === undefined) throw notFound();
    const next = buildBoard(current.revision + 1, current.items.filter((item) => item.id !== id));
    await commitBoard(projectDir, next, expectedRevision);
    if (target.kind === "file") {
      await rm(resolveStoragePath(projectDir, FILES_DIRECTORY, target.id), { force: true });
    }
    return next;
  });
}

type PreparedFile = { readonly item: MoodboardFileItemV1; readonly bytes: Buffer };

async function prepareFiles(
  files: readonly { readonly name: string; readonly mime_type: string; readonly bytes: Buffer }[],
  fingerprint: (bytes: Buffer, signal?: AbortSignal) => Promise<string>,
  signal: AbortSignal | undefined,
): Promise<PreparedFile[]> {
  const prepared: PreparedFile[] = [];
  for (const file of files) {
    signal?.throwIfAborted();
    prepared.push(await prepareFile(file, fingerprint, signal));
  }
  return prepared;
}

async function prepareFile(
  file: { readonly name: string; readonly mime_type: string; readonly bytes: Buffer },
  fingerprint: (bytes: Buffer, signal?: AbortSignal) => Promise<string>,
  signal: AbortSignal | undefined,
): Promise<PreparedFile> {
  if (typeof file !== "object" || file === null) throw invalid("file");
  const { name, mime_type: mimeType, bytes } = file;
  if (typeof name !== "string" || typeof mimeType !== "string" || !Buffer.isBuffer(bytes)) throw invalid("file");
  const originalName = validateOriginalName(name);
  const declared = MOODBOARD_MIME_TYPES.find((candidate) => candidate === mimeType);
  if (declared === undefined) throw invalid("mime_type");
  if (bytes.byteLength === 0) throw imageInvalid("empty");
  if (bytes.byteLength > MOODBOARD_LIMITS.max_file_bytes) throw limit("file_bytes");
  if (detectImageMime(bytes) !== declared) throw imageInvalid("mime_mismatch");
  try { assertDecodableImageContainer(bytes); }
  catch (error) { if (error instanceof ImageContainerError) throw imageInvalid("container"); throw error; }
  const id = sha256Hex(bytes);
  let fingerprintValue: string;
  try {
    fingerprintValue = await fingerprint(bytes, signal);
  } catch (error) {
    if (error instanceof ImageFingerprintError) throw imageInvalid("decode");
    throw error;
  }
  if (typeof fingerprintValue !== "string" || !FINGERPRINT_HEX.test(fingerprintValue)) throw imageInvalid("fingerprint");
  return {
    item: { kind: "file", id, sha256: id, mime_type: declared, size_bytes: bytes.byteLength, original_name: originalName, fingerprint: fingerprintValue, added_at: Date.now() },
    bytes,
  };
}

/** Writes immutable content-addressed bytes; a pre-existing file must already match the hash. */
async function stageImage(projectDir: string, candidate: PreparedFile, created: string[]): Promise<void> {
  const finalPath = resolveStoragePath(projectDir, FILES_DIRECTORY, candidate.item.id);
  const existing = await lstat(finalPath).catch(() => null);
  if (existing !== null) {
    if (existing.isSymbolicLink() || !existing.isFile() || existing.nlink !== 1 || existing.size !== candidate.bytes.byteLength) throw corrupt("staged_conflict");
    const stored = await readFile(finalPath).catch(() => { throw corrupt("staged_unreadable"); });
    if (sha256Hex(stored) !== candidate.item.id) throw corrupt("staged_hash_mismatch");
    return;
  }
  const directory = resolveStoragePath(projectDir, FILES_DIRECTORY);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, candidate.bytes);
    await rename(temporary, finalPath);
  } finally {
    await rm(temporary, { force: true });
  }
  created.push(finalPath);
}

/** Rechecks the persisted revision, then publishes the manifest with one atomic rename. */
async function commitBoard(projectDir: string, next: LogoMoodboardV1, expectedRevision: number): Promise<void> {
  const persisted = await loadBoard(projectDir);
  if (persisted.revision !== expectedRevision) throw conflict();
  const directory = resolveStoragePath(projectDir);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.manifest.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, serializeBoard(next), "utf8");
    await rename(temporary, path.join(directory, MANIFEST_FILE));
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Best-effort reclamation of image files staged by a mutation that never committed. */
async function rollback(created: readonly string[]): Promise<void> {
  for (const target of created) await rm(target, { force: true }).catch(() => undefined);
}

async function loadBoard(projectDir: string): Promise<LogoMoodboardV1> {
  if (!(await pathExists(projectDir))) return buildBoard(0, []);
  const manifestPath = resolveStoragePath(projectDir, MANIFEST_FILE);
  const info = await lstat(manifestPath).catch(() => null);
  if (info === null) return buildBoard(0, []);
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) throw corrupt("manifest_integrity");
  if (info.size > 128 * 1024) throw corrupt("manifest_size");
  const bytes = await readFile(manifestPath).catch(() => { throw corrupt("manifest_unreadable"); });
  const parsed = parseBoard(bytes);
  for (const item of parsed.items) {
    if (item.kind === "file") await verifyStoredFile(projectDir, item);
  }
  return parsed;
}

function parseBoard(bytes: Buffer): LogoMoodboardV1 {
  let parsed: LogoMoodboardV1;
  try { parsed = parseLogoMoodboardV1(bytes.toString("utf8")); }
  catch (error) { if (error instanceof UpgradeContractError) throw corrupt("manifest_invalid"); throw error; }
  if (moodboardDigest(parsed.revision, parsed.items) !== parsed.digest) throw corrupt("digest_mismatch");
  return parsed;
}

async function verifyStoredFile(projectDir: string, item: MoodboardFileItemV1): Promise<Buffer> {
  const target = resolveStoragePath(projectDir, FILES_DIRECTORY, item.id);
  const info = await lstat(target).catch(() => null);
  if (info === null || info.isSymbolicLink() || !info.isFile() || info.nlink !== 1 || info.size !== item.size_bytes) throw corrupt("file_integrity");
  const stored = await readFile(target).catch(() => { throw corrupt("file_unreadable"); });
  if (stored.byteLength !== item.size_bytes || sha256Hex(stored) !== item.id) throw corrupt("file_hash_mismatch");
  return stored;
}

function buildBoard(revision: number, items: readonly MoodboardItemV1[]): LogoMoodboardV1 {
  const ordered = orderedItems(items);
  return { schema_version: 1, revision, digest: moodboardDigest(revision, ordered), items: ordered };
}

function serializeBoard(value: LogoMoodboardV1): string {
  return JSON.stringify({ schema_version: 1, revision: value.revision, digest: value.digest, items: orderedItems(value.items).map(canonicalItem) });
}

function orderedItems(items: readonly MoodboardItemV1[]): MoodboardItemV1[] {
  return [...items].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function canonicalItem(item: MoodboardItemV1): Record<string, unknown> {
  if (item.kind === "file") {
    return { kind: "file", id: item.id, sha256: item.sha256, mime_type: item.mime_type, size_bytes: item.size_bytes, original_name: item.original_name, fingerprint: item.fingerprint, added_at: item.added_at };
  }
  return { kind: "link", id: item.id, url: item.url, added_at: item.added_at };
}

function dedupeById(prepared: readonly PreparedFile[]): PreparedFile[] {
  const seen = new Set<string>();
  const unique: PreparedFile[] = [];
  for (const candidate of prepared) {
    if (seen.has(candidate.item.id)) continue;
    seen.add(candidate.item.id);
    unique.push(candidate);
  }
  return unique;
}

function validateOriginalName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 255 || CONTROL_CHARACTERS.test(trimmed) || trimmed.includes("/") || trimmed.includes("\\")) throw invalid("original_name");
  return trimmed;
}

function assertRevision(value: number): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalid("expected_revision");
}

function assertBoardLimits(items: readonly MoodboardItemV1[]): void {
  let files = 0;
  let links = 0;
  let totalBytes = 0;
  for (const item of items) {
    if (item.kind === "file") { files += 1; totalBytes += item.size_bytes; }
    else links += 1;
  }
  if (files > MOODBOARD_LIMITS.max_files) throw limit("files");
  if (links > MOODBOARD_LIMITS.max_links) throw limit("links");
  if (totalBytes > MOODBOARD_LIMITS.max_total_bytes) throw limit("total_bytes");
}

function canonicalLinkUrl(url: string): string {
  if (typeof url !== "string" || url.length === 0 || url.length > MOODBOARD_LIMITS.max_url_chars || CONTROL_CHARACTERS.test(url) || /\s/.test(url)) throw invalid("url");
  let parsed: URL;
  try { parsed = new URL(url); }
  catch (error) { if (error instanceof TypeError) throw invalid("url"); throw error; }
  if (parsed.protocol !== "https:" || parsed.hostname.length === 0 || parsed.username !== "" || parsed.password !== "") throw invalid("url");
  const canonical = parsed.href;
  if (canonical.length > MOODBOARD_LIMITS.max_url_chars) throw invalid("url");
  return canonical;
}

function detectImageMime(bytes: Buffer): MoodboardMimeType | null {
  if (bytes.byteLength >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.byteLength >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function resolveStoragePath(projectDir: string, ...segments: readonly string[]): string {
  try { return resolveWithin(projectDir, ...MOODBOARD_DIRECTORY, ...segments); }
  catch (error) { if (error instanceof PathBoundaryError) throw corrupt("path_escape"); throw error; }
}

async function pathExists(target: string): Promise<boolean> {
  try { await lstat(target); return true; }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return false; throw error; }
}

const projectQueues = new Map<string, Promise<void>>();

/** Serializes mutations per project dir within this profile-owned process; the manifest owns identity. */
async function withProjectLock<T>(projectDir: string, run: () => Promise<T>): Promise<T> {
  const key = path.resolve(projectDir);
  const previous = projectQueues.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => { release = resolve; });
  projectQueues.set(key, current);
  await previous;
  try { return await run(); }
  finally {
    release();
    if (projectQueues.get(key) === current) projectQueues.delete(key);
  }
}
