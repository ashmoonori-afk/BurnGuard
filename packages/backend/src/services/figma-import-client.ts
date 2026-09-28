import {
  AcquisitionLimitError,
  DEFAULT_ACQUISITION_LIMITS,
  ExtractionAcquisitionError,
} from "./extraction-acquisition";
import { assertFigmaItemCount, readFigmaResponse } from "./extraction-figma-response";
import { FigmaApiError } from "./figma-errors";
import { parseFigmaUrl } from "./figma";

const FIGMA_API_ROOT = "https://api.figma.com";

export type FigmaFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type FigmaImportApiDocument = {
  readonly name: string;
  readonly version: string;
  readonly lastModified: string;
  readonly document?: unknown;
  readonly nodes?: unknown;
};

export function parseFigmaImportUrl(input: string): { readonly fileKey: string; readonly nodeId?: string } {
  const { fileKey } = parseFigmaUrl(input);
  if (/^[A-Za-z0-9]{8,}$/u.test(input.trim())) return { fileKey };
  let url: URL;
  try { url = new URL(input.trim()); }
  catch { throw new FigmaApiError("invalid_url", "Figma URL is invalid."); }
  const rawNodeId = url.searchParams.get("node-id");
  if (rawNodeId === null) return { fileKey };
  const nodeId = rawNodeId.replace(/-/gu, ":");
  if (!/^[A-Za-z0-9_-]+:[A-Za-z0-9_:;-]+$/u.test(nodeId)) {
    throw new FigmaApiError("invalid_url", "Figma node selector is malformed.");
  }
  return { fileKey, nodeId };
}

export async function fetchFigmaImportDocument(
  fileKey: string,
  token: string,
  nodeIds: readonly string[] | undefined,
  signal?: AbortSignal,
  fetcher: FigmaFetch = fetch,
): Promise<FigmaImportApiDocument> {
  if (nodeIds !== undefined && nodeIds.length > DEFAULT_ACQUISITION_LIMITS.assets) {
    throw new AcquisitionLimitError("assets", DEFAULT_ACQUISITION_LIMITS.assets, nodeIds.length);
  }
  const apiPath = nodeIds === undefined
    ? `/v1/files/${encodeURIComponent(fileKey)}?depth=2`
    : `/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeIds.join(","))}`;
  const value = await figmaFetch(apiPath, token, signal, fetcher);
  if (!record(value)) throw new FigmaApiError("fetch_failed", "Figma API returned an invalid document.");
  const name = value.name;
  const version = value.version;
  const lastModified = value.lastModified;
  if (typeof name !== "string" || typeof version !== "string" || typeof lastModified !== "string") {
    throw new FigmaApiError("fetch_failed", "Figma API returned incomplete document metadata.");
  }
  return {
    name,
    version,
    lastModified,
    ...("document" in value ? { document: value.document } : {}),
    ...("nodes" in value ? { nodes: value.nodes } : {}),
  };
}

export async function fetchFigmaNodeImageUrls(
  fileKey: string,
  nodeIds: readonly string[],
  token: string,
  signal?: AbortSignal,
  fetcher: FigmaFetch = fetch,
): Promise<Readonly<Record<string, string | null>>> {
  if (nodeIds.length === 0) return {};
  if (nodeIds.length > DEFAULT_ACQUISITION_LIMITS.assets) {
    throw new AcquisitionLimitError("assets", DEFAULT_ACQUISITION_LIMITS.assets, nodeIds.length);
  }
  const value = await figmaFetch(
    `/v1/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(nodeIds.join(","))}&format=png&scale=2`,
    token,
    signal,
    fetcher,
  );
  if (!record(value) || !record(value.images)) {
    throw new FigmaApiError("fetch_failed", "Figma API returned invalid image metadata.");
  }
  assertFigmaItemCount(Object.keys(value.images).length);
  const output: Record<string, string | null> = {};
  for (const [nodeId, imageUrl] of Object.entries(value.images)) {
    if (imageUrl !== null && typeof imageUrl !== "string") {
      throw new FigmaApiError("fetch_failed", "Figma API returned invalid image metadata.");
    }
    output[nodeId] = imageUrl;
  }
  return output;
}

async function figmaFetch(
  pathAndQuery: string,
  token: string,
  signal: AbortSignal | undefined,
  fetcher: FigmaFetch,
): Promise<unknown> {
  if (token.length === 0) throw new FigmaApiError("missing_token", "No Figma access token configured.");
  let response: Response;
  try {
    response = await fetcher(`${FIGMA_API_ROOT}${pathAndQuery}`, { headers: { "X-Figma-Token": token }, signal });
  } catch {
    if (signal?.reason instanceof ExtractionAcquisitionError) throw signal.reason;
    throw new FigmaApiError("fetch_failed", "Figma API request failed.");
  }
  if (response.status === 401 || response.status === 403) throw new FigmaApiError("auth_failed", "Figma rejected the access token.", response.status);
  if (response.status === 404) throw new FigmaApiError("not_found", "Figma file not found.", 404);
  if (response.status === 429) throw new FigmaApiError("rate_limited", "Figma rate limit reached.", 429);
  if (!response.ok) throw new FigmaApiError("fetch_failed", "Figma API request failed.", response.status);
  return readFigmaResponse(response, signal);
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
