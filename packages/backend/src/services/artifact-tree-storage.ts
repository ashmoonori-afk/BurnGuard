import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rename, rm, unlink, writeFile, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { CanonicalTreeEntry, CanonicalTreeManifest } from "./canonical-tree-manifest";
import { DEFAULT_CANONICAL_TREE_LIMITS, diskPathOf, inspectCanonicalTree, inspectCanonicalTreeOnDisk, validateCanonicalTree } from "./canonical-tree-manifest";
import { isProjectDocumentPath } from "./project-document-paths";
import { assertSafeName, resolveWithin } from "../security/path-boundary";

export type ArtifactFileDiff = {
  readonly path: string;
  readonly action: "created" | "edited" | "deleted";
  readonly before_hash: string | null;
  readonly after_hash: string | null;
  readonly before_bytes: number;
  readonly after_bytes: number;
};

export type PublicationPolicy = {
  readonly forbiddenSha256?: ReadonlySet<string>;
  readonly immutableReferencePaths?: ReadonlyMap<string, ReadonlySet<string>>;
  readonly beforeSourceOpen?: (relativePath: string) => void | Promise<void>;
  readonly beforeSourceRead?: (relativePath: string) => void | Promise<void>;
};

export class ArtifactPublicationPolicyError extends Error {
  readonly name = "ArtifactPublicationPolicyError";
  readonly code = "immutable_reference_escaped" as const;
  constructor() { super("immutable_reference_escaped"); }
}

export async function materializeManagedTree(source: string, destination: string): Promise<CanonicalTreeManifest> {
  const tree = await inspectCanonicalTreeOnDisk(source);
  const manifest = tree.manifest;
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const file of manifest.files) {
    const target = path.join(destination, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(diskPathOf(source, tree, file.path)));
  }
  return validateCanonicalTree(destination, manifest);
}

export function diffManagedTrees(before: CanonicalTreeManifest, after: CanonicalTreeManifest): readonly ArtifactFileDiff[] {
  const beforeByPath = new Map(before.files.map((file) => [file.path, file]));
  const afterByPath = new Map(after.files.map((file) => [file.path, file]));
  const paths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].sort(compareText);
  const changes: ArtifactFileDiff[] = [];
  for (const filePath of paths) {
    const previous = beforeByPath.get(filePath);
    const next = afterByPath.get(filePath);
    if (previous?.sha256 === next?.sha256 && previous?.size === next?.size) continue;
    changes.push({ path: filePath, action: previous === undefined ? "created" : next === undefined ? "deleted" : "edited", before_hash: previous?.sha256 ?? null, after_hash: next?.sha256 ?? null, before_bytes: previous?.size ?? 0, after_bytes: next?.size ?? 0 });
  }
  return changes;
}

export async function publishManagedTree(
  source: string,
  destination: string,
  afterWrite?: (relativePath: string) => void,
  policy: PublicationPolicy = {},
): Promise<CanonicalTreeManifest> {
  const sourceTree = await inspectCanonicalTreeOnDisk(source);
  const sourceManifest = sourceTree.manifest;
  const opened = await openPublicationSources(source, sourceManifest.files, policy, sourceTree.diskPaths);
  try {
    const destinationTree = await inspectCanonicalTreeOnDisk(destination);
    const sourcePaths = new Set(sourceManifest.files.map((file) => file.path));
    for (const file of [...destinationTree.manifest.files].reverse()) {
      // A name that is not NFC on disk goes too: it is rewritten under its manifest path below, and leaving it would
      // put two spellings of one path side by side on file systems that keep them apart.
      if (!sourcePaths.has(file.path) || destinationTree.diskPaths.has(file.path)) await unlink(diskPathOf(destination, destinationTree, file.path));
    }
    // A removed directory can become a file in the same publication.
    await removeEmptyManagedDirectories(destination);
    // A decomposed directory kept alive by a skipped file (an agent file) takes its NFC name, so the files written
    // below land beside that file instead of in a second spelling of the same directory.
    await renameDecomposedDirectories(destination);
    for (const candidate of opened) {
      const target = path.join(destination, candidate.file.path);
      await mkdir(path.dirname(target), { recursive: true });
      const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
      try {
        await writeFile(temporary, candidate.bytes);
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
      afterWrite?.(candidate.file.path);
    }
  } finally {
    await Promise.all(opened.map((candidate) => candidate.handle.close()));
  }
  await removeEmptyManagedDirectories(destination);
  return validateCanonicalTree(destination, sourceManifest);
}

/** `diskPaths` is the on-disk spelling of entries whose name is not NFC there (`inspectCanonicalTreeOnDisk`). */
export async function readManagedFile(source: string, file: CanonicalTreeEntry, policy: PublicationPolicy = {}, diskPaths: ReadonlyMap<string, string> = new Map()): Promise<Buffer<ArrayBuffer>> {
  const opened = await openPublicationSources(source, [file], policy, diskPaths);
  try { return Buffer.from(opened[0]!.bytes); }
  finally { await opened[0]!.handle.close(); }
}

async function verifySourcePath(source: string, relativePath: string) {
  const parts = relativePath.split("/").map(assertSafeName);
  let current = source;
  for (const part of ["", ...parts]) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (current !== path.join(source, ...parts) && !info.isDirectory())) throw new Error("Publication source path changed");
  }
  resolveWithin(source, ...parts);
  return lstat(current);
}

