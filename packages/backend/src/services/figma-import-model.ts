import { AcquisitionLimitError, DEFAULT_ACQUISITION_LIMITS, type AcquisitionLimits } from "./extraction-acquisition";
import { FigmaImportError } from "./figma-import-errors";

export const FIGMA_IMPORTABLE_NODE_TYPES = ["FRAME", "COMPONENT", "COMPONENT_SET"] as const;
export type FigmaImportableNodeType = (typeof FIGMA_IMPORTABLE_NODE_TYPES)[number];

export type FigmaImportPaint = {
  readonly type: string;
  readonly color?: { readonly r: number; readonly g: number; readonly b: number; readonly a?: number };
  readonly visible?: boolean;
};

export type FigmaImportNode = {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly children: readonly FigmaImportNode[];
  readonly fills: readonly FigmaImportPaint[];
  readonly style: {
    readonly fontFamily?: string;
    readonly fontSize?: number;
    readonly fontWeight?: number;
  } | null;
  readonly itemSpacing?: number;
  readonly counterAxisSpacing?: number;
  readonly paddingTop?: number;
  readonly paddingRight?: number;
  readonly paddingBottom?: number;
  readonly paddingLeft?: number;
};

export type FigmaImportDocument = {
  readonly name: string;
  readonly version: string;
  readonly last_modified: string;
  readonly document: FigmaImportNode;
};

export type FigmaImportableNode = {
  readonly node_id: string;
  readonly name: string;
  readonly node_type: FigmaImportableNodeType;
  readonly page_name: string;
};

export function parseFigmaImportDocument(
  value: unknown,
  limits: AcquisitionLimits = DEFAULT_ACQUISITION_LIMITS,
): FigmaImportDocument {
  if (!record(value) || !nonempty(value["name"]) || !nonempty(value["version"]) || !nonempty(value["lastModified"])) fail("invalid_figma_export");
  const counter = { value: 0 };
  let document: FigmaImportNode;
  if (record(value["document"])) {
    document = parseNode(value["document"], 0, counter, limits);
  } else if (record(value["nodes"])) {
    const children = Object.values(value["nodes"]).map((wrapper) => {
      if (!record(wrapper) || !record(wrapper["document"])) fail("invalid_figma_export");
      return parseNode(wrapper["document"], 1, counter, limits);
    });
    document = { id: "0:0", name: value["name"], type: "DOCUMENT", children: [{
      id: "0:1", name: "Selected nodes", type: "CANVAS", children, fills: [], style: null,
    }], fills: [], style: null };
  } else {
    fail("invalid_figma_export");
  }
  return { name: value["name"], version: value["version"], last_modified: value["lastModified"], document };
}

export function listFigmaImportableNodes(document: FigmaImportDocument): readonly FigmaImportableNode[] {
  const output: FigmaImportableNode[] = [];
  for (const page of document.document.children) {
    if (page.type !== "CANVAS") continue;
    for (const node of page.children) {
      if (importableType(node.type)) output.push({ node_id: node.id, name: node.name, node_type: node.type, page_name: page.name });
    }
  }
  return output.sort((left, right) => left.node_id.localeCompare(right.node_id));
}

export function selectedFigmaNodes(document: FigmaImportDocument, nodeIds: readonly string[]): readonly FigmaImportNode[] {
  const allowed = new Map<string, FigmaImportNode>();
  for (const page of document.document.children) {
    for (const node of page.children) if (importableType(node.type)) allowed.set(node.id, node);
  }
  if (nodeIds.length === 0 || new Set(nodeIds).size !== nodeIds.length) fail("invalid_figma_selection");
  return nodeIds.map((nodeId) => {
    const node = allowed.get(nodeId);
    if (node === undefined) fail("invalid_figma_selection");
    return node;
  });
}

