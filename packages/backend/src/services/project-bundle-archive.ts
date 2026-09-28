import { createHash } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import JSZip from "jszip";
import {
  PROJECT_BUNDLE_MANIFEST_PATH,
  parseProjectBundleManifest,
  type ProjectBundleFile,
  type ProjectBundleFileKind,
  type ProjectBundleManifest,
} from "@bg/shared";
import { isAgentControlPath } from "../security/agent-control-files";
import { PathBoundaryError, assertSafeName, resolveWithin } from "../security/path-boundary";
import { ProjectBundleError } from "./project-bundle-error";
import { isProjectBundleCredentialPath, isProjectBundleProtectedPath } from "./project-bundle-path-policy";

export const PROJECT_BUNDLE_LIMITS = {
  upload_bytes: 48 * 1024 * 1024,
  expanded_bytes: 128 * 1024 * 1024,
  entry_bytes: 32 * 1024 * 1024,
  files: 10_000,
} as const;

/** Shared across the project and design-system trees so export can never exceed what import accepts. */
export type BundleBudget = { files: number; bytes: number };
export function createBundleBudget(): BundleBudget { return { files: 0, bytes: 0 }; }

export interface BundleEntry {
  readonly file: ProjectBundleFile;
  readonly bytes: Uint8Array;
}

const PROJECT_EXCLUDED = [
  ".git", ".omc", ".claude", ".codex", ".burnguard-inputs", ".meta/artifact-operations",
  ".meta/artifact-baseline",
] as const;
export async function collectProjectBundleEntries(root: string, budget: BundleBudget = createBundleBudget()): Promise<readonly BundleEntry[]> {
  return collect(root, "project", budget, projectFileKind, (relative) => {
    const folded = relative.toLocaleLowerCase("en-US");
    return PROJECT_EXCLUDED.some((excluded) => folded === excluded || folded.startsWith(`${excluded}/`)) ||
    (folded.startsWith(".meta/") && folded !== ".meta/checkpoints" && !folded.startsWith(".meta/checkpoints/")) ||
    isAgentControlPath(relative);
  });
}

export async function collectDesignSystemBundleEntries(root: string, budget: BundleBudget = createBundleBudget()): Promise<readonly BundleEntry[]> {
  return collect(root, "design-system", budget, () => "design_system", isAgentControlPath);
}

function projectFileKind(relative: string): ProjectBundleFileKind {
  const folded = relative.toLocaleLowerCase("en-US");
  if (folded.startsWith(".meta/checkpoints/")) {
    if (!relative.startsWith(".meta/checkpoints/")) throw new ProjectBundleError("invalid_project_bundle");
    return "checkpoint";
  }
  if (folded === ".burnguard-inputs" || folded.startsWith(".burnguard-inputs/")) throw new ProjectBundleError("invalid_project_bundle");
  if (folded.startsWith(".attachments/")) {
    if (!relative.startsWith(".attachments/")) throw new ProjectBundleError("invalid_project_bundle");
    return "attachment";
  }
  return "project";
}

export async function createProjectBundleZip(
  manifest: ProjectBundleManifest,
  entries: readonly BundleEntry[],
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const entry of entries) zip.file(entry.file.path, entry.bytes);
  zip.file(PROJECT_BUNDLE_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  if (bytes.byteLength > PROJECT_BUNDLE_LIMITS.upload_bytes) throw new ProjectBundleError("project_bundle_limit");
  return bytes;
}