async function openPublicationSources(
  source: string,
  files: readonly CanonicalTreeEntry[],
  policy: PublicationPolicy,
  diskPaths: ReadonlyMap<string, string>,
): Promise<readonly { readonly file: CanonicalTreeEntry; readonly handle: FileHandle; readonly bytes: Uint8Array }[]> {
  const opened: { file: CanonicalTreeEntry; handle: FileHandle; bytes: Uint8Array }[] = [];
  try {
    for (const file of files) {
      // A decomposed (NFD) name is not found through its NFC manifest path on ext4 and NTFS.
      const onDisk = diskPaths.get(file.path) ?? file.path;
      await policy.beforeSourceOpen?.(file.path);
      const original = await verifySourcePath(source, onDisk);
      const handle = await open(path.join(source, onDisk), constants.O_RDONLY | constants.O_NOFOLLOW);
      opened.push({ file, handle, bytes: new Uint8Array() });
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.dev !== original.dev || before.ino !== original.ino || before.size !== file.size || before.size > DEFAULT_CANONICAL_TREE_LIMITS.bytes) throw new Error("Publication source identity changed");
      await policy.beforeSourceRead?.(file.path);
      const bytes = await readHandleBytes(handle, file.size);
      const after = await handle.stat();
      const current = await verifySourcePath(source, onDisk);
      if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.nlink !== 1 || current.dev !== before.dev || current.ino !== before.ino || current.nlink !== 1 || bytes.byteLength !== file.size) throw new Error("Publication source identity changed");
      const digest = createHash("sha256").update(bytes).digest("hex");
      const immutablePaths = policy.immutableReferencePaths?.get(digest);
      const registeredImmutablePath = immutablePaths?.has(file.path) === true;
      if (
        (policy.forbiddenSha256?.has(digest) && !registeredImmutablePath) ||
        (immutablePaths !== undefined && !registeredImmutablePath)
      ) throw new ArtifactPublicationPolicyError();
      if (digest !== file.sha256) throw new Error("Publication source identity changed");
      opened[opened.length - 1] = { file, handle, bytes };
    }
    return opened;
  } catch (error) {
    await Promise.all(opened.map((candidate) => candidate.handle.close()));
    throw error;
  }
}

async function readHandleBytes(handle: FileHandle, size: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return offset === size ? bytes : bytes.subarray(0, offset);
}

export function manifestEntry(manifest: CanonicalTreeManifest, relativePath: string): CanonicalTreeEntry | null {
  return manifest.files.find((file) => file.path === relativePath) ?? null;
}

async function removeEmptyManagedDirectories(root: string, current = root): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (!entry.isDirectory() || (current === root && isExcluded(entry.name))) continue;
    const target = path.join(current, entry.name);
    if (isProjectDocumentPath(path.relative(root, target))) continue;
    await removeEmptyManagedDirectories(root, target);
    if ((await readdir(target)).length === 0) await rm(target, { recursive: true });
  }
}

async function renameDecomposedDirectories(root: string, current = root): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (!entry.isDirectory() || (current === root && isExcluded(entry.name))) continue;
    let target = path.join(current, entry.name);
    if (isProjectDocumentPath(path.relative(root, target))) continue;
    const composed = path.join(current, entry.name.normalize("NFC"));
    // APFS finds the NFC spelling of the same directory; a distinct NFC directory is left as it is.
    if (composed !== target && !(await pathExists(composed))) {
      await rename(target, composed);
      target = composed;
    }
    await renameDecomposedDirectories(root, target);
  }
}

async function pathExists(target: string): Promise<boolean> {
  try { await lstat(target); return true; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function isExcluded(name: string): boolean {
  return name === ".meta" || name === ".attachments" || name === ".burnguard-inputs" || name === ".git" || name === ".omc" || name === ".claude" || name === ".codex";
}

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
