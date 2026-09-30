import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PathBoundaryError, resolveWithin } from "../security/path-boundary";
import { isAgentControlPath } from "../security/agent-control-files";
import { isProjectDocumentPath } from "./project-document-paths";

const SHA256 = /^[0-9a-f]{64}$/;
const OWNED_EPHEMERAL_FILES = new Set([".burnguard-publication", ".burnguard-catalog"]);
const EXCLUDED_PROJECT_DIRECTORIES = new Set([".meta", ".attachments", ".burnguard-inputs", ".git", ".omc", ".claude", ".codex"]);

export type CanonicalTreeEntry = {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
};

export type CanonicalTreeManifest = {
  readonly schema_version: 1;
  readonly digest_algorithm: "sha256";
  readonly tree_digest: string;
  readonly files: readonly CanonicalTreeEntry[];
  readonly publication_state: "validated";
};

export type CanonicalTreeLimits = {
  readonly files: number;
  readonly bytes: number;
};

export const DEFAULT_CANONICAL_TREE_LIMITS = {
  files: 10_000,
  bytes: 128 * 1024 * 1024,
} as const satisfies CanonicalTreeLimits;

export class CanonicalTreeManifestError extends Error {
  readonly name = "CanonicalTreeManifestError";
  constructor(
    readonly code: "tree_missing" | "unsafe_tree_entry" | "tree_limit_exceeded" | "manifest_unverifiable" | "tree_mismatch",
    message: string,
  ) {
    super(message);
  }
}

/** Distinguish an absent root from unsafe entries or unavailable recovery receipts. */
export async function isCanonicalTreeRootMissing(root: string): Promise<boolean> {
  try { await lstat(root); return false; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return true;
    throw error;
  }
}

export type InspectedCanonicalTree = {
  readonly manifest: CanonicalTreeManifest;
  /** Manifest path -> the spelling the file system returned, for entries whose on-disk name is not NFC. */
  readonly diskPaths: ReadonlyMap<string, string>;
};

/**
 * Where a manifest entry lives on disk. A decomposed (NFD) name is not found through its NFC manifest path on
 * file systems that do not normalize names (ext4, NTFS), so live files are addressed by their on-disk spelling.
 */
export function diskPathOf(root: string, tree: InspectedCanonicalTree, manifestPath: string, flavor: Pick<typeof path, "join"> = path): string {
  return flavor.join(root, tree.diskPaths.get(manifestPath) ?? manifestPath);
}

export async function inspectCanonicalTree(
  root: string,
  limits: CanonicalTreeLimits = DEFAULT_CANONICAL_TREE_LIMITS,
): Promise<CanonicalTreeManifest> {
  return (await inspectCanonicalTreeOnDisk(root, limits)).manifest;
}

export async function inspectCanonicalTreeOnDisk(
  root: string,
  limits: CanonicalTreeLimits = DEFAULT_CANONICAL_TREE_LIMITS,
): Promise<InspectedCanonicalTree> {
  const rootInfo = await lstat(root).catch(() => null);
  if (rootInfo?.isSymbolicLink()) throw new CanonicalTreeManifestError("unsafe_tree_entry", "Canonical tree root cannot be a link");
  if (!rootInfo?.isDirectory()) throw new CanonicalTreeManifestError("tree_missing", "Canonical tree directory is missing");
  const files: CanonicalTreeEntry[] = [];
  const diskPaths = new Map<string, string>();
  const canonicalPaths = new Set<string>();
  let bytes = 0;
  const visit = async (base: string, directory: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const target = resolveWithin(base, path.relative(base, directory), entry.name);
      const info = await lstat(target);
      const relativePath = canonicalTreePath(base, target);
      const topLevel = relativePath.split("/")[0];
      if (topLevel !== undefined && EXCLUDED_PROJECT_DIRECTORIES.has(topLevel)) continue;
      if (
        OWNED_EPHEMERAL_FILES.has(relativePath) ||
        isProjectDocumentPath(relativePath) ||
        isAgentControlPath(relativePath)
      ) {
        continue;
      }
      if (entry.isSymbolicLink() || info.isSymbolicLink()) throw new CanonicalTreeManifestError("unsafe_tree_entry", "Canonical tree cannot contain links");
      if (info.isDirectory()) {
        await visit(base, target);
        continue;
      }
      if (!info.isFile() || info.nlink > 1) throw new CanonicalTreeManifestError("unsafe_tree_entry", "Canonical tree contains an unsafe file");
      const canonicalPath = relativePath.normalize("NFC").toLocaleLowerCase("en-US");
      if (canonicalPaths.has(canonicalPath)) throw new CanonicalTreeManifestError("unsafe_tree_entry", "Canonical tree contains colliding paths");
      canonicalPaths.add(canonicalPath);
      if (files.length >= limits.files) throw new CanonicalTreeManifestError("tree_limit_exceeded", "Canonical tree file limit exceeded");
      bytes += info.size;
      if (bytes > limits.bytes) throw new CanonicalTreeManifestError("tree_limit_exceeded", "Canonical tree byte limit exceeded");
      const content = await readFile(target);
      const manifestPath = relativePath.normalize("NFC");
      if (manifestPath !== relativePath) diskPaths.set(manifestPath, relativePath);
      files.push({ path: manifestPath, size: content.byteLength, sha256: createHash("sha256").update(content).digest("hex") });
    }
  };
  try {
    // The caller's spelling can be an alias of the directory (a junction or symlinked parent, a Windows 8.3 short name);
    // entries are named from the spelling `resolveWithin` returns for them, so the root is resolved the same way first.
    const base = resolveWithin(root);
    await visit(base, base);
  } catch (error) {
    if (error instanceof PathBoundaryError) throw new CanonicalTreeManifestError("unsafe_tree_entry", error.message);
    throw error;
  }
  files.sort((left, right) => compareText(left.path, right.path));
  return { manifest: { schema_version: 1, digest_algorithm: "sha256", tree_digest: digestEntries(files), files, publication_state: "validated" }, diskPaths };
}

