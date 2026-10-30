import type { Database } from "bun:sqlite";
import path from "node:path";
import type { CatalogDesignSystemDetail, DesignSystemPreview, ProjectType } from "@bg/shared";
import {
  CatalogRepositoryError, getCatalogRow, getCatalogTags, getCatalogUsage, getCatalogPreviewProjects, getContentReceipt, getLineageReceipt, getPendingSystemOperation, listCatalogRows, updateCatalogMetadata,
  type CatalogReceiptRow, type CatalogRow,
} from "../db/catalog-repository";
import type { CatalogQuery } from "./catalog-query";
import { CatalogFileError, catalogPaths, inspectCatalogTree, validateCatalogReceiptTree, type CatalogFileIdentity } from "./catalog-files";
import { BUNDLED_SLIDES_PREVIEW, BUNDLED_WEBSITE_PREVIEW, BUNDLED_WEBSITE_THUMBNAIL, hasBundledSlidesPreview, hasBundledSystemPreview, readBundledSystemPreview } from "./bundled-system-preview";
import { projectThumbnailUrl } from "./project-thumbnails";
import { withSystemContentLocks } from "./system-content-access";
import { withCatalogSnapshot, type CatalogAccessEvents } from "./catalog-snapshot";
import { SystemContentError } from "./system-content-format";
import { observeSystemContent, type ContentEnvironment } from "./system-content-publication";
import { readPreservedFile } from "./system-content-tree";
import { assertSafeName, PathBoundaryError } from "../security/path-boundary";
import { CatalogLifecycleError } from "./catalog-lifecycle";

export type CatalogResult = CatalogDesignSystemDetail;

export async function getCatalogSystem(db: Database, root: string, id: string, events: CatalogAccessEvents = {}): Promise<CatalogResult | null> {
  const read = async () => {
    const row = getCatalogRow(db, id);
    return row === null ? null : catalogResult(db, root, row);
  };
  try {
    if (getCatalogRow(db, id)?.lifecycle === "trashed") {
      // Catalog lifecycle inspection only: no ordinary live-read exemption or forged lease.
      return await withSystemContentLocks(root, [id], async () => {
        if (getPendingSystemOperation(db, id) !== null || getCatalogRow(db, id)?.lifecycle !== "trashed") throw new SystemContentError("system_content_unavailable");
        return read();
      });
    }
    return await withCatalogSnapshot(db, root, id, read, events);
  } catch (error) {
    if (!(error instanceof SystemContentError)) throw error;
    // Metadata-only unavailable descriptor. Never touch live paths or claim candidate bytes.
    const row = getCatalogRow(db, id);
    return row === null ? null : catalogResult(db, root, row, true);
  }
}