export async function readProjectBundleZip(
  file: File,
  stagingRoot: string,
  validateMetadata: (manifest: ProjectBundleManifest) => void,
): Promise<{
  readonly manifest: ProjectBundleManifest;
  readonly entries: ReadonlyMap<string, string>;
}> {
  if (file.size > PROJECT_BUNDLE_LIMITS.upload_bytes) throw new ProjectBundleError("project_bundle_limit");
  const archive = new Uint8Array(await file.arrayBuffer());
  const declared = inspectCentralDirectory(archive);
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(archive); }
  catch { throw new ProjectBundleError("invalid_project_bundle"); }
  const objects = Object.values(zip.files);
  if (objects.filter((entry) => !entry.dir).length !== [...declared.values()].filter((entry) => !entry.directory).length) {
    throw new ProjectBundleError("invalid_project_bundle");
  }
  for (const entry of objects) {
    archivePath(entry);
    if (isSymlink(entry)) throw new ProjectBundleError("invalid_project_bundle");
  }
  const manifestObject = zip.file(PROJECT_BUNDLE_MANIFEST_PATH);
  if (!manifestObject || manifestObject.dir) throw new ProjectBundleError("invalid_project_bundle");
  let manifest: ProjectBundleManifest;
  try {
    const bytes = await boundedZip(manifestObject, 2 * 1024 * 1024);
    manifest = parseProjectBundleManifest(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    if (error instanceof ProjectBundleError) throw error;
    throw new ProjectBundleError("invalid_project_bundle");
  }
  if (manifest.files.some((entry) => /^project\/\.burnguard-inputs(?:\/|$)/iu.test(entry.path))) {
    throw new ProjectBundleError("invalid_project_bundle");
  }
  validateMetadata(manifest);
  const expected = new Map(manifest.files.map((entry) => [entry.path, entry]));
  const actualFiles = objects.filter((entry) => !entry.dir && entry.name !== PROJECT_BUNDLE_MANIFEST_PATH);
  if (actualFiles.length !== expected.size || actualFiles.some((entry) => !expected.has(archivePath(entry)))) {
    throw new ProjectBundleError("invalid_project_bundle");
  }
  let remaining = PROJECT_BUNDLE_LIMITS.expanded_bytes;
  const entries = new Map<string, string>();
  for (const expectedFile of manifest.files) {
    if (expectedFile.size_bytes > remaining || expectedFile.size_bytes > PROJECT_BUNDLE_LIMITS.entry_bytes) throw new ProjectBundleError("project_bundle_limit");
    if (declared.get(expectedFile.path)?.size !== expectedFile.size_bytes) throw new ProjectBundleError("invalid_project_bundle");
    const object = zip.file(expectedFile.path);
    if (!object || object.dir || isSymlink(object)) throw new ProjectBundleError("invalid_project_bundle");
    const target = resolveWithin(stagingRoot, ...expectedFile.path.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    const written = await boundedZipToFile(object, target, expectedFile.size_bytes + 1);
    remaining -= written.size;
    if (written.size !== expectedFile.size_bytes || written.sha256 !== expectedFile.sha256) {
      throw new ProjectBundleError("project_bundle_digest");
    }
    entries.set(expectedFile.path, target);
  }
  return { manifest, entries };
}

async function collect(
  root: string,
  prefix: string,
  budget: BundleBudget,
  kind: (relative: string) => ProjectBundleFileKind,
  excluded: (relative: string) => boolean,
): Promise<readonly BundleEntry[]> {
  const output: BundleEntry[] = [];
  const realRoot = await realpath(resolveWithin(root));
  const visit = async (directory: string): Promise<void> => {
    const before = await verifiedDirectory(directory, realRoot);
    const children = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    const after = await verifiedDirectory(directory, realRoot);
    if (after.dev !== before.dev || after.ino !== before.ino) throw new ProjectBundleError("invalid_project_bundle");
    for (const child of children) {
      const absolute = resolveWithin(root, path.relative(root, directory), child.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/").normalize("NFC");
      if (excluded(relative)) continue;
      if (isProjectBundleCredentialPath(relative)) throw new ProjectBundleError("project_bundle_credentials");
      if (isProjectBundleProtectedPath(relative)) continue;
      try { relative.split("/").forEach(assertSafeName); }
      catch (error) {
        if (error instanceof PathBoundaryError) throw new ProjectBundleError("invalid_project_bundle");
        throw error;
      }
      const info = await lstat(absolute);
      if (child.isSymbolicLink() || info.isSymbolicLink()) throw new ProjectBundleError("invalid_project_bundle");
      if (info.isDirectory()) { await visit(absolute); continue; }
      if (!info.isFile() || info.nlink !== 1) throw new ProjectBundleError("invalid_project_bundle");
      budget.files += 1;
      budget.bytes += info.size;
      if (budget.files > PROJECT_BUNDLE_LIMITS.files || budget.bytes > PROJECT_BUNDLE_LIMITS.expanded_bytes ||
        info.size > PROJECT_BUNDLE_LIMITS.entry_bytes) throw new ProjectBundleError("project_bundle_limit");
      const bytes = await readStableFile(absolute, info, path.join(realRoot, path.relative(root, absolute)));
      output.push({
        file: {
          path: `${prefix}/${relative}`,
          kind: kind(relative),
          size_bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
        bytes,
      });
    }
  };
  await visit(resolveWithin(root));
  return output;
}

/**
 * Node has no openat(), so a directory swapped for a link between checks is caught by re-verifying
 * identity around each readdir and by requiring every opened file's real path to be exactly its
 * expected managed path.
 */
async function verifiedDirectory(directory: string, realRoot: string): Promise<Awaited<ReturnType<typeof lstat>>> {
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new ProjectBundleError("invalid_project_bundle");
  const real = await realpath(directory);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new ProjectBundleError("invalid_project_bundle");
  return info;
}

async function readStableFile(absolute: string, original: Awaited<ReturnType<typeof lstat>>, expectedReal: string): Promise<Uint8Array> {
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.dev !== original.dev || before.ino !== original.ino) {
      throw new ProjectBundleError("invalid_project_bundle");
    }
    if (await realpath(absolute) !== expectedReal) throw new ProjectBundleError("invalid_project_bundle");
    const bytes = await readHandle(handle, before.size);
    const after = await handle.stat();
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new ProjectBundleError("invalid_project_bundle");
    }
    return bytes;
  } finally { await handle.close(); }
}

