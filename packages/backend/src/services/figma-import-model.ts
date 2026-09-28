import {
  FIGMA_IMPORT_LIMITS,
  type FigmaImportNodeType,
} from "@bg/shared/figma-import";
import {
  AcquisitionLimitError,
  DEFAULT_ACQUISITION_LIMITS,
  throwIfAcquisitionAborted,
  type AcquisitionLimits,
} from "./extraction-acquisition";
import { FigmaImportError } from "./figma-import-errors";
import {
  array,
  boundedIdentifier,
  boundedText,
  parseNodeFields,
  record,
} from "./figma-import-node-fields";
import type {
  FigmaIdentityCatalog,
  FigmaImportableNode,
  FigmaImportDocument,
  FigmaImportNode,
} from "./figma-import-types";

export type {
  FigmaIdentityCatalog,
  FigmaImportableNode,
  FigmaImportDocument,
  FigmaImportNode,
  FigmaImportPaint,
  FigmaImportTypography,
} from "./figma-import-types";

export const FIGMA_IMPORTABLE_NODE_TYPES = [
  "FRAME",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
] as const satisfies readonly FigmaImportNodeType[];

export function parseFigmaImportDocument(
  value: unknown,
  limits: AcquisitionLimits = DEFAULT_ACQUISITION_LIMITS,
  signal?: AbortSignal,
): FigmaImportDocument {
  throwIfAcquisitionAborted(signal);
  if (
    !record(value) ||
    !boundedText(value.name) ||
    !boundedText(value.version) ||
    !boundedText(value.lastModified)
  ) fail("invalid_figma_export");
  const counter = { value: 0 };
  let document: FigmaImportNode;
  if (record(value.document)) {
    document = parseNode(value.document, 0, counter, limits, signal);
  } else if (record(value.nodes)) {
    const children = Object.values(value.nodes).map((wrapper) => {
      throwIfAcquisitionAborted(signal);
      if (!record(wrapper) || !record(wrapper.document)) {
        fail("invalid_figma_export");
      }
      return parseNode(wrapper.document, 1, counter, limits, signal);
    });
    document = syntheticDocument(value.name, children);
  } else {
    fail("invalid_figma_export");
  }
  return {
    name: value.name,
    version: value.version,
    last_modified: value.lastModified,
    document,
    styles: parseIdentityCatalog(value.styles, limits, signal),
    variables: parseIdentityCatalog(value.variables, limits, signal),
  };
}

export function listFigmaImportableNodes(
  document: FigmaImportDocument,
  signal?: AbortSignal,
): readonly FigmaImportableNode[] {
  const output: FigmaImportableNode[] = [];
  let visited = 0;
  for (const page of document.document.children) {
    throwIfAcquisitionAborted(signal);
    if (page.type !== "CANVAS") continue;
    const visit = (node: FigmaImportNode, depth: number): void => {
      throwIfAcquisitionAborted(signal);
      if (depth > FIGMA_IMPORT_LIMITS.depth) {
        throw new AcquisitionLimitError(
          "local_depth",
          FIGMA_IMPORT_LIMITS.depth,
          depth,
        );
      }
      visited += 1;
      if (visited > FIGMA_IMPORT_LIMITS.nodes) {
        throw new AcquisitionLimitError(
          "parsed_items",
          FIGMA_IMPORT_LIMITS.nodes,
          visited,
        );
      }
      if (importableType(node.type)) {
        output.push({
          node_id: node.id,
          name: node.name,
          node_type: node.type,
          page_name: page.name,
        });
      }
      for (const child of node.children) visit(child, depth + 1);
    };
    for (const node of page.children) visit(node, 1);
  }
  return output.sort((left, right) =>
    left.node_id.localeCompare(right.node_id)
  );
}

