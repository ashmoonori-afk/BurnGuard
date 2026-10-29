import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import path from "node:path";
import { resolveManagedPath } from "../lib/paths";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import { type ManagedTreeIo, syncManagedTree } from "./artifact-tree-storage";
import { DEFAULT_CANONICAL_TREE_LIMITS, inspectCanonicalTree, type CanonicalTreeManifest } from "./canonical-tree-manifest";
import { contentHash, contentPath, operationId as parseOperationId, SystemContentError } from "./system-content-format";

export type PreservationEntry = readonly [kind: "directory" | "file", path: string, size: number, sha256: string | null];
export type ContentTree = {
  readonly manifest: CanonicalTreeManifest; readonly preservation_digest: string; readonly inventory: readonly PreservationEntry[];
};
function unsafe(): never { throw new SystemContentError("system_content_conflict"); }
export async function pathStat(target: string): Promise<Stats | null> {
  try { return await lstat(target); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}
export async function requireDirectory(target: string): Promise<void> {
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink()) unsafe();
}
/** Check lexical components before realpath-based containment can resolve a link away. */
export async function safeContentChild(root: string, ...parts: readonly string[]): Promise<string> {
  await requireDirectory(root);
  let candidate = root;
  for (const part of parts) {
    assertSafeName(part);
    candidate = path.join(candidate, part);
    const info = await pathStat(candidate);
    if (info?.isSymbolicLink()) unsafe();
  }
  return resolveWithin(root, ...parts);
}
export async function readPreservedFile(root: string, relative: string, expected?: PreservationEntry, maximumBytes = DEFAULT_CANONICAL_TREE_LIMITS.bytes): Promise<Buffer> {
  const parts = relative.split("/");
  const target = await safeContentChild(root, ...parts);
  const original = await lstat(target);
  if (!original.isFile() || original.nlink !== 1 || original.size > maximumBytes) unsafe();
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.ino !== original.ino || before.dev !== original.dev || before.size !== original.size) unsafe();
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) unsafe();
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(target);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.nlink !== 1 || current.ino !== before.ino || current.dev !== before.dev || current.isSymbolicLink() || current.nlink !== 1) unsafe();
    if (expected !== undefined && (expected[0] !== "file" || expected[2] !== bytes.length || expected[3] !== contentHash(bytes))) unsafe();
    return bytes;
  } finally { await handle.close(); }
}
export async function inspectContentTree(root: string): Promise<ContentTree> {
  await requireDirectory(root);
  const inventory: PreservationEntry[] = [];
  const names = new Set<string>();
  let bytes = 0;
  let files = 0;
  const visit = async (relative: readonly string[]): Promise<void> => {
    const directory = await safeContentChild(root, ...relative);
    for (const name of (await readdir(directory)).sort()) {
      assertSafeName(name);
      const parts = [...relative, name];
      const diskRelative = parts.join("/");
      const folded = diskRelative.normalize("NFC").toLowerCase();
      if (names.has(folded) || names.size >= 20_000) unsafe();
      names.add(folded);
      const target = await safeContentChild(root, ...parts);
      const info = await lstat(target);
      if (info.isDirectory()) {
        inventory.push(["directory", diskRelative, 0, null]);
        await visit(parts);
      } else {
        if (!info.isFile() || info.nlink !== 1 || ++files > DEFAULT_CANONICAL_TREE_LIMITS.files) unsafe();
        bytes += info.size;
        if (bytes > DEFAULT_CANONICAL_TREE_LIMITS.bytes) unsafe();
        const payload = await readPreservedFile(root, diskRelative);
        if (payload.length !== info.size) unsafe();
        inventory.push(["file", diskRelative, payload.length, contentHash(payload)]);
      }
    }
  };
  await visit([]);
  inventory.sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
  const manifest = await inspectCanonicalTree(root);
  return { manifest, inventory, preservation_digest: contentHash(JSON.stringify(["system-content-preservation-v1", inventory])) };
}
export async function cloneContentTree(source: string, destination: string, base: ContentTree): Promise<void> {
  await mkdir(destination);
  for (const entry of base.inventory) {
    const target = await safeContentChild(destination, ...entry[1].split("/"));
    if (entry[0] === "directory") { await mkdir(target); continue; }
    const bytes = await readPreservedFile(source, entry[1], entry);
    const handle = await open(target, "wx");
    try { await handle.writeFile(bytes); } finally { await handle.close(); }
  }
  if ((await inspectContentTree(destination)).preservation_digest !== base.preservation_digest) unsafe();
}
export function verifyContentWriteSet(before: ContentTree | null, after: ContentTree, writeSet: readonly string[]): readonly string[] {
  const old = new Map((before?.inventory ?? []).map((entry) => [entry[1], entry]));
  const next = new Map(after.inventory.map((entry) => [entry[1], entry]));
  const changed: string[] = [];
  for (const name of [...new Set([...old.keys(), ...next.keys()])].sort()) {
    const a = old.get(name);
    const b = next.get(name);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (a?.[0] === "directory" || b?.[0] === "directory") {
      // A writer may create/remove only directories needed by its exact file changes.
      if (a !== undefined && b !== undefined || !writeSet.some((file) => file.startsWith(`${name}/`))) unsafe();
      continue;
    }
    changed.push(contentPath(name));
  }
  if (changed.length !== writeSet.length || changed.some((name, index) => name !== writeSet[index])) unsafe();
  return changed;
}
/** Canonical flushing plus every excluded payload and every empty directory. */
export async function syncContentTree(root: string, tree: ContentTree, io: ManagedTreeIo): Promise<void> {
  await syncManagedTree(root, io);
  const canonical = new Set(tree.manifest.files.map((entry) => entry.path));
  for (const entry of tree.inventory) {
    if (entry[0] !== "file" || canonical.has(entry[1].normalize("NFC"))) continue;
    const target = await safeContentChild(root, ...entry[1].split("/"));
    let handle;
    try { handle = await (io.openForSync ?? open)(target, io.syncOpenMode); }
    catch (error) {
      if (io.syncOpenMode === "r+" && error instanceof Error && "code" in error && (error.code === "EPERM" || error.code === "EACCES")) continue;
      throw error;
    }
    try { await io.syncFile(handle); } finally { await handle.close(); }
  }
  for (const entry of [...tree.inventory].reverse()) if (entry[0] === "directory") await io.syncDirectory(await safeContentChild(root, ...entry[1].split("/")));
  await io.syncDirectory(root);
}
export async function contentPaths(root: string, systemId: string, operationId: string) {
  if (systemId.startsWith(".")) unsafe();
  parseOperationId(operationId);
  const live = await safeContentChild(root, assertSafeName(systemId));
  const controls = await safeContentChild(root, ".system-content");
  const control = await safeContentChild(root, ".system-content", assertSafeName(operationId));
  const derive = (name: string) => resolveWithin(root, ".system-content", operationId, name);
  if (resolveManagedPath(root, live) !== live) unsafe();
  return { live, controls, control, owner: derive("owner.json"), stage: derive("stage"), previous: derive("previous"), discard: derive("discard") };
}