async function readHandle(handle: FileHandle, size: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(bytes, offset, size - offset, offset);
    if (result.bytesRead === 0) break;
    offset += result.bytesRead;
  }
  if (offset !== size) throw new ProjectBundleError("invalid_project_bundle");
  return bytes;
}

function archivePath(entry: JSZip.JSZipObject): string {
  const raw = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
  const value = raw.replace(/\/$/, "");
  if (!value || value.length > 1024 || value.includes("\\") || value.startsWith("/") || value.normalize("NFC") !== value) {
    throw new ProjectBundleError("invalid_project_bundle");
  }
  const parts = value.split("/");
  if (parts.length > 32 || parts.some((part) => !part || part === "." || part === "..")) throw new ProjectBundleError("invalid_project_bundle");
  return value;
}

function isSymlink(entry: JSZip.JSZipObject): boolean {
  return entry.unixPermissions !== null && (Number(entry.unixPermissions) & 0xf000) === 0xa000;
}

function boundedZip(file: JSZip.JSZipObject, limit: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Uint8Array[] = [];
    const stream = file.nodeStream("nodebuffer");
    stream.on("data", (chunk: Uint8Array) => {
      size += chunk.length;
      if (size > limit) {
        stream.pause();
        if (stream instanceof Readable) stream.destroy();
        reject(new ProjectBundleError("project_bundle_limit"));
      } else chunks.push(chunk);
    });
    stream.on("error", () => reject(new ProjectBundleError("invalid_project_bundle")));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.resume();
  });
}

type CentralEntry = { readonly size: number; readonly directory: boolean };

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/**
 * Validates every raw central-directory record before JSZip normalizes names or collapses
 * duplicates: raw and case-folded uniqueness, path policy, symlink/encryption/method bans,
 * ZIP64 rejection, entry count and declared per-entry/aggregate expansion limits.
 */
