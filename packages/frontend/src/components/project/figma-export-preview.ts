import type { FigmaImportNodeSummary, FigmaImportNodeType } from "@bg/shared/figma-import";

export type FigmaExportPreview = {
  readonly name: string;
  readonly version: string;
  readonly last_modified: string;
  readonly nodes: readonly FigmaImportNodeSummary[];
};

export class FigmaExportPreviewError extends Error {
  readonly name = "FigmaExportPreviewError";

  constructor() {
    super("invalid_figma_export");
  }
}

export function parseFigmaExportPreview(value: unknown): FigmaExportPreview {
  if (!record(value) || !text(value["name"]) || !text(value["version"]) || !text(value["lastModified"])) fail();
  const nodes: FigmaImportNodeSummary[] = [];
  if (record(value["document"])) {
    for (const pageValue of array(value["document"].children)) {
      if (!record(pageValue) || pageValue.type !== "CANVAS" || !text(pageValue.name)) continue;
      for (const nodeValue of array(pageValue.children)) addNode(nodes, nodeValue, pageValue.name);
    }
  } else if (record(value["nodes"])) {
    for (const wrapper of Object.values(value["nodes"])) {
      if (record(wrapper)) addNode(nodes, wrapper.document, "Selected nodes");
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

function addNode(nodes: FigmaImportNodeSummary[], value: unknown, pageName: string): void {
  if (!record(value) || !nodeId(value.id) || !text(value.name) || !importable(value.type)) return;
  nodes.push({ node_id: value.id, name: value.name, node_type: value.type, page_name: pageName });
}

function importable(value: unknown): value is FigmaImportNodeType {
  return value === "FRAME" || value === "COMPONENT" || value === "COMPONENT_SET";
}

function nodeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]+:[A-Za-z0-9_:;-]+$/u.test(value);
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(): never {
  throw new FigmaExportPreviewError();
}
