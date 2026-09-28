import type { FigmaImportDocument, FigmaImportNode } from "./figma-import-model";
import { selectedFigmaNodes } from "./figma-import-model";

export type FigmaTokenKind = "color" | "font_family" | "font_size" | "font_weight" | "spacing";
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

const KIND_ORDER: readonly FigmaTokenKind[] = ["color", "font_family", "font_size", "font_weight", "spacing"];

export function mapFigmaTokens(
  document: FigmaImportDocument,
  nodeIds: readonly string[],
  pinnedTokensCss: string,
): FigmaTokenMapping {
  const candidates = new Map<string, { readonly kind: FigmaTokenKind; readonly value: string; readonly nodeIds: Set<string> }>();
  for (const selected of selectedFigmaNodes(document, nodeIds)) collect(selected, candidates);
  const pinned = parsePinnedTokens(pinnedTokensCss);
  const matches: FigmaTokenMatch[] = [];
  const unmatched: FigmaUnmatchedToken[] = [];
  const ordered = [...candidates.values()].sort(compareCandidate);
  for (const candidate of ordered) {
    const token = pinned.get(`${candidate.kind}\0${normalize(candidate.kind, candidate.value)}`);
    const common = { kind: candidate.kind, value: candidate.value, node_ids: [...candidate.nodeIds].sort() };
    if (token === undefined) unmatched.push(common);
    else matches.push({ ...common, token });
  }
  return { matches, unmatched };
}

function collect(
  node: FigmaImportNode,
  candidates: Map<string, { readonly kind: FigmaTokenKind; readonly value: string; readonly nodeIds: Set<string> }>,
): void {
  for (const fill of node.fills) {
    if (fill.visible === false || fill.type !== "SOLID" || fill.color === undefined) continue;
    const hex = colorHex(fill.color.r, fill.color.g, fill.color.b);
    add(candidates, "color", hex, node.id);
  }
  if (node.style?.fontFamily !== undefined) add(candidates, "font_family", node.style.fontFamily, node.id);
  if (node.style?.fontSize !== undefined) add(candidates, "font_size", `${formatNumber(node.style.fontSize)}px`, node.id);
  if (node.style?.fontWeight !== undefined) add(candidates, "font_weight", formatNumber(node.style.fontWeight), node.id);
  for (const value of [node.itemSpacing, node.counterAxisSpacing, node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft]) {
    if (value !== undefined) add(candidates, "spacing", `${formatNumber(value)}px`, node.id);
  }
  for (const child of node.children) collect(child, candidates);
}

function add(
  candidates: Map<string, { readonly kind: FigmaTokenKind; readonly value: string; readonly nodeIds: Set<string> }>,
  kind: FigmaTokenKind,
  value: string,
  nodeId: string,
): void {
  const key = `${kind}\0${normalize(kind, value)}`;
  const existing = candidates.get(key);
  if (existing !== undefined) {
    existing.nodeIds.add(nodeId);
    return;
  }
  candidates.set(key, { kind, value, nodeIds: new Set([nodeId]) });
}

function parsePinnedTokens(css: string): ReadonlyMap<string, string> {
  const output = new Map<string, string>();
  for (const match of css.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+)\s*;/gu)) {
    const token = match[1];
    const value = match[2];
    if (token === undefined || value === undefined) continue;
    const trimmed = value.trim();
    for (const kind of KIND_ORDER) {
      const normalized = normalize(kind, trimmed);
      const key = `${kind}\0${normalized}`;
      if (!output.has(key)) output.set(key, token);
    }
  }
  return output;
}

function normalize(kind: FigmaTokenKind, value: string): string {
  switch (kind) {
    case "color": return normalizeColor(value);
    case "font_family": return value.trim().replace(/^["']|["']$/gu, "").toLowerCase();
    case "font_size":
    case "spacing": return value.trim().toLowerCase();
    case "font_weight": return value.trim();
  }
}

function normalizeColor(value: string): string {
  const lower = value.trim().toLowerCase();
  if (/^#[a-f0-9]{6}$/u.test(lower)) return lower;
  const short = /^#([a-f0-9])([a-f0-9])([a-f0-9])$/u.exec(lower);
  return short === null ? lower : `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
}

function colorHex(red: number, green: number, blue: number): string {
  const byte = (value: number): string => Math.round(value * 255).toString(16).padStart(2, "0");
  return `#${byte(red)}${byte(green)}${byte(blue)}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function compareCandidate(
  left: { readonly kind: FigmaTokenKind; readonly value: string },
  right: { readonly kind: FigmaTokenKind; readonly value: string },
): number {
  const kind = KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind);
  return kind === 0 ? left.value.localeCompare(right.value) : kind;
}
