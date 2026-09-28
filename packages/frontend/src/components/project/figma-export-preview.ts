import {
  FIGMA_IMPORT_LIMITS,
  type FigmaImportNodeSummary,
  type FigmaImportNodeType,
} from "@bg/shared/figma-import";

export type FigmaExportPreview = {
  readonly name: string;
  readonly version: string;
  readonly last_modified: string;
  readonly nodes: readonly FigmaImportNodeSummary[];
};

export type FigmaSelectionUpdate = {
  readonly selected: readonly string[];
  readonly limitReached: boolean;
};

export class FigmaExportPreviewError extends Error {
  readonly name = "FigmaExportPreviewError";

  constructor() {
    super("invalid_figma_export");
  }
}

export async function readFigmaExportPreview(
  file: Pick<File, "size" | "text">,
): Promise<FigmaExportPreview> {
  if (file.size > FIGMA_IMPORT_LIMITS.documentBytes) fail();
  try {
    return parseFigmaExportPreview(JSON.parse(await file.text()));
  } catch (error) {
    if (error instanceof FigmaExportPreviewError) throw error;
    if (error instanceof SyntaxError) fail();
    throw error;
  }
}

export function validateFigmaExportAssets(
  files: readonly Pick<File, "size">[],
): void {
  if (files.length > FIGMA_IMPORT_LIMITS.assets) fail();
  let bytes = 0;
  for (const file of files) {
    bytes += file.size;
    if (bytes > FIGMA_IMPORT_LIMITS.assetBytes) fail();
  }
}

export function updateFigmaSelection(
  current: readonly string[],
  nodeId: string,
  checked: boolean,
): FigmaSelectionUpdate {
  if (!checked) {
    return {
      selected: current.filter((id) => id !== nodeId),
      limitReached: false,
    };
  }
  if (current.includes(nodeId)) {
    return { selected: current, limitReached: false };
  }
  if (current.length >= FIGMA_IMPORT_LIMITS.selection) {
    return { selected: current, limitReached: true };
  }
  return { selected: [...current, nodeId], limitReached: false };
}

export function parseFigmaExportPreview(value: unknown): FigmaExportPreview {
  if (!record(value) || !text(value["name"]) || !text(value["version"]) || !text(value["lastModified"])) fail();
  const nodes: FigmaImportNodeSummary[] = [];
  const counter = { value: 0 };
  const seenNodeIds = new Set<string>();
  if (record(value["document"])) {
    for (const pageValue of array(value["document"].children)) {
      if (!record(pageValue) || pageValue.type !== "CANVAS" || !text(pageValue.name)) continue;
      visitNode(nodes, pageValue, pageValue.name, 0, counter, seenNodeIds);
    }
  } else if (record(value["nodes"])) {
    for (const wrapper of Object.values(value["nodes"])) {
      if (record(wrapper)) {
        visitNode(
          nodes,
          wrapper.document,
          "Selected nodes",
          1,
          counter,
          seenNodeIds,
        );
      }
    }
  } else {
    fail();
  }
  if (nodes.length === 0) fail();
  return {
    name: value["name"],
    version: value["version"],
    last_modified: value["lastModified"],
    nodes: nodes.sort((left, right) => left.node_id.localeCompare(right.node_id)),
  };
}

function visitNode(
  nodes: FigmaImportNodeSummary[],
  value: unknown,
  pageName: string,
  depth: number,
  counter: { value: number },
  seenNodeIds: Set<string>,
): void {
  if (depth > FIGMA_IMPORT_LIMITS.depth || !record(value)) fail();
  counter.value += 1;
  if (counter.value > FIGMA_IMPORT_LIMITS.nodes) fail();
  if (!nodeId(value.id) || !text(value.name) || !text(value.type)) fail();
  if (seenNodeIds.has(value.id)) fail();
  seenNodeIds.add(value.id);
  if (importable(value.type)) {
    nodes.push({
      node_id: value.id,
      name: value.name,
      node_type: value.type,
      page_name: pageName,
    });
  }
  for (const child of array(value.children)) {
    visitNode(nodes, child, pageName, depth + 1, counter, seenNodeIds);
  }
}

function importable(value: unknown): value is FigmaImportNodeType {
  return value === "FRAME" ||
    value === "COMPONENT" ||
    value === "COMPONENT_SET" ||
    value === "INSTANCE";
}

function nodeId(value: unknown): value is string {
  return text(value) &&
    value.length <= FIGMA_IMPORT_LIMITS.idChars &&
    /^[A-Za-z0-9_-]+:[A-Za-z0-9_:;-]+$/u.test(value);
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= FIGMA_IMPORT_LIMITS.stringChars &&
    !/[\r\n\0]/u.test(value);
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(): never {
  throw new FigmaExportPreviewError();
}
