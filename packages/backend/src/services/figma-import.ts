import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { FIGMA_IMPORT_LIMITS } from "@bg/shared/figma-import";
import {
  AcquisitionLimitError,
  DEFAULT_ACQUISITION_LIMITS,
  throwIfAcquisitionAborted,
  type AcquisitionLimits,
} from "./extraction-acquisition";
import { FigmaImportError } from "./figma-import-errors";
import {
  listFigmaImportableNodes,
  parseFigmaImportDocument,
  selectedFigmaNodes,
  type FigmaImportDocument,
} from "./figma-import-model";
import { mapFigmaTokens } from "./figma-import-token-mapping";
import {
  assetForFigmaNode,
  digestFigmaBytes,
  nodeFileName,
  slugFigmaName,
  validateFigmaAssets,
  type FigmaExportAsset,
} from "./figma-import-assets";
import { resolveWithin } from "../security/path-boundary";

export {
  listFigmaImportableNodes,
  mapFigmaTokens,
  parseFigmaImportDocument,
};
export type { FigmaImportDocument } from "./figma-import-model";
export type { FigmaTokenMapping } from "./figma-import-token-mapping";
export type { FigmaExportAsset } from "./figma-import-assets";

export type FigmaImportResult = {
  readonly manifest_path: string;
  readonly imported_node_count: number;
  readonly imported_asset_count: number;
  readonly unmatched_token_count: number;
  readonly matched_token_count: number;
};

export async function stageFigmaExport(input: {
  readonly stage_dir: string;
  readonly source_file_name: string;
  readonly document: FigmaImportDocument;
  readonly node_ids: readonly string[];
  readonly assets: readonly FigmaExportAsset[];
  readonly pinned_tokens_css: string;
  readonly imported_at: string;
  readonly signal: AbortSignal;
  readonly limits?: AcquisitionLimits;
}): Promise<FigmaImportResult> {
  const limits = input.limits ?? DEFAULT_ACQUISITION_LIMITS;
  throwIfAcquisitionAborted(input.signal);
  const nodes = selectedFigmaNodes(input.document, input.node_ids, input.signal);
  if (nodes.length > limits.assets) {
    throw new AcquisitionLimitError("assets", limits.assets, nodes.length);
  }
  if (input.assets.length > Math.min(limits.assets, FIGMA_IMPORT_LIMITS.assets)) {
    throw new AcquisitionLimitError(
      "assets",
      limits.assets,
      input.assets.length,
    );
  }
  const assets = validateFigmaAssets(input.assets, limits, input.signal);
  const tokenMapping = mapFigmaTokens(
    input.document,
    input.node_ids,
    input.pinned_tokens_css,
    input.signal,
  );
  const importId = `${slugFigmaName(input.document.name) || "figma"}-${crypto.randomUUID()}`;
  const importRoot = path.posix.join("references", "figma", importId);
  const importSegments = importRoot.split("/");
  const nodeBytes = nodes.map((node) =>
    Buffer.from(`${JSON.stringify(node, null, 2)}\n`)
  );
  const nodeRecords = nodes.map((node, index) => {
    throwIfAcquisitionAborted(input.signal);
    const asset = assetForFigmaNode(node.id, node.name, assets);
    const bytes = nodeBytes[index];
    if (bytes === undefined) throw new FigmaImportError("figma_import_failed");
    const nodePath = path.posix.join(
      importRoot,
      "nodes",
      `${nodeFileName(node.id)}.json`,
    );
    return {
      node_id: node.id,
      name: node.name,
      node_type: node.type,
      node_path: nodePath,
      node_sha256: digestFigmaBytes(bytes),
      asset_path: asset === undefined
        ? null
        : path.posix.join(importRoot, asset.outputPath),
      asset_sha256: asset === undefined ? null : digestFigmaBytes(asset.bytes),
    };
  });
  const manifest = {
    schema_version: 1,
    provenance: {
      source: "export",
      source_file_name: input.source_file_name,
      file_version: input.document.version,
      last_modified: input.document.last_modified,
      imported_at: input.imported_at,
      normalized_document_sha256: digestFigmaBytes(
        Buffer.from(JSON.stringify(input.document)),
      ),
    },
    policy: {
      trust: "untrusted",
      uploaded_document: "not_preserved",
      document_digest: "normalized_model",
      never_overwrite: true,
      never_copy_into_authored_output: true,
      derived_artifact: "separate",
    },
    nodes: nodeRecords,
    token_mapping: tokenMapping,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const uniqueAssetPaths = new Set(
    nodeRecords.flatMap((record) =>
      record.asset_path === null ? [] : [record.asset_path]
    ),
  );
  const publicationBytes = manifestBytes.byteLength +
    nodeBytes.reduce((total, bytes) => total + bytes.byteLength, 0) +
    [...uniqueAssetPaths].reduce((total, outputPath) => {
      const relative = path.posix.relative(importRoot, outputPath);
      return total +
        (assets.find((asset) => asset.outputPath === relative)?.bytes.byteLength ??
          0);
    }, 0);
  if (publicationBytes > limits.publicationBytes) {
    throw new AcquisitionLimitError(
      "publication_bytes",
      limits.publicationBytes,
      publicationBytes,
    );
  }
  try {
    throwIfAcquisitionAborted(input.signal);
    await mkdir(
      resolveWithin(input.stage_dir, ...importSegments, "nodes"),
      { recursive: true },
    );
    await mkdir(
      resolveWithin(input.stage_dir, ...importSegments, "assets"),
      { recursive: true },
    );
    await writeFile(
      resolveWithin(input.stage_dir, ...importSegments, "manifest.json"),
      manifestBytes,
      { flag: "wx" },
    );
    for (let index = 0; index < nodes.length; index += 1) {
      throwIfAcquisitionAborted(input.signal);
      const node = nodes[index];
      const bytes = nodeBytes[index];
      if (node === undefined || bytes === undefined) {
        throw new FigmaImportError("figma_import_failed");
      }
      await writeFile(
        resolveWithin(
          input.stage_dir,
          ...importSegments,
          "nodes",
          `${nodeFileName(node.id)}.json`,
        ),
        bytes,
        { flag: "wx" },
      );
    }
    for (const outputPath of uniqueAssetPaths) {
      throwIfAcquisitionAborted(input.signal);
      const relative = path.posix.relative(importRoot, outputPath);
      const asset = assets.find((candidate) =>
        candidate.outputPath === relative
      );
      if (asset === undefined) throw new FigmaImportError("figma_import_failed");
      await writeFile(
        resolveWithin(input.stage_dir, ...importSegments, ...relative.split("/")),
        asset.bytes,
        { flag: "wx" },
      );
    }
  } catch (error) {
    if (
      error instanceof FigmaImportError ||
      error instanceof AcquisitionLimitError
    ) throw error;
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "acquisition_timeout" ||
        error.code === "acquisition_aborted")
    ) throw error;
    throw new FigmaImportError("figma_import_failed");
  }
  return {
    manifest_path: path.posix.join(importRoot, "manifest.json"),
    imported_node_count: nodes.length,
    imported_asset_count: uniqueAssetPaths.size,
    unmatched_token_count: tokenMapping.unmatched.length,
    matched_token_count: tokenMapping.matches.length,
  };
}
