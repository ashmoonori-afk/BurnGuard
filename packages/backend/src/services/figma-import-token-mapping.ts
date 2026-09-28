import type {
  FigmaIdentityCatalog,
  FigmaImportDocument,
  FigmaImportNode,
} from "./figma-import-model";
import { selectedFigmaNodes } from "./figma-import-model";
import { throwIfAcquisitionAborted } from "./extraction-acquisition";

export type FigmaTokenKind =
  | "color"
  | "font_family"
  | "font_size"
  | "font_weight"
  | "line_height"
  | "letter_spacing"
  | "spacing"
  | "radius";
export type FigmaTokenMatch = {
  readonly kind: FigmaTokenKind;
  readonly value: string;
  readonly token: string;
  readonly node_ids: readonly string[];
};
export type FigmaUnmatchedToken = Omit<FigmaTokenMatch, "token">;
export type FigmaTokenMapping = {
  readonly matches: readonly FigmaTokenMatch[];
  readonly unmatched: readonly FigmaUnmatchedToken[];
};

type Candidate = {
  readonly kind: FigmaTokenKind;
  readonly value: string;
  readonly nodeIds: Set<string>;
  readonly identities: Set<string>;
};

const KIND_ORDER: readonly FigmaTokenKind[] = [
  "color",
  "font_family",
  "font_size",
  "font_weight",
  "line_height",
  "letter_spacing",
  "spacing",
  "radius",
];

export function mapFigmaTokens(
  document: FigmaImportDocument,
  nodeIds: readonly string[],
  pinnedTokensCss: string,
  signal?: AbortSignal,
): FigmaTokenMapping {
  const candidates = new Map<string, Candidate>();
  for (const selected of selectedFigmaNodes(document, nodeIds, signal)) {
    collect(selected, document, candidates, signal);
  }
  const pinned = parsePinnedTokens(pinnedTokensCss);
  const matches: FigmaTokenMatch[] = [];
  const unmatched: FigmaUnmatchedToken[] = [];
  for (const candidate of [...candidates.values()].sort(compareCandidate)) {
    throwIfAcquisitionAborted(signal);
    const token = [...candidate.identities]
      .map(identityToken)
      .find((identity) => pinned.names.get(identity) === candidate.kind);
    const fallback = pinned.values.get(
      `${candidate.kind}\0${normalize(candidate.kind, candidate.value)}`,
    );
    const common = {
      kind: candidate.kind,
      value: candidate.value,
      node_ids: [...candidate.nodeIds].sort(),
    };
    const matchedToken = token ?? fallback;
    if (matchedToken === undefined) unmatched.push(common);
    else matches.push({ ...common, token: matchedToken });
  }
  return { matches, unmatched };
}

function collect(
  node: FigmaImportNode,
  document: FigmaImportDocument,
  candidates: Map<string, Candidate>,
  signal?: AbortSignal,
): void {
  throwIfAcquisitionAborted(signal);
  const identities = nodeIdentities(node, document.styles, document.variables);
  for (const fill of node.fills) {
    if (fill.visible === false || fill.type !== "SOLID" || fill.color === undefined) {
      continue;
    }
    add(
      candidates,
      "color",
      colorHex(fill.color.r, fill.color.g, fill.color.b),
      node.id,
      identitiesFor(identities, "fills", "fill"),
    );
  }
  if (node.style?.fontFamily !== undefined) {
    add(candidates, "font_family", node.style.fontFamily, node.id, identitiesFor(identities, "fontFamily", "text"));
  }
  if (node.style?.fontSize !== undefined) {
    add(candidates, "font_size", px(node.style.fontSize), node.id, identitiesFor(identities, "fontSize", "text"));
  }
  if (node.style?.fontWeight !== undefined) {
    add(candidates, "font_weight", formatNumber(node.style.fontWeight), node.id, identitiesFor(identities, "fontWeight", "text"));
  }
  if (node.style?.lineHeightPx !== undefined) {
    add(candidates, "line_height", px(node.style.lineHeightPx), node.id, identitiesFor(identities, "lineHeight", "text"));
  }
  if (node.style?.letterSpacing !== undefined) {
    add(candidates, "letter_spacing", px(node.style.letterSpacing), node.id, identitiesFor(identities, "letterSpacing", "text"));
  }
  for (const [property, value] of [
    ["itemSpacing", node.itemSpacing],
    ["counterAxisSpacing", node.counterAxisSpacing],
    ["paddingTop", node.paddingTop],
    ["paddingRight", node.paddingRight],
    ["paddingBottom", node.paddingBottom],
    ["paddingLeft", node.paddingLeft],
  ] as const) {
    if (value !== undefined) {
      add(candidates, "spacing", px(value), node.id, identitiesFor(identities, property));
    }
  }
  if (node.cornerRadius !== undefined) {
    add(candidates, "radius", px(node.cornerRadius), node.id, identitiesFor(identities, "cornerRadius"));
  }
  for (const child of node.children) collect(child, document, candidates, signal);
}

