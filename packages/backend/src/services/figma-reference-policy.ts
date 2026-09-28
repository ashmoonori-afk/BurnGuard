import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FIGMA_IMPORT_LIMITS } from "@bg/shared/figma-import";
import {
  inspectCanonicalTree,
  type CanonicalTreeManifest,
} from "./canonical-tree-manifest";
import { throwIfAcquisitionAborted } from "./extraction-acquisition";
import { resolveWithin } from "../security/path-boundary";

const MAX_IMPORTS = 64;
const MAX_MANIFEST_BYTES = 1_000_000;
const SHA256 = /^[a-f0-9]{64}$/u;
const MANIFEST_PATH =
  /^references\/figma\/([^/]+)\/manifest\.json$/u;

export type ImmutableFigmaReference = {
  readonly path: string;
  readonly sha256: string;
};

export type FigmaReferencePromptEntry = {
  readonly manifest_path: string;
  readonly source_file_name: string;
  readonly file_version: string;
  readonly nodes: readonly {
    readonly name: string;
    readonly node_type: string;
    readonly node_path: string;
    readonly asset_path: string | null;
  }[];
};

export type FigmaReferencePolicy = {
  readonly files: readonly ImmutableFigmaReference[];
  readonly promptEntries: readonly FigmaReferencePromptEntry[];
};

export class ImmutableFigmaReferenceError extends Error {
  readonly name = "ImmutableFigmaReferenceError";
  readonly code = "immutable_reference_escaped" as const;

  constructor() {
    super("immutable_reference_escaped");
  }
}

export async function loadFigmaReferencePolicy(
  root: string,
  manifest?: CanonicalTreeManifest,
  signal?: AbortSignal,
): Promise<FigmaReferencePolicy> {
  throwIfAcquisitionAborted(signal);
  const tree = manifest ?? await inspectCanonicalTree(root);
  const manifestEntries = tree.files.filter((file) =>
    MANIFEST_PATH.test(file.path)
  );
  if (manifestEntries.length > MAX_IMPORTS) fail();
  const byPath = new Map(tree.files.map((file) => [file.path, file]));
  const protectedFiles: ImmutableFigmaReference[] = [];
  const promptEntries: FigmaReferencePromptEntry[] = [];
  for (const manifestEntry of manifestEntries) {
    throwIfAcquisitionAborted(signal);
    if (manifestEntry.size > MAX_MANIFEST_BYTES) fail();
    const match = MANIFEST_PATH.exec(manifestEntry.path);
    const importId = match?.[1];
    if (importId === undefined) fail();
    const raw = await readFile(resolveWithin(root, ...manifestEntry.path.split("/")));
    if (
      raw.byteLength !== manifestEntry.size ||
      createHash("sha256").update(raw).digest("hex") !== manifestEntry.sha256
    ) fail();
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    } catch {
      fail();
    }
    const manifestValue = parseManifest(parsed, importId);
    protectedFiles.push({
      path: manifestEntry.path,
      sha256: manifestEntry.sha256,
    });
    for (const node of manifestValue.nodes) {
      addProtected(byPath, protectedFiles, node.node_path, node.node_sha256);
      if (node.asset_path !== null && node.asset_sha256 !== null) {
        addProtected(byPath, protectedFiles, node.asset_path, node.asset_sha256);
      }
    }
    promptEntries.push({
      manifest_path: manifestEntry.path,
      source_file_name: manifestValue.source_file_name,
      file_version: manifestValue.file_version,
      nodes: manifestValue.nodes.map((node) => ({
        name: node.name,
        node_type: node.node_type,
        node_path: node.node_path,
        asset_path: node.asset_path,
      })),
    });
  }
  protectedFiles.sort((left, right) => left.path.localeCompare(right.path));
  promptEntries.sort((left, right) =>
    left.manifest_path.localeCompare(right.manifest_path)
  );
  return { files: protectedFiles, promptEntries };
}

