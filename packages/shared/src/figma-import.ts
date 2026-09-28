export const FIGMA_IMPORT_LIMITS = {
  documentBytes: 8_000_000,
  assets: 64,
  assetBytes: 64_000_000,
  nodes: 10_000,
  depth: 16,
  stringChars: 500,
  idChars: 200,
  selection: 64,
  styleReferences: 64,
  boundVariables: 128,
} as const;

export type FigmaImportNodeType = "FRAME" | "COMPONENT" | "COMPONENT_SET" | "INSTANCE";

export type FigmaImportNodeSummary = {
  readonly node_id: string;
  readonly name: string;
  readonly node_type: FigmaImportNodeType;
  readonly page_name: string;
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

export function parseFigmaNodeIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > FIGMA_IMPORT_LIMITS.selection) fail();
  if (!value.every(nodeId) || new Set(value).size !== value.length) fail();
  return [...value];
}

function nodeId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= FIGMA_IMPORT_LIMITS.idChars &&
    /^[A-Za-z0-9_-]+:[A-Za-z0-9_:;-]+$/u.test(value);
}

function fail(): never {
  throw new FigmaImportContractError("invalid_figma_request");
}