/**
 * Manifest path of `target` below `base`. Both must carry the spelling `resolveWithin` returns: an alias of the same
 * directory is a different string, and is refused rather than named with `..` segments.
 */
export function canonicalTreePath(base: string, target: string, flavor: path.PlatformPath = path): string {
  const relative = flavor.relative(base, target);
  if (relative === "" || relative === ".." || relative.startsWith(`..${flavor.sep}`) || flavor.isAbsolute(relative)) {
    throw new CanonicalTreeManifestError("unsafe_tree_entry", "Canonical tree entry is outside its root");
  }
  return relative.split(flavor.sep).join("/");
}

export function parseCanonicalTreeManifest(
  input: unknown,
  limits: CanonicalTreeLimits = DEFAULT_CANONICAL_TREE_LIMITS,
): CanonicalTreeManifest {
  if (!isRecord(input) || !hasExactKeys(input, ["schema_version", "digest_algorithm", "tree_digest", "files", "publication_state"]) || input["schema_version"] !== 1 || input["digest_algorithm"] !== "sha256" || input["publication_state"] !== "validated") {
    throw new CanonicalTreeManifestError("manifest_unverifiable", "Catalog receipt has no verifiable tree manifest");
  }
  const treeDigest = input["tree_digest"];
  const rawFiles = input["files"];
  if (typeof treeDigest !== "string" || !SHA256.test(treeDigest) || !Array.isArray(rawFiles)) {
    throw new CanonicalTreeManifestError("manifest_unverifiable", "Catalog receipt has no verifiable tree manifest");
  }
  if (rawFiles.length > limits.files) throw new CanonicalTreeManifestError("manifest_unverifiable", "Catalog receipt tree exceeds the file limit");
  const files: CanonicalTreeEntry[] = [];
  const canonicalPaths = new Set<string>();
  let previous = "";
  let bytes = 0;
  for (const raw of rawFiles) {
    if (!isRecord(raw) || !hasExactKeys(raw, ["path", "size", "sha256"]) || typeof raw["path"] !== "string" || typeof raw["size"] !== "number" || typeof raw["sha256"] !== "string") {
      throw new CanonicalTreeManifestError("manifest_unverifiable", "Catalog receipt tree entry is invalid");
    }
    const relativePath = raw["path"];
    if (!isNormalizedRelativePath(relativePath) || relativePath <= previous || !Number.isSafeInteger(raw["size"]) || raw["size"] < 0 || !SHA256.test(raw["sha256"])) {
      throw new CanonicalTreeManifestError("manifest_unverifiable", "Catalog receipt tree entry is not canonical");
    }
    previous = relativePath;
    const canonicalPath = relativePath.normalize("NFC").toLocaleLowerCase("en-US");
    if (canonicalPaths.has(canonicalPath)) throw new CanonicalTreeManifestError("manifest_unverifiable", "Catalog receipt tree contains colliding paths");
    canonicalPaths.add(canonicalPath);
    bytes += raw["size"];
    if (bytes > limits.bytes) throw new CanonicalTreeManifestError("manifest_unverifiable", "Catalog receipt tree exceeds the byte limit");
    files.push({ path: relativePath, size: raw["size"], sha256: raw["sha256"] });
  }
  if (digestEntries(files) !== treeDigest) throw new CanonicalTreeManifestError("manifest_unverifiable", "Catalog receipt tree digest is invalid");
  return { schema_version: 1, digest_algorithm: "sha256", tree_digest: treeDigest, files, publication_state: "validated" };
}

export async function validateCanonicalTree(root: string, expected: CanonicalTreeManifest): Promise<CanonicalTreeManifest> {
  const actual = await inspectCanonicalTree(root);
  if (actual.tree_digest !== expected.tree_digest || actual.files.length !== expected.files.length) {
    throw new CanonicalTreeManifestError("tree_mismatch", "Canonical tree does not match its receipt");
  }
  for (let index = 0; index < actual.files.length; index += 1) {
    const actualEntry = actual.files[index];
    const expectedEntry = expected.files[index];
    if (actualEntry === undefined || expectedEntry === undefined || actualEntry.path !== expectedEntry.path || actualEntry.size !== expectedEntry.size || actualEntry.sha256 !== expectedEntry.sha256) {
      throw new CanonicalTreeManifestError("tree_mismatch", "Canonical tree does not match its receipt");
    }
  }
  return actual;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function digestEntries(files: readonly CanonicalTreeEntry[]): string {
  const hash = createHash("sha256");
  for (const file of files) hash.update(file.path).update("\0").update(String(file.size)).update("\0").update(file.sha256).update("\n");
  return hash.digest("hex");
}

function isNormalizedRelativePath(value: string): boolean {
  if (isProjectDocumentPath(value)) return false;
  const topLevel = value.split("/")[0];
  return value.length > 0 && !value.includes("\\") && !value.includes("\0") && !value.startsWith("/") && value.normalize("NFC") === value && path.posix.normalize(value) === value && value !== "." && !value.split("/").includes("..") && topLevel !== undefined && !EXCLUDED_PROJECT_DIRECTORIES.has(topLevel) && !OWNED_EPHEMERAL_FILES.has(value);
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