export async function assertFigmaReferencesPreserved(
  root: string,
  policy: FigmaReferencePolicy,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAcquisitionAborted(signal);
  if (policy.files.length === 0) return;
  const tree = await inspectCanonicalTree(root);
  const byPath = new Map(tree.files.map((file) => [file.path, file]));
  for (const reference of policy.files) {
    throwIfAcquisitionAborted(signal);
    if (byPath.get(reference.path)?.sha256 !== reference.sha256) fail();
  }
}

export function allowedFigmaReferencePaths(
  policy: FigmaReferencePolicy,
): ReadonlyMap<string, ReadonlySet<string>> {
  const paths = new Map<string, Set<string>>();
  for (const reference of policy.files) {
    const existing = paths.get(reference.sha256);
    if (existing === undefined) {
      paths.set(reference.sha256, new Set([reference.path]));
    } else {
      existing.add(reference.path);
    }
  }
  return paths;
}

export function assertFigmaManifestChangesAllowed(
  base: FigmaReferencePolicy,
  staged: FigmaReferencePolicy,
  allowAdditions: boolean,
): void {
  const basePaths = new Set(
    base.promptEntries.map((entry) => entry.manifest_path),
  );
  const stagedPaths = new Set(
    staged.promptEntries.map((entry) => entry.manifest_path),
  );
  if (
    [...basePaths].some((manifestPath) => !stagedPaths.has(manifestPath)) ||
    (!allowAdditions &&
      [...stagedPaths].some((manifestPath) => !basePaths.has(manifestPath)))
  ) fail();
}

function addProtected(
  byPath: ReadonlyMap<
    string,
    { readonly path: string; readonly sha256: string }
  >,
  output: ImmutableFigmaReference[],
  filePath: string,
  expectedSha256: string,
): void {
  const file = byPath.get(filePath);
  if (file?.sha256 !== expectedSha256) fail();
  output.push({ path: filePath, sha256: expectedSha256 });
}

function parseManifest(
  value: unknown,
  importId: string,
): {
  readonly source_file_name: string;
  readonly file_version: string;
  readonly nodes: readonly {
    readonly name: string;
    readonly node_type: string;
    readonly node_path: string;
    readonly node_sha256: string;
    readonly asset_path: string | null;
    readonly asset_sha256: string | null;
  }[];
} {
  if (!record(value) || value["schema_version"] !== 1) fail();
  const provenance = value["provenance"];
  const nodes = value["nodes"];
  if (
    !record(provenance) ||
    !boundedText(provenance["source_file_name"]) ||
    !boundedText(provenance["file_version"]) ||
    !Array.isArray(nodes) ||
    nodes.length > FIGMA_IMPORT_LIMITS.selection
  ) fail();
  const root = `references/figma/${importId}`;
  return {
    source_file_name: provenance["source_file_name"],
    file_version: provenance["file_version"],
    nodes: nodes.map((node) => {
      if (
        !record(node) ||
        !boundedText(node["name"]) ||
        !boundedText(node["node_type"]) ||
        !relativeReferencePath(node["node_path"], root) ||
        !sha256(node["node_sha256"])
      ) fail();
      const assetPath = node["asset_path"];
      const assetSha256 = node["asset_sha256"];
      if (assetPath === null) {
        if (assetSha256 !== null) fail();
        return {
          name: node["name"],
          node_type: node["node_type"],
          node_path: node["node_path"],
          node_sha256: node["node_sha256"],
          asset_path: null,
          asset_sha256: null,
        };
      }
      if (
        !relativeReferencePath(assetPath, root) ||
        !sha256(assetSha256)
      ) fail();
      return {
        name: node["name"],
        node_type: node["node_type"],
        node_path: node["node_path"],
        node_sha256: node["node_sha256"],
        asset_path: assetPath,
        asset_sha256: assetSha256,
      };
    }),
  };
}

function relativeReferencePath(
  value: unknown,
  root: string,
): value is string {
  return typeof value === "string" &&
    value.startsWith(`${root}/`) &&
    path.posix.normalize(value) === value &&
    !value.includes("\\") &&
    !value.includes("\0");
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function boundedText(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= FIGMA_IMPORT_LIMITS.stringChars &&
    !/[\r\n\0]/u.test(value);
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(): never {
  throw new ImmutableFigmaReferenceError();
}
