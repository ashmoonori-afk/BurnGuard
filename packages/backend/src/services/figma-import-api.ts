import type { FigmaImportInspection } from "@bg/shared/figma-import";
import { loadConfig } from "../config";
import { FigmaApiError } from "./figma";
import {
  fetchFigmaImportDocument,
  fetchFigmaNodeImageUrls,
  parseFigmaImportUrl,
  type FigmaFetch,
  type FigmaImportApiDocument,
} from "./figma-import-client";
import { AcquisitionLimitError, DEFAULT_ACQUISITION_LIMITS, type AcquisitionLimits } from "./extraction-acquisition";
import { fetchWebsiteResource } from "./extraction-website";
import {
  importFigmaExport,
  listFigmaImportableNodes,
  parseFigmaImportDocument,
  type FigmaImportResult,
} from "./figma-import";
import { FigmaImportError } from "./figma-import-errors";

export type FigmaImportApiDependencies = {
  readonly getToken: () => Promise<string | null>;
  readonly fetchDocument: (
    fileKey: string,
    token: string,
    nodeIds: readonly string[] | undefined,
    signal: AbortSignal,
  ) => Promise<FigmaImportApiDocument>;
  readonly fetchImageUrls: (
    fileKey: string,
    nodeIds: readonly string[],
    token: string,
    signal: AbortSignal,
  ) => Promise<Readonly<Record<string, string | null>>>;
  readonly fetchAsset: (url: URL, signal: AbortSignal, limits: AcquisitionLimits) => Promise<Uint8Array>;
};

const defaultDependencies: FigmaImportApiDependencies = {
  getToken: async () => (await loadConfig()).figmaPersonalAccessToken,
  fetchDocument: (fileKey, token, nodeIds, signal) => fetchFigmaImportDocument(fileKey, token, nodeIds, signal),
  fetchImageUrls: (fileKey, nodeIds, token, signal) => fetchFigmaNodeImageUrls(fileKey, nodeIds, token, signal),
  fetchAsset: async (url, signal, limits) => {
    let aggregate = 0;
    const result = await fetchWebsiteResource(url, {
      maxBytes: limits.assetBytes,
      kind: "asset",
      noteBytes: (bytes) => { aggregate += bytes; },
      signal,
      userAgent: "BurnGuard Figma importer",
      limits,
    });
    if (aggregate > limits.assetBytes) throw new AcquisitionLimitError("asset_bytes", limits.assetBytes, aggregate);
    return result.buffer;
  },
};

export async function inspectFigmaApiImport(input: {
  readonly source_url: string;
  readonly signal: AbortSignal;
  readonly dependencies?: FigmaImportApiDependencies;
}): Promise<FigmaImportInspection> {
  const dependencies = input.dependencies ?? defaultDependencies;
  const parsedUrl = parseFigmaImportUrl(input.source_url);
  const token = await requiredToken(dependencies);
  const document = parseFigmaImportDocument(await dependencies.fetchDocument(parsedUrl.fileKey, token, undefined, input.signal));
  return {
    file_key: parsedUrl.fileKey,
    file_name: document.name,
    file_version: document.version,
    last_modified: document.last_modified,
    selected_node_id: parsedUrl.nodeId ?? null,
    nodes: listFigmaImportableNodes(document),
  };
}

export async function importFigmaApi(input: {
  readonly project_dir: string;
  readonly source_url: string;
  readonly node_ids: readonly string[];
  readonly pinned_tokens_css: string;
  readonly imported_at: string;
  readonly signal: AbortSignal;
  readonly limits?: AcquisitionLimits;
  readonly dependencies?: FigmaImportApiDependencies;
}): Promise<FigmaImportResult> {
  const dependencies = input.dependencies ?? defaultDependencies;
  const limits = input.limits ?? DEFAULT_ACQUISITION_LIMITS;
  const parsedUrl = parseFigmaImportUrl(input.source_url);
  const token = await requiredToken(dependencies);
  const document = parseFigmaImportDocument(
    await dependencies.fetchDocument(parsedUrl.fileKey, token, input.node_ids, input.signal),
    limits,
  );
  const imageUrls = await dependencies.fetchImageUrls(parsedUrl.fileKey, input.node_ids, token, input.signal);
  const assets = [];
  let aggregate = 0;
  for (const nodeId of input.node_ids) {
    const imageUrl = imageUrls[nodeId];
    if (imageUrl === null || imageUrl === undefined) continue;
    let url: URL;
    try { url = new URL(imageUrl); }
    catch { throw new FigmaImportError("figma_import_failed"); }
    const bytes = await dependencies.fetchAsset(url, input.signal, limits);
    aggregate += bytes.byteLength;
    if (aggregate > limits.assetBytes) throw new AcquisitionLimitError("asset_bytes", limits.assetBytes, aggregate);
    if (!png(bytes)) throw new FigmaImportError("figma_import_failed");
    assets.push({ relative_path: `${nodeId.replaceAll(":", "-")}.png`, bytes, media_type: "image/png" as const });
  }
  return importFigmaExport({
    project_dir: input.project_dir,
    file_key: parsedUrl.fileKey,
    document,
    node_ids: input.node_ids,
    assets,
    pinned_tokens_css: input.pinned_tokens_css,
    imported_at: input.imported_at,
    limits,
    source: "api",
  });
}

export function figmaFetchDependencies(fetcher: FigmaFetch): Pick<FigmaImportApiDependencies, "fetchDocument" | "fetchImageUrls"> {
  return {
    fetchDocument: (fileKey, token, nodeIds, signal) => fetchFigmaImportDocument(fileKey, token, nodeIds, signal, fetcher),
    fetchImageUrls: (fileKey, nodeIds, token, signal) => fetchFigmaNodeImageUrls(fileKey, nodeIds, token, signal, fetcher),
  };
}

async function requiredToken(dependencies: FigmaImportApiDependencies): Promise<string> {
  const token = await dependencies.getToken();
  if (token === null || token.trim().length === 0) throw new FigmaApiError("missing_token", "Figma access is not configured.");
  return token;
}

function png(bytes: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10] as const;
  return bytes.byteLength >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}
