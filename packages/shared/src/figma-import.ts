export type FigmaImportNodeType = "FRAME" | "COMPONENT" | "COMPONENT_SET";

export type FigmaImportNodeSummary = {
  readonly node_id: string;
  readonly name: string;
  readonly node_type: FigmaImportNodeType;
  readonly page_name: string;
};

export type FigmaImportInspection = {
  readonly file_key: string;
  readonly file_name: string;
  readonly file_version: string;
  readonly last_modified: string;
  readonly selected_node_id: string | null;
  readonly nodes: readonly FigmaImportNodeSummary[];
};

export type InspectFigmaImportRequest = {
  readonly source_url: string;
};

export type CreateFigmaApiImportRequest = {
  readonly source_url: string;
  readonly node_ids: readonly string[];
};

export type FigmaTokenMappingSummary = {
  readonly matched: number;
  readonly unmatched: number;
};

export type CreateFigmaImportResponse = {
  readonly manifest_path: string;
  readonly imported_node_count: number;
  readonly imported_asset_count: number;
  readonly token_mapping: FigmaTokenMappingSummary;
};

export class FigmaImportContractError extends Error {
  readonly name = "FigmaImportContractError";

  constructor(readonly code: "invalid_figma_request") {
    super(code);
  }
}

export function parseInspectFigmaImportRequest(value: unknown): InspectFigmaImportRequest {
  if (!record(value) || !exactKeys(value, ["source_url"]) || !sourceUrl(value["source_url"])) fail();
  return { source_url: value["source_url"] };
}

export function parseCreateFigmaApiImportRequest(value: unknown): CreateFigmaApiImportRequest {
  if (!record(value) || !exactKeys(value, ["source_url", "node_ids"]) || !sourceUrl(value["source_url"])) fail();
  return { source_url: value["source_url"], node_ids: parseFigmaNodeIds(value["node_ids"]) };
}

export function parseFigmaNodeIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) fail();
  if (!value.every(nodeId) || new Set(value).size !== value.length) fail();
  return [...value];
}

function sourceUrl(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 2_048 && !/[\r\n\0]/u.test(value);
}

function nodeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]+:[A-Za-z0-9_:;-]+$/u.test(value);
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

function fail(): never {
  throw new FigmaImportContractError("invalid_figma_request");
}
