import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { AcquisitionLimitError, DEFAULT_ACQUISITION_LIMITS, type AcquisitionLimits } from "./extraction-acquisition";
import { FigmaImportError } from "./figma-import-errors";
import {
  listFigmaImportableNodes,
  parseFigmaImportDocument,
  selectedFigmaNodes,
  type FigmaImportDocument,
} from "./figma-import-model";
import { mapFigmaTokens } from "./figma-import-token-mapping";
import { PathBoundaryError, assertSafeName, resolveWithin } from "../security/path-boundary";

export { listFigmaImportableNodes, mapFigmaTokens, parseFigmaImportDocument };
export type { FigmaImportDocument } from "./figma-import-model";
export type { FigmaTokenMapping } from "./figma-import-token-mapping";

export type FigmaExportAsset = {
  readonly relative_path: string;
  readonly bytes: Uint8Array;
  readonly media_type: "image/png" | "image/svg+xml";
};

export type FigmaImportResult = {
  readonly manifest_path: string;
  readonly imported_node_count: number;
  readonly imported_asset_count: number;
  readonly unmatched_token_count: number;
  readonly matched_token_count: number;
};

export async function importFigmaExport(input: {
  readonly project_dir: string;
  readonly file_key: string;
  readonly document: FigmaImportDocument;
  readonly node_ids: readonly string[];
  readonly assets: readonly FigmaExportAsset[];
  readonly pinned_tokens_css: string;
  readonly imported_at: string;
  readonly limits?: AcquisitionLimits;
  readonly source?: "api" | "export";
}): Promise<FigmaImportResult> {
  const limits = input.limits ?? DEFAULT_ACQUISITION_LIMITS;
  const nodes = selectedFigmaNodes(input.document, input.node_ids);
  if (nodes.length > limits.assets) throw new AcquisitionLimitError("assets", limits.assets, nodes.length);
  if (input.assets.length > limits.assets) throw new AcquisitionLimitError("assets", limits.assets, input.assets.length);
  const assets = validateAssets(input.assets, limits);
  const tokenMapping = mapFigmaTokens(input.document, input.node_ids, input.pinned_tokens_css);
  const importId = `${slug(input.document.name) || "figma"}-${crypto.randomUUID()}`;
  const root = resolveWithin(input.project_dir, "references", "figma");
  const destination = resolveWithin(input.project_dir, "references", "figma", importId);
  const staging = resolveWithin(input.project_dir, ".burnguard-inputs", "figma-staging", importId);
  const nodeBytes = nodes.map((node) => Buffer.from(`${JSON.stringify(node, null, 2)}\n`));
  const nodeRecords = nodes.map((node, index) => {
    const asset = assetForNode(node.id, node.name, assets);
    const bytes = nodeBytes[index];
    if (bytes === undefined) throw new FigmaImportError("figma_import_failed");
    return {
      node_id: node.id,
      name: node.name,
      node_type: node.type,
      node_path: `nodes/${nodeFileName(node.id)}.json`,
      node_sha256: digest(bytes),
      asset_path: asset?.outputPath ?? null,
      asset_sha256: asset === undefined ? null : digest(asset.bytes),
    };
  });
  const manifest = {
    schema_version: 1,
    provenance: {
      source: input.source ?? "export",
      file_key: input.file_key,
      file_version: input.document.version,
      last_modified: input.document.last_modified,
      imported_at: input.imported_at,
      document_sha256: digest(Buffer.from(JSON.stringify(input.document))),
    },
    policy: {
      original_file: "preserve",
      original_hash: "preserve",
      never_overwrite: true,
      never_copy_into_authored_output: true,
      derived_artifact: "separate",
    },
    nodes: nodeRecords,
    token_mapping: tokenMapping,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const publicationBytes = manifestBytes.byteLength + nodeBytes.reduce((total, bytes) => total + bytes.byteLength, 0) +
    [...new Set(nodeRecords.map((record) => record.asset_path).filter((value): value is string => value !== null))]
      .reduce((total, outputPath) => total + (assets.find((asset) => asset.outputPath === outputPath)?.bytes.byteLength ?? 0), 0);
  if (publicationBytes > limits.publicationBytes) {
    throw new AcquisitionLimitError("publication_bytes", limits.publicationBytes, publicationBytes);
  }
  try {
    await mkdir(resolveWithin(input.project_dir, ".burnguard-inputs", "figma-staging", importId, "nodes"), { recursive: true });
    await mkdir(resolveWithin(input.project_dir, ".burnguard-inputs", "figma-staging", importId, "assets"), { recursive: true });
    await writeFile(resolveWithin(input.project_dir, ".burnguard-inputs", "figma-staging", importId, "manifest.json"), manifestBytes, { flag: "wx" });
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const bytes = nodeBytes[index];
      if (node === undefined || bytes === undefined) throw new FigmaImportError("figma_import_failed");
      await writeFile(resolveWithin(input.project_dir, ".burnguard-inputs", "figma-staging", importId, "nodes", `${nodeFileName(node.id)}.json`), bytes, { flag: "wx" });
    }
    for (const outputPath of new Set(nodeRecords.map((record) => record.asset_path).filter((value): value is string => value !== null))) {
      const asset = assets.find((candidate) => candidate.outputPath === outputPath);
      if (asset === undefined) throw new FigmaImportError("figma_import_failed");
      await writeFile(resolveWithin(input.project_dir, ".burnguard-inputs", "figma-staging", importId, outputPath), asset.bytes, { flag: "wx" });
    }
    await mkdir(root, { recursive: true });
    await rename(staging, destination);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (error instanceof FigmaImportError || error instanceof AcquisitionLimitError) throw error;
    throw new FigmaImportError("figma_import_failed");
  }
  const manifestPath = path.posix.join("references", "figma", importId, "manifest.json");
  return {
    manifest_path: manifestPath,
    imported_node_count: nodes.length,
    imported_asset_count: new Set(nodeRecords.map((record) => record.asset_path).filter((value) => value !== null)).size,
    unmatched_token_count: tokenMapping.unmatched.length,
    matched_token_count: tokenMapping.matches.length,
  };
}

