import type { Database } from "bun:sqlite";
import path from "node:path";
import type { CatalogDesignSystemDetail } from "@bg/shared";
import {
  getCatalogRow, getCatalogTags, getCatalogUsage, getCatalogPreviewProjects, getContentReceipt, getLineageReceipt, listCatalogRows,
  type CatalogReceiptRow, type CatalogRow,
} from "../db/catalog-repository";
import type { CatalogQuery } from "./catalog-query";
import { catalogPaths, inspectCatalogTree } from "./catalog-files";
import { BUNDLED_WEBSITE_PREVIEW, BUNDLED_WEBSITE_THUMBNAIL, hasBundledSystemPreview } from "./bundled-system-preview";
import { projectThumbnailUrl } from "./project-thumbnails";

export type CatalogResult = CatalogDesignSystemDetail;

export async function getCatalogSystem(db: Database, root: string, id: string): Promise<CatalogResult | null> {
  const row = getCatalogRow(db, id);
  return row === null ? null : catalogResult(db, root, row);
}

export async function listCatalogSystems(db: Database, root: string, query: CatalogQuery): Promise<{ readonly items: readonly CatalogResult[]; readonly total: number }> {
  const records = await Promise.all(listCatalogRows(db).map((row) => catalogResult(db, root, row)));
  const filtered = records.filter((record) => {
    if (query.query !== null && !`${record.name}\n${record.description ?? ""}\n${record.tags.join("\n")}`.normalize("NFC").toLowerCase().includes(query.query)) return false;
    if (query.tag !== null && !record.tags.includes(query.tag)) return false;
    if (query.kind !== null && record.kind !== query.kind) return false;
    if (query.owner !== null && record.owner !== query.owner) return false;
    if (query.lifecycle !== null && record.lifecycle !== query.lifecycle) return false;
    if (query.provenance !== null && record.provenance !== query.provenance) return false;
    if (query.license !== null && record.license !== query.license) return false;
    if (query.status !== null && record.status !== query.status) return false;
    return true;
  });
  filtered.sort((left, right) => compareCatalog(left, right, query.sort, query.direction));
  return { items: filtered.slice(query.offset, query.offset + query.limit), total: filtered.length };
}

async function catalogResult(db: Database, root: string, row: CatalogRow): Promise<CatalogResult> {
  const tags = getCatalogTags(db, row.id);
  const receipt = getContentReceipt(db, row.id);
  const lineageReceipt = getLineageReceipt(db, row.id);
  let warning: CatalogResult["warning"] = null;
  let manifest: Readonly<Record<string, unknown>> | null = null;
  if (receipt !== null) {
    try { manifest = parseRecord(receipt.manifestJson); }
    catch (error) {
      if (error instanceof CatalogPayloadError) warning = { code: "corrupt_receipt" };
      else throw error;
    }
  }
  const paths = await catalogPaths(root, row.id, row.dirPath).catch(() => null);
  const activePath = row.lifecycle === "trashed" ? paths?.trash : paths?.live;
  const tree = activePath === undefined || activePath === null ? null : await inspectCatalogTree(activePath).catch(() => null);
  if (tree === null && warning === null) warning = { code: "partial_operation" };
  const bundledPreview = tree !== null && row.lifecycle !== "trashed" && await hasBundledSystemPreview(row.id);
  const previewPath = typeof manifest?.["preview_path"] === "string"
    ? manifest["preview_path"]
    : bundledPreview ? tree?.files.find(file => /^(?:index|preview(?:\/[^/]+)?)\.html?$/i.test(file)) ?? BUNDLED_WEBSITE_PREVIEW : tree?.preview ?? fallbackManifestPreview(manifest);
  const lineage = parseLineage(lineageReceipt);
  if (lineageReceipt !== null && lineage === null && warning === null) warning = { code: "corrupt_receipt" };
  const contentIdentity = receipt ?? lineageReceipt;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    kind: row.kind,
    owner: row.owner,
    lifecycle: warning === null ? row.lifecycle : "partial",
    provenance: row.provenance,
    license: row.license,
    tags,
    metadata_revision: row.metadataRevision,
    content: {
      revision: receipt?.operation === "content" ? receipt.contentRevision : lineageReceipt === null ? 0 : 1,
      receipt_id: contentIdentity?.id ?? null,
      digest: contentIdentity?.digest ?? tree?.digest ?? "",
    },
    lineage,
    preview: previewPath === null ? null : { path: previewPath, fallback: typeof manifest?.["preview_path"] !== "string" },
    usage: getCatalogUsage(db, row.id),
    warning,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    is_template: row.isTemplate === 1,
    thumbnail_path: row.thumbnailPath ?? (bundledPreview ? `/api/design-systems/${encodeURIComponent(row.id)}/files/${BUNDLED_WEBSITE_THUMBNAIL}` : null),
    thumbnail_paths: { ...(bundledPreview ? { prototype: `/api/design-systems/${encodeURIComponent(row.id)}/files/${BUNDLED_WEBSITE_THUMBNAIL}`, slide_deck: `/api/design-systems/${encodeURIComponent(row.id)}/files/preview/slides-thumbnail.webp` } : {}), ...Object.fromEntries(getCatalogPreviewProjects(db, row.id).flatMap((project) => {
      const url = projectThumbnailUrl(project);
      return url === null ? [] : [[project.type, url]];
    })) },
    source_type: row.sourceType,
    source_uri: row.sourceUri,
    dir_path: row.lifecycle === "trashed" ? path.join(root, ".catalog-trash", row.id) : row.dirPath,
    skill_md_path: row.skillMdPath,
    tokens_css_path: row.tokensCssPath,
    readme_md_path: row.readmeMdPath,
    archived_at: row.archivedAt,
  };
}