export async function listCatalogSystems(db: Database, root: string, query: CatalogQuery): Promise<{ readonly items: readonly CatalogResult[]; readonly total: number }> {
  const records: CatalogResult[] = [];
  for (const row of listCatalogRows(db)) {
    const record = await getCatalogSystem(db, root, row.id);
    if (record !== null) records.push(record);
  }
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

type MetadataPatch = Pick<Parameters<typeof updateCatalogMetadata>[1], "expectedRevision"> &
  Partial<Omit<Parameters<typeof updateCatalogMetadata>[1], "id" | "expectedRevision" | "updatedAt">>;

export async function patchCatalogSystem(db: Database, root: string, id: string, patch: MetadataPatch, events: CatalogAccessEvents = {}): Promise<CatalogResult> {
  try {
    return await withCatalogSnapshot(db, root, id, async () => {
      const row = getCatalogRow(db, id);
      if (row === null) throw new CatalogLifecycleError("design_system_not_found", "Design system not found");
      if (row.lifecycle === "trashed") throw new CatalogLifecycleError("invalid_lifecycle", "Restore the system before editing metadata");
      updateCatalogMetadata(db, {
        id, expectedRevision: patch.expectedRevision, name: patch.name ?? row.name,
        description: patch.description === undefined ? row.description : patch.description,
        status: patch.status ?? row.status, tags: patch.tags ?? getCatalogTags(db, id), kind: patch.kind ?? row.kind,
        provenance: patch.provenance ?? row.provenance, license: patch.license ?? row.license,
        lifecycle: patch.lifecycle ?? row.lifecycle, updatedAt: Date.now(),
      });
      const updated = getCatalogRow(db, id);
      if (updated === null) throw new CatalogLifecycleError("design_system_not_found", "Design system not found");
      return catalogResult(db, root, updated);
    }, events);
  } catch (error) {
    if (error instanceof SystemContentError && error.code === "system_content_unavailable") {
      if (getCatalogRow(db, id)?.lifecycle === "trashed") throw new CatalogLifecycleError("invalid_lifecycle", "Restore the system before editing metadata");
      throw new CatalogRepositoryError("operation_conflict", id);
    }
    throw error;
  }
}

function readEnvironment(db: Database, root: string): ContentEnvironment {
  return { db, systemsRoot: root, operationId: () => crypto.randomUUID(), now: Date.now, validators: {} };
}

export async function readCatalogFile(db: Database, root: string, id: string, relative: string, events: CatalogAccessEvents = {}): Promise<Uint8Array<ArrayBuffer> | null> {
  const normalized = relative.replaceAll("\\", "/");
  normalized.split("/").forEach(assertSafeName);
  return withCatalogSnapshot(db, root, id, async lease => {
    const base = await observeSystemContent(readEnvironment(db, root), id, lease);
    if (base.row === null) return null;
    const entry = base.tree?.inventory.find(item => item[1] === normalized);
    if (entry !== undefined) return entry[0] === "file" ? Uint8Array.from(await readPreservedFile(base.live, normalized, entry)) : null;
    const bundled = await readBundledSystemPreview(id, normalized);
    return bundled === null ? null : Uint8Array.from(bundled);
  }, events);
}

export async function readCatalogPreviews(db: Database, root: string, id: string): Promise<readonly DesignSystemPreview[] | null> {
  return withCatalogSnapshot(db, root, id, async lease => {
    const base = await observeSystemContent(readEnvironment(db, root), id, lease);
    if (base.row === null || base.tree === null) return null;
    const previews: DesignSystemPreview[] = base.tree.manifest.files.filter(file => /^(?:preview\/[^/]+|preview)\.html?$/i.test(file.path)).map(file => ({ path: file.path }));
    if (!previews.some(preview => preview.path === BUNDLED_WEBSITE_PREVIEW) && await hasBundledSystemPreview(id)) previews.unshift({ path: BUNDLED_WEBSITE_PREVIEW });
    if (!previews.some(preview => preview.path === BUNDLED_SLIDES_PREVIEW) && hasBundledSlidesPreview(id)) previews.push({ path: BUNDLED_SLIDES_PREVIEW });
    return previews;
  });
}

async function catalogResult(db: Database, root: string, row: CatalogRow, unavailable = false): Promise<CatalogResult> {
  const tags = getCatalogTags(db, row.id);
  const receipt = getContentReceipt(db, row.id);
  const lineageReceipt = getLineageReceipt(db, row.id);
  let warning: CatalogResult["warning"] = unavailable ? { code: "partial_operation" } : null;
  let manifest: Readonly<Record<string, unknown>> | null = null;
  if (receipt !== null) {
    try { manifest = parseRecord(receipt.manifestJson); }
    catch (error) {
      if (error instanceof CatalogPayloadError) warning = { code: "corrupt_receipt" };
      else throw error;
    }
  }
  let activePath: string | null = null;
  let tree: CatalogFileIdentity | null = null;
  if (!unavailable) {
    try {
      const paths = await catalogPaths(root, row.id, row.dirPath);
      activePath = row.lifecycle === "trashed" ? paths.trash : paths.live;
      tree = await inspectCatalogTree(activePath);
    } catch (error) {
      if (!(error instanceof CatalogFileError || error instanceof PathBoundaryError || error instanceof SystemContentError)) throw error;
      warning = { code: "partial_operation" };
    }
  }
  if (tree === null && warning === null) warning = { code: "partial_operation" };
  const authority = receipt ?? lineageReceipt;
  if (tree !== null && authority !== null && activePath != null) {
    try { await validateCatalogReceiptTree(activePath, authority); }
    catch (error) {
      if (!(error instanceof CatalogFileError)) throw error;
      warning = { code: "corrupt_receipt" };
    }
  }
  const bundledPreview = tree !== null && row.lifecycle !== "trashed" && await hasBundledSystemPreview(row.id);
  const previewPath = unavailable ? null : typeof manifest?.["preview_path"] === "string"
    ? manifest["preview_path"]
    : bundledPreview ? tree?.files.find(file => /^(?:index|preview(?:\/[^/]+)?)\.html?$/i.test(file)) ?? BUNDLED_WEBSITE_PREVIEW : tree?.preview ?? fallbackManifestPreview(manifest);
  const lineage = parseLineage(lineageReceipt);
  if (lineageReceipt !== null && lineage === null && warning === null) warning = { code: "corrupt_receipt" };
  const contentIdentity = receipt ?? lineageReceipt;
  const bundledThumbnail = bundledPreview ? `/api/design-systems/${encodeURIComponent(row.id)}/files/${BUNDLED_WEBSITE_THUMBNAIL}` : null;
  const projectThumbnails: Record<string, string> = Object.fromEntries(getCatalogPreviewProjects(db, row.id).flatMap((project) => {
    const url = projectThumbnailUrl(project);
    return url === null ? [] : [[project.type, url]];
  }));
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
    thumbnail_path: row.thumbnailPath ?? bundledThumbnail ?? representativeProjectThumbnail(projectThumbnails),
    thumbnail_paths: { ...(bundledThumbnail === null ? {} : { prototype: bundledThumbnail, slide_deck: `/api/design-systems/${encodeURIComponent(row.id)}/files/preview/slides-thumbnail.webp` }), ...projectThumbnails },
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

const REPRESENTATIVE_PROJECT_TYPES: readonly ProjectType[] = ["prototype", "from_template", "slide_deck", "graphic", "logo", "other"];

/** A system without its own image shows the latest rendered project made with it, website first. */
function representativeProjectThumbnail(thumbnails: Readonly<Record<string, string>>): string | null {
  return REPRESENTATIVE_PROJECT_TYPES.map((type) => thumbnails[type]).find((url) => url !== undefined) ?? null;
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