function validateAssets(
  input: readonly FigmaExportAsset[],
  limits: AcquisitionLimits,
): readonly { readonly basename: string; readonly outputPath: string; readonly bytes: Uint8Array }[] {
  let aggregate = 0;
  const output: { readonly basename: string; readonly outputPath: string; readonly bytes: Uint8Array }[] = [];
  for (const asset of input) {
    aggregate += asset.bytes.byteLength;
    if (aggregate > limits.assetBytes) throw new AcquisitionLimitError("asset_bytes", limits.assetBytes, aggregate);
    const segments = asset.relative_path.replaceAll("\\", "/").split("/");
    if (segments.length === 0) failUnsafe();
    try { for (const segment of segments) assertSafeName(segment); }
    catch (error) {
      if (error instanceof PathBoundaryError) failUnsafe();
      throw error;
    }
    const basename = segments[segments.length - 1];
    if (basename === undefined || !mediaTypeMatches(basename, asset.media_type)) failUnsafe();
    const outputName = `${slug(path.parse(basename).name) || "asset"}.${asset.media_type === "image/png" ? "png" : "svg"}`;
    output.push({ basename: path.parse(basename).name, outputPath: `assets/${outputName}`, bytes: asset.bytes });
  }
  return output;
}

function assetForNode(
  nodeId: string,
  nodeName: string,
  assets: readonly { readonly basename: string; readonly outputPath: string; readonly bytes: Uint8Array }[],
) {
  const names = new Set([slug(nodeName), slug(nodeId), slug(nodeId.replaceAll(":", "-"))]);
  return assets.find((asset) => names.has(slug(asset.basename)));
}

function mediaTypeMatches(fileName: string, mediaType: FigmaExportAsset["media_type"]): boolean {
  const extension = path.extname(fileName).toLowerCase();
  return (mediaType === "image/png" && extension === ".png") || (mediaType === "image/svg+xml" && extension === ".svg");
}

function nodeFileName(nodeId: string): string {
  return nodeId.replaceAll(":", "-").replaceAll(";", "_");
}

function slug(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80);
}

function failUnsafe(): never {
  throw new FigmaImportError("unsafe_figma_asset");
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