function parseLineage(receipt: CatalogReceiptRow | null): CatalogResult["lineage"] {
  if (receipt === null || (receipt.operation !== "duplicate" && receipt.operation !== "derive")) return null;
  if (receipt.parentSystemId === null || receipt.parentReceiptId === null || receipt.parentDigest === null) return null;
  try {
    const metadata = parseRecord(receipt.metadataJson);
    if (Object.values(metadata).some((value) => typeof value !== "string")) return null;
    return {
      operation: receipt.operation,
      parent_id: receipt.parentSystemId,
      parent_receipt_id: receipt.parentReceiptId,
      parent_digest: receipt.parentDigest,
      reason: receipt.reason,
      metadata: Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, String(value)]).sort(([left], [right]) => left.localeCompare(right))),
    };
  } catch (error) {
    if (error instanceof CatalogPayloadError) return null;
    throw error;
  }
}

function fallbackManifestPreview(manifest: Readonly<Record<string, unknown>> | null): string | null {
  const files = manifest?.["files"];
  if (!Array.isArray(files)) return null;
  const paths = files.flatMap((item) => typeof item === "string" ? [item] : isRecord(item) && typeof item["path"] === "string" ? [item["path"]] : []);
  if (paths.length !== files.length) return null;
  return ["README.md", "index.html", "preview.html", "SKILL.md", "colors_and_type.css"].find((candidate) => paths.includes(candidate)) ?? null;
}

function compareCatalog(left: CatalogResult, right: CatalogResult, sort: CatalogQuery["sort"], direction: CatalogQuery["direction"]): number {
  const leftValue = sort === "name" ? left.name.normalize("NFC").toLowerCase() : sort === "created_at" ? left.created_at : left.updated_at;
  const rightValue = sort === "name" ? right.name.normalize("NFC").toLowerCase() : sort === "created_at" ? right.created_at : right.updated_at;
  const order = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : left.id.localeCompare(right.id);
  return direction === "asc" ? order : -order;
}

function parseRecord(raw: string): Readonly<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) throw new CatalogPayloadError();
    return value;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof CatalogPayloadError) throw new CatalogPayloadError();
    throw error;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class CatalogPayloadError extends Error {
  readonly name = "CatalogPayloadError";
}