function parseNode(
  value: Readonly<Record<string, unknown>>,
  depth: number,
  counter: { value: number },
  limits: AcquisitionLimits,
): FigmaImportNode {
  if (depth > limits.localDepth) throw new AcquisitionLimitError("local_depth", limits.localDepth, depth);
  counter.value += 1;
  if (counter.value > limits.parsedItems) throw new AcquisitionLimitError("parsed_items", limits.parsedItems, counter.value);
  if (!nodeId(value["id"]) || !nonempty(value["name"]) || !nonempty(value["type"])) fail("invalid_figma_export");
  const children = value["children"] === undefined ? [] : array(value["children"]).map((child) => {
    if (!record(child)) fail("invalid_figma_export");
    return parseNode(child, depth + 1, counter, limits);
  });
  const fills = value["fills"] === undefined ? [] : array(value["fills"]).map(parsePaint);
  const style = value["style"] === undefined ? null : parseStyle(value["style"]);
  return {
    id: value["id"],
    name: value["name"],
    type: value["type"],
    children,
    fills,
    style,
    ...optionalNodeNumbers(value),
  };
}

function parsePaint(value: unknown): FigmaImportPaint {
  if (!record(value) || !nonempty(value["type"])) fail("invalid_figma_export");
  const color = value["color"] === undefined ? undefined : parseColor(value["color"]);
  const visible = value["visible"] === undefined ? undefined : value["visible"];
  if (visible !== undefined && typeof visible !== "boolean") fail("invalid_figma_export");
  return { type: value["type"], ...(color === undefined ? {} : { color }), ...(visible === undefined ? {} : { visible }) };
}

function parseColor(value: unknown): FigmaImportPaint["color"] {
  if (!record(value)) fail("invalid_figma_export");
  const red = value["r"];
  const green = value["g"];
  const blue = value["b"];
  const alpha = value["a"];
  if (!unitNumber(red) || !unitNumber(green) || !unitNumber(blue)) fail("invalid_figma_export");
  if (alpha !== undefined && !unitNumber(alpha)) fail("invalid_figma_export");
  return { r: red, g: green, b: blue, ...(alpha === undefined ? {} : { a: alpha }) };
}

function parseStyle(value: unknown): FigmaImportNode["style"] {
  if (!record(value)) fail("invalid_figma_export");
  const fontFamily = value["fontFamily"];
  const fontSize = value["fontSize"];
  const fontWeight = value["fontWeight"];
  if (fontFamily !== undefined && !nonempty(fontFamily)) fail("invalid_figma_export");
  if (fontSize !== undefined && !positiveNumber(fontSize)) fail("invalid_figma_export");
  if (fontWeight !== undefined && !positiveNumber(fontWeight)) fail("invalid_figma_export");
  return {
    ...(fontFamily === undefined ? {} : { fontFamily }),
    ...(fontSize === undefined ? {} : { fontSize }),
    ...(fontWeight === undefined ? {} : { fontWeight }),
  };
}

function optionalNodeNumbers(value: Readonly<Record<string, unknown>>): {
  readonly itemSpacing?: number;
  readonly counterAxisSpacing?: number;
  readonly paddingTop?: number;
  readonly paddingRight?: number;
  readonly paddingBottom?: number;
  readonly paddingLeft?: number;
} {
  const itemSpacing = optionalNumber(value["itemSpacing"]);
  const counterAxisSpacing = optionalNumber(value["counterAxisSpacing"]);
  const paddingTop = optionalNumber(value["paddingTop"]);
  const paddingRight = optionalNumber(value["paddingRight"]);
  const paddingBottom = optionalNumber(value["paddingBottom"]);
  const paddingLeft = optionalNumber(value["paddingLeft"]);
  return {
    ...(itemSpacing === undefined ? {} : { itemSpacing }),
    ...(counterAxisSpacing === undefined ? {} : { counterAxisSpacing }),
    ...(paddingTop === undefined ? {} : { paddingTop }),
    ...(paddingRight === undefined ? {} : { paddingRight }),
    ...(paddingBottom === undefined ? {} : { paddingBottom }),
    ...(paddingLeft === undefined ? {} : { paddingLeft }),
  };
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!positiveNumber(value)) fail("invalid_figma_export");
  return value;
}

function importableType(value: string): value is FigmaImportableNodeType {
  return FIGMA_IMPORTABLE_NODE_TYPES.some((type) => type === value);
}

function nodeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]+:[A-Za-z0-9_:;-]+$/u.test(value);
}

function unitNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 500 && !/[\r\n\0]/u.test(value);
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) fail("invalid_figma_export");
  return value;
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(code: FigmaImportError["code"]): never {
  throw new FigmaImportError(code);
}