function nodeIdentities(
  node: FigmaImportNode,
  styles: FigmaIdentityCatalog,
  variables: FigmaIdentityCatalog,
): Readonly<Record<string, readonly string[]>> {
  const output: Record<string, string[]> = {};
  for (const [property, styleId] of Object.entries(node.styles)) {
    const name = styles[styleId]?.name;
    if (name !== undefined) output[property] = [...(output[property] ?? []), name];
  }
  for (const [property, variableIds] of Object.entries(node.boundVariableIds)) {
    for (const variableId of variableIds) {
      output[property] = [
        ...(output[property] ?? []),
        variables[variableId]?.name ?? variableId,
      ];
    }
  }
  return output;
}

function identitiesFor(
  identities: Readonly<Record<string, readonly string[]>>,
  ...properties: readonly string[]
): readonly string[] {
  return properties.flatMap((property) => identities[property] ?? []);
}

function add(
  candidates: Map<string, Candidate>,
  kind: FigmaTokenKind,
  value: string,
  nodeId: string,
  identities: readonly string[],
): void {
  const key = `${kind}\0${normalize(kind, value)}`;
  const existing = candidates.get(key);
  if (existing !== undefined) {
    existing.nodeIds.add(nodeId);
    for (const identity of identities) existing.identities.add(identity);
    return;
  }
  candidates.set(key, {
    kind,
    value,
    nodeIds: new Set([nodeId]),
    identities: new Set(identities),
  });
}

function parsePinnedTokens(css: string): {
  readonly names: ReadonlyMap<string, FigmaTokenKind>;
  readonly values: ReadonlyMap<string, string>;
} {
  const names = new Map<string, FigmaTokenKind>();
  const values = new Map<string, string>();
  for (const match of css.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+)\s*;/gu)) {
    const token = match[1];
    const value = match[2];
    if (token === undefined || value === undefined) continue;
    const kind = classifyCustomProperty(token);
    if (kind === null) continue;
    names.set(token.toLowerCase(), kind);
    const key = `${kind}\0${normalize(kind, value.trim())}`;
    if (!values.has(key)) values.set(key, token);
  }
  return { names, values };
}

function classifyCustomProperty(token: string): FigmaTokenKind | null {
  const name = token.toLowerCase();
  if (/(?:^|-)color(?:-|$)|background|foreground|surface|fill|stroke|accent/u.test(name)) return "color";
  if (/font(?:-[a-z0-9]+)*-family|typeface/u.test(name)) return "font_family";
  if (/font(?:-[a-z0-9]+)*-size|type(?:-[a-z0-9]+)*-size|text(?:-[a-z0-9]+)*-size/u.test(name)) return "font_size";
  if (/font(?:-[a-z0-9]+)*-weight|type(?:-[a-z0-9]+)*-weight/u.test(name)) return "font_weight";
  if (/line-height|leading/u.test(name)) return "line_height";
  if (/letter-spacing|tracking/u.test(name)) return "letter_spacing";
  if (/radius|radii|corner/u.test(name)) return "radius";
  if (/space|spacing|gap|padding|margin|inset/u.test(name)) return "spacing";
  return null;
}

function identityToken(value: string): string {
  return `--${value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "")}`;
}

function normalize(kind: FigmaTokenKind, value: string): string {
  switch (kind) {
    case "color":
      return normalizeColor(value);
    case "font_family":
      return value.trim().replace(/^["']|["']$/gu, "").toLowerCase();
    case "font_size":
    case "line_height":
    case "letter_spacing":
    case "spacing":
    case "radius":
      return value.trim().toLowerCase();
    case "font_weight":
      return value.trim();
  }
}

function normalizeColor(value: string): string {
  const lower = value.trim().toLowerCase();
  if (/^#[a-f0-9]{6}$/u.test(lower)) return lower;
  const short = /^#([a-f0-9])([a-f0-9])([a-f0-9])$/u.exec(lower);
  return short === null
    ? lower
    : `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
}

function colorHex(red: number, green: number, blue: number): string {
  const byte = (value: number): string =>
    Math.round(value * 255).toString(16).padStart(2, "0");
  return `#${byte(red)}${byte(green)}${byte(blue)}`;
}

function px(value: number): string {
  return `${formatNumber(value)}px`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function compareCandidate(left: Candidate, right: Candidate): number {
  const kind = KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind);
  return kind === 0 ? left.value.localeCompare(right.value) : kind;
}
