import { createHash } from "node:crypto";
import { opendirSync, readFileSync, statSync, type Dir } from "node:fs";
import path from "node:path";
import { PathBoundaryError, resolveWithin } from "../../security/path-boundary";

/**
 * Codex CLI 0.154 `exec --json` emits no item at all for its built-in `image_gen` tool: the only
 * trace of a generation is the PNG it saves under `$CODEX_HOME/generated_images/<thread_id>/`
 * (verified against a live run, 2026-09-20). Each `codex exec` opens a fresh thread, so that
 * directory holds exactly this process's outputs. Hashing it at turn end is the provenance the
 * logo gate needs; a missing directory, a foreign thread id or a non-PNG file yields nothing.
 */
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** At most this many PNG files are hashed, and at most MAX_SCANNED_ENTRIES directory entries are read to find them. */
const MAX_GENERATED_FILES = 64;
const MAX_SCANNED_ENTRIES = 1024;
const GENERATED_PNG_NAME = /^[A-Za-z0-9._-]+\.png$/i;

export function collectGeneratedImageHashes(codexHome: string, threadId: string): string[] {
  if (!THREAD_ID.test(threadId)) return [];
  // Enumeration itself is bounded: the directory is read entry by entry and only PNG-named regular
  // files count against the allowance, so unrelated entries cannot crowd a real output out. A
  // missing directory surfaces from open or (on Bun) from the first read; both mean "no outputs".
  let root: string;
  const names: string[] = [];
  try {
    root = resolveWithin(codexHome, "generated_images", threadId);
    const dir: Dir = opendirSync(root);
    try {
      for (let scanned = 0; scanned < MAX_SCANNED_ENTRIES && names.length < MAX_GENERATED_FILES; scanned += 1) {
        const entry = dir.readSync();
        if (entry === null) break;
        if (entry.isFile() && GENERATED_PNG_NAME.test(entry.name)) names.push(entry.name);
      }
    } finally {
      dir.closeSync();
    }
  } catch (error) {
    if (error instanceof PathBoundaryError || (error instanceof Error && "code" in error)) return [];
    throw error;
  }
  const hashes = new Set<string>();
  for (const name of names.sort()) {
    const hash = hashPngPath(name, root);
    if (hash !== null) hashes.add(hash);
  }
  return [...hashes];
}

/**
 * Hashes of the images a Codex image-tool item carries.
 *
 * The item's exact shape is undocumented and no captured trace exists in this repository, so this
 * scan is deliberately defensive: it walks the item to a bounded depth and hashes the two carriers
 * an image tool can plausibly report - a base64 PNG (bare or as a data: URL) and a .png path inside
 * the project directory. Prose, non-PNG blobs, paths outside the project and missing files are
 * ignored. The logo deliverable gate binds every candidate's bytes to these hashes, so a shape this
 * scan does not recognise fails closed (candidate_unprovenanced), never open.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_DEPTH = 4;
const MAX_STRINGS = 64;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_PATH_CHARS = 1024;
const BASE64 = /^[A-Za-z0-9+/]{16,}={0,2}$/;
const DATA_URL = /^data:image\/png;base64,/i;

export function collectImageOutputHashes(value: unknown, projectDir: string | undefined): string[] {
  const strings: string[] = [];
  walk(value, 0, strings);
  const hashes = new Set<string>();
  for (const text of strings) {
    const hash = hashBase64Png(text) ?? hashPngPath(text, projectDir);
    if (hash !== null) hashes.add(hash);
  }
  return [...hashes];
}

function walk(value: unknown, depth: number, out: string[]): void {
  if (out.length >= MAX_STRINGS || depth > MAX_DEPTH) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) walk(entry, depth + 1, out);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) walk(entry, depth + 1, out);
  }
}

function hashBase64Png(text: string): string | null {
  const body = text.replace(DATA_URL, "").trim();
  if (!BASE64.test(body) || body.length % 4 !== 0) return null;
  const bytes = Buffer.from(body, "base64");
  return isPng(bytes) ? sha256(bytes) : null;
}

function hashPngPath(text: string, projectDir: string | undefined): string | null {
  if (projectDir === undefined || text.length > MAX_PATH_CHARS || /[\r\n]/.test(text) || !/\.png$/i.test(text)) return null;
  const absolute = path.isAbsolute(text) ? text : path.resolve(projectDir, text);
  const relative = path.relative(projectDir, absolute);
  if (relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  try {
    const file = resolveWithin(projectDir, ...relative.split(/[\\/]+/).filter(Boolean));
    const info = statSync(file);
    if (!info.isFile() || info.size === 0 || info.size > MAX_FILE_BYTES) return null;
    const bytes = readFileSync(file);
    return isPng(bytes) ? sha256(bytes) : null;
  } catch (error) {
    if (error instanceof PathBoundaryError || (error instanceof Error && "code" in error)) return null;
    throw error;
  }
}

function isPng(bytes: Buffer): boolean {
  return bytes.length > PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