export function selectedFigmaNodes(
  document: FigmaImportDocument,
  nodeIds: readonly string[],
  signal?: AbortSignal,
): readonly FigmaImportNode[] {
  if (
    nodeIds.length === 0 ||
    nodeIds.length > FIGMA_IMPORT_LIMITS.selection ||
    new Set(nodeIds).size !== nodeIds.length
  ) fail("invalid_figma_selection");
  const selected = new Set(nodeIds);
  const found = new Map<string, FigmaImportNode>();
  const visit = (node: FigmaImportNode): void => {
    throwIfAcquisitionAborted(signal);
    if (selected.has(node.id) && importableType(node.type)) {
      found.set(node.id, node);
    }
    for (const child of node.children) visit(child);
  };
  for (const page of document.document.children) visit(page);
  return nodeIds.map((nodeId) => {
    const node = found.get(nodeId);
    if (node === undefined) fail("invalid_figma_selection");
    return node;
  });
}

function parseNode(
  value: Readonly<Record<string, unknown>>,
  depth: number,
  counter: { value: number },
  limits: AcquisitionLimits,
  signal?: AbortSignal,
): FigmaImportNode {
  throwIfAcquisitionAborted(signal);
  if (depth > Math.min(limits.localDepth, FIGMA_IMPORT_LIMITS.depth)) {
    throw new AcquisitionLimitError("local_depth", limits.localDepth, depth);
  }
  counter.value += 1;
  if (counter.value > Math.min(limits.parsedItems, FIGMA_IMPORT_LIMITS.nodes)) {
    throw new AcquisitionLimitError(
      "parsed_items",
      limits.parsedItems,
      counter.value,
    );
  }
  if (
    !nodeId(value.id) ||
    !boundedText(value.name) ||
    !boundedText(value.type)
  ) fail("invalid_figma_export");
  const children = value.children === undefined
    ? []
    : array(value.children).map((child) => {
      if (!record(child)) fail("invalid_figma_export");
      return parseNode(child, depth + 1, counter, limits, signal);
    });
  return {
    id: value.id,
    name: value.name,
    type: value.type,
    children,
    ...parseNodeFields(value),
  };
}

function parseIdentityCatalog(
  value: unknown,
  limits: AcquisitionLimits,
  signal?: AbortSignal,
): FigmaIdentityCatalog {
  if (value === undefined) return {};
  if (!record(value)) fail("invalid_figma_export");
  const entries = Object.entries(value);
  const maximum = Math.min(
    limits.parsedItems,
    FIGMA_IMPORT_LIMITS.boundVariables,
  );
  if (entries.length > maximum) {
    throw new AcquisitionLimitError("parsed_items", maximum, entries.length);
  }
  const output: Record<string, { readonly name: string; readonly kind?: string }> =
    {};
  for (const [id, raw] of entries) {
    throwIfAcquisitionAborted(signal);
    if (!boundedIdentifier(id) || !record(raw) || !boundedText(raw.name)) {
      fail("invalid_figma_export");
    }
    const kind = raw.styleType ?? raw.resolvedType;
    if (kind !== undefined && !boundedText(kind)) fail("invalid_figma_export");
    output[id] = {
      name: raw.name,
      ...(kind === undefined ? {} : { kind }),
    };
  }
  return output;
}

function syntheticDocument(
  name: string,
  children: readonly FigmaImportNode[],
): FigmaImportNode {
  const empty = { fills: [], style: null, styles: {}, boundVariableIds: {} };
  return {
    id: "0:0",
    name,
    type: "DOCUMENT",
    children: [{
      id: "0:1",
      name: "Selected nodes",
      type: "CANVAS",
      children,
      ...empty,
    }],
    ...empty,
  };
}

function importableType(value: string): value is FigmaImportNodeType {
  return FIGMA_IMPORTABLE_NODE_TYPES.some((type) => type === value);
}

function nodeId(value: unknown): value is string {
  return boundedIdentifier(value) &&
    /^[A-Za-z0-9_-]+:[A-Za-z0-9_:;-]+$/u.test(value);
}

function fail(code: FigmaImportError["code"]): never {
  throw new FigmaImportError(code);
}