export function inspectCentralDirectory(archive: Uint8Array): ReadonlyMap<string, CentralEntry> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const invalid = (): never => { throw new ProjectBundleError("invalid_project_bundle"); };
  let eocd = -1;
  for (let offset = archive.byteLength - 22; offset >= Math.max(0, archive.byteLength - 22 - 0xffff); offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) { eocd = offset; break; }
  }
  if (eocd < 0) invalid();
  const count = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 8, true) !== count ||
    count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) invalid();
  if (count > PROJECT_BUNDLE_LIMITS.files * 2 + 1) throw new ProjectBundleError("project_bundle_limit");
  if (directoryOffset + directorySize > eocd) invalid();
  const entries = new Map<string, CentralEntry>();
  const folded = new Set<string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let fileRecords = 0;
  let directoryRecords = 0;
  let cursor = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > directoryOffset + directorySize || view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) invalid();
    const madeBy = view.getUint16(cursor + 4, true) >> 8;
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    const nameStart = cursor + 46;
    if (nameStart + nameLength > directoryOffset + directorySize) invalid();
    const rawName = archive.subarray(nameStart, nameStart + nameLength);
    if ((flags & 0x0800) === 0 && rawName.some((byte) => byte > 0x7f)) invalid();
    let name: string;
    try { name = decoder.decode(rawName); }
    catch (error) { if (error instanceof TypeError) invalid(); throw error; }
    if ((flags & 0x0001) !== 0 || (method !== 0 && method !== 8) || compressed === 0xffffffff || size === 0xffffffff) invalid();
    if (madeBy === 3 && ((externalAttributes >>> 16) & 0xf000) === 0xa000) invalid();
    const directory = name.endsWith("/");
    const normalized = directory ? name.slice(0, -1) : name;
    if (!normalized || normalized.length > 1024 || normalized.includes("\\") || normalized.startsWith("/") ||
      /^[a-z]:/iu.test(normalized) || normalized.normalize("NFC") !== normalized) invalid();
    const parts = normalized.split("/");
    if (parts.length > 32 || parts.some((part) => !part || part === "." || part === "..")) invalid();
    for (const part of parts) {
      try { assertSafeName(part); }
      catch (error) { if (error instanceof PathBoundaryError) invalid(); throw error; }
    }
    const key = normalized.toLocaleLowerCase("en-US");
    if (entries.has(normalized) || folded.has(key)) invalid();
    folded.add(key);
    if (directory) directoryRecords += 1; else fileRecords += 1;
    // One extra file record is the manifest; directory records are counted separately from payload files.
    if (fileRecords > PROJECT_BUNDLE_LIMITS.files + 1 || directoryRecords > PROJECT_BUNDLE_LIMITS.files) throw new ProjectBundleError("project_bundle_limit");
    if (!directory) {
      if (size > PROJECT_BUNDLE_LIMITS.entry_bytes) throw new ProjectBundleError("project_bundle_limit");
      total += size;
      if (total > PROJECT_BUNDLE_LIMITS.expanded_bytes + 2 * 1024 * 1024) throw new ProjectBundleError("project_bundle_limit");
    } else if (size !== 0) invalid();
    entries.set(normalized, { size, directory });
    cursor = nameStart + nameLength + extraLength + commentLength;
  }
  if (cursor !== directoryOffset + directorySize) invalid();
  return entries;
}

function boundedZipToFile(file: JSZip.JSZipObject, target: string, limit: number): Promise<{ readonly size: number; readonly sha256: string }> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const hash = createHash("sha256");
    const fail = (error: ProjectBundleError): void => {
      if (settled) return;
      settled = true;
      if (source instanceof Readable) source.destroy();
      sink.destroy();
      reject(error);
    };
    const sink = createWriteStream(target, { flags: "wx" });
    const source = file.nodeStream("nodebuffer");
    source.on("data", (chunk: Uint8Array) => {
      size += chunk.length;
      if (size > limit) { fail(new ProjectBundleError("project_bundle_limit")); return; }
      hash.update(chunk);
      if (!sink.write(chunk)) { source.pause(); sink.once("drain", () => source.resume()); }
    });
    source.on("error", () => fail(new ProjectBundleError("invalid_project_bundle")));
    sink.on("error", () => fail(new ProjectBundleError("project_bundle_unavailable")));
    source.on("end", () => sink.end());
    sink.on("finish", () => {
      if (settled) return;
      settled = true;
      resolve({ size, sha256: hash.digest("hex") });
    });
    source.resume();
  });
}
