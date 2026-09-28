import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, type FileHandle } from "node:fs/promises";
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
  files: 10_000,
} as const;

export interface BundleEntry {
  readonly file: ProjectBundleFile;
  readonly bytes: Uint8Array;
}

const PROJECT_EXCLUDED = [
  ".git", ".omc", ".claude", ".codex", ".meta/artifact-operations",
  ".meta/artifact-baseline",
] as const;
export async function collectProjectBundleEntries(root: string): Promise<readonly BundleEntry[]> {
  return collect(root, "project", projectFileKind, (relative) => {
    const folded = relative.toLocaleLowerCase("en-US");
    return PROJECT_EXCLUDED.some((excluded) => folded === excluded || folded.startsWith(`${excluded}/`)) ||
    (folded.startsWith(".meta/") && folded !== ".meta/checkpoints" && !folded.startsWith(".meta/checkpoints/")) ||
    isAgentControlPath(relative);
  });
}

export async function collectDesignSystemBundleEntries(root: string): Promise<readonly BundleEntry[]> {
  return collect(root, "design-system", () => "design_system", isAgentControlPath);
}

function projectFileKind(relative: string): ProjectBundleFileKind {
  const folded = relative.toLocaleLowerCase("en-US");
  if (folded.startsWith(".meta/checkpoints/")) {
    if (!relative.startsWith(".meta/checkpoints/")) throw new ProjectBundleError("invalid_project_bundle");
    return "checkpoint";
  }
  if (folded.startsWith(".attachments/") || folded.startsWith(".burnguard-inputs/")) {
    if (!relative.startsWith(".attachments/") && !relative.startsWith(".burnguard-inputs/")) {
      throw new ProjectBundleError("invalid_project_bundle");
    }
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

export async function readProjectBundleZip(file: File): Promise<{
  readonly manifest: ProjectBundleManifest;
  readonly entries: ReadonlyMap<string, Uint8Array>;
}> {
  if (file.size > PROJECT_BUNDLE_LIMITS.upload_bytes) throw new ProjectBundleError("project_bundle_limit");
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(await file.arrayBuffer()); }
  catch { throw new ProjectBundleError("invalid_project_bundle"); }
  const objects = Object.values(zip.files);
  if (objects.length > PROJECT_BUNDLE_LIMITS.files + 64) throw new ProjectBundleError("project_bundle_limit");
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
  const expected = new Map(manifest.files.map((entry) => [entry.path, entry]));
  const actualFiles = objects.filter((entry) => !entry.dir && entry.name !== PROJECT_BUNDLE_MANIFEST_PATH);
  if (actualFiles.length !== expected.size || actualFiles.some((entry) => !expected.has(archivePath(entry)))) {
    throw new ProjectBundleError("invalid_project_bundle");
  }
  let remaining = PROJECT_BUNDLE_LIMITS.expanded_bytes;
  const entries = new Map<string, Uint8Array>();
  for (const expectedFile of manifest.files) {
    if (expectedFile.size_bytes > remaining) throw new ProjectBundleError("project_bundle_limit");
    const object = zip.file(expectedFile.path);
    if (!object || object.dir || isSymlink(object)) throw new ProjectBundleError("invalid_project_bundle");
    const bytes = await boundedZip(object, remaining);
    remaining -= bytes.byteLength;
    if (bytes.byteLength !== expectedFile.size_bytes ||
      createHash("sha256").update(bytes).digest("hex") !== expectedFile.sha256) {
      throw new ProjectBundleError("project_bundle_digest");
    }
    entries.set(expectedFile.path, bytes);
  }
  return { manifest, entries };
}

async function collect(
  root: string,
  prefix: string,
  kind: (relative: string) => ProjectBundleFileKind,
  excluded: (relative: string) => boolean,
): Promise<readonly BundleEntry[]> {
  const output: BundleEntry[] = [];
  let total = 0;
  const visit = async (directory: string): Promise<void> => {
    const children = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
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
      if (output.length >= PROJECT_BUNDLE_LIMITS.files) throw new ProjectBundleError("project_bundle_limit");
      total += info.size;
      if (total > PROJECT_BUNDLE_LIMITS.expanded_bytes) throw new ProjectBundleError("project_bundle_limit");
      const bytes = await readStableFile(absolute, info);
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

async function readStableFile(absolute: string, original: Awaited<ReturnType<typeof lstat>>): Promise<Uint8Array> {
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.dev !== original.dev || before.ino !== original.ino) {
      throw new ProjectBundleError("invalid_project_bundle");
    }
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
