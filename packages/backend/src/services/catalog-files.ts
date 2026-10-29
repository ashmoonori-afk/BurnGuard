import { randomUUID } from "node:crypto";
import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { resolveManagedPath } from "../lib/paths";
import { PathBoundaryError, assertSafeName, resolveWithin } from "../security/path-boundary";
import {
  CanonicalTreeManifestError, inspectCanonicalTree, parseCanonicalTreeManifest, validateCanonicalTree,
} from "./canonical-tree-manifest";
import { ExtractionSidecarError, readValidatedExtractionSidecar } from "./extraction-sidecar";
import { parseContentProvenance, SystemContentError } from "./system-content-format";

export type CatalogFileIdentity = {
  readonly files: readonly string[];
  readonly digest: string;
  readonly preview: string | null;
};

export type CatalogPaths = {
  readonly live: string;
  readonly trash: string;
};

export class CatalogFileError extends Error {
  readonly name = "CatalogFileError";
  constructor(readonly code: "unsafe_catalog_path" | "catalog_bytes_missing" | "catalog_destination_occupied" | "catalog_digest_mismatch" | "catalog_manifest_unverifiable", message: string) {
    super(message);
  }
}

export async function catalogPaths(root: string, id: string, dbPath: string): Promise<CatalogPaths> {
  await mkdir(root, { recursive: true });
  const safeId = assertSafeName(id);
  const trashRoot = resolveWithin(root, ".catalog-trash");
  await mkdir(trashRoot, { recursive: true });
  let live: string;
  try { live = resolveManagedPath(root, dbPath); }
  catch (error) {
    if (error instanceof PathBoundaryError) throw new CatalogFileError("unsafe_catalog_path", error.message);
    throw error;
  }
  const canonical = resolveWithin(root, safeId);
  if (live !== canonical) throw new CatalogFileError("unsafe_catalog_path", "Design system path is not canonical");
  return { live, trash: resolveWithin(trashRoot, safeId) };
}

export async function inspectCatalogTree(root: string): Promise<CatalogFileIdentity> {
  try {
    const manifest = await inspectCanonicalTree(root);
    const files = manifest.files.map((entry) => entry.path);
    const preview = ["README.md", "index.html", "preview.html", "SKILL.md", "colors_and_type.css"].find((candidate) => files.includes(candidate)) ?? null;
    return { files, digest: manifest.tree_digest, preview };
  } catch (error) {
    if (error instanceof PathBoundaryError || error instanceof CanonicalTreeManifestError && error.code === "unsafe_tree_entry") {
      throw new CatalogFileError("unsafe_catalog_path", error.message);
    }
    if (error instanceof CanonicalTreeManifestError && error.code === "tree_missing") throw new CatalogFileError("catalog_bytes_missing", error.message);
    throw error;
  }
}

export async function validateCatalogReceiptTree(target: string, receipt: {
  readonly schemaVersion: number;
  readonly digest: string;
  readonly manifestJson: string;
  readonly provenanceJson: string;
  readonly metadataJson: string;
  readonly operation: string;
  readonly parentDigest: string | null;
}): Promise<CatalogFileIdentity> {
  try {
    const manifest = parseCanonicalTreeManifest(JSON.parse(receipt.manifestJson));
    parseRecord(receipt.provenanceJson);
    parseRecord(receipt.metadataJson);
    if (receipt.operation !== "content" && receipt.parentDigest !== receipt.digest) throw new CatalogFileError("catalog_digest_mismatch", "Catalog parent digest is stale");
    await validateCanonicalTree(target, manifest);
    const tree = await inspectCatalogTree(target);
    if (receipt.schemaVersion === 2) {
      parseContentProvenance(JSON.parse(receipt.provenanceJson));
      if (receipt.digest !== manifest.tree_digest) throw new CatalogFileError("catalog_digest_mismatch", "Catalog content digest is stale");
      return { ...tree, digest: manifest.tree_digest };
    }
    if (receipt.schemaVersion !== 1) throw new CatalogFileError("catalog_manifest_unverifiable", "Unknown catalog receipt format");
    const sidecar = await readValidatedExtractionSidecar(target);
    if (sidecar.content_digest !== receipt.digest) throw new CatalogFileError("catalog_digest_mismatch", "Catalog receipt provenance digest is stale");
    return { ...tree, digest: sidecar.content_digest };
  } catch (error) {
    if (error instanceof CatalogFileError) throw error;
    if (error instanceof CanonicalTreeManifestError && error.code === "manifest_unverifiable") throw new CatalogFileError("catalog_manifest_unverifiable", error.message);
    if (error instanceof CanonicalTreeManifestError || error instanceof ExtractionSidecarError || error instanceof SystemContentError || error instanceof SyntaxError) throw new CatalogFileError("catalog_digest_mismatch", "Catalog receipt or canonical bytes are corrupt");
    throw error;
  }
}

export async function copyCatalogTree(root: string, childId: string, source: string): Promise<{ readonly staging: string; readonly destination: string }> {
  const destination = resolveWithin(root, assertSafeName(childId));
  if (await exists(destination)) throw new CatalogFileError("catalog_destination_occupied", "Catalog destination is occupied");
  await inspectCatalogTree(source);
  const staging = resolveWithin(root, `.${childId}.catalog-staging-${randomUUID()}`);
  await cp(source, staging, { recursive: true, errorOnExist: true, force: false });
  await inspectCatalogTree(staging);
  return { staging, destination };
}

export async function publishCatalogCopy(staging: string, destination: string): Promise<void> {
  if (await exists(destination)) throw new CatalogFileError("catalog_destination_occupied", "Catalog destination is occupied");
  await rename(staging, destination);
}

export async function moveCatalogTree(source: string, destination: string): Promise<void> {
  if (!(await exists(source))) throw new CatalogFileError("catalog_bytes_missing", "Catalog source is missing");
  if (await exists(destination)) throw new CatalogFileError("catalog_destination_occupied", "Catalog destination is occupied");
  await rename(source, destination);
}

export async function removeCatalogTree(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
}

export async function exists(target: string): Promise<boolean> {
  return (await stat(target).catch(() => null)) !== null;
}

function parseRecord(raw: string): Readonly<Record<string, unknown>> {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) throw new CatalogFileError("catalog_digest_mismatch", "Catalog receipt payload is invalid");
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
