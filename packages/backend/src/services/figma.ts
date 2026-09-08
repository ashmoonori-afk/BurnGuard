/**
 * Minimal Figma REST API client for the design-system extraction
 * pipeline (P4.3). Two-way sync (publish back to Figma) is intentionally
 * out of scope.
 *
 * The fetch layer is split from the parse / extract layer so the
 * normalisation helpers can be unit-tested against canned API
 * responses without hitting the network.
 *
 * Auth: Figma uses a Personal Access Token in `X-Figma-Token`. The
 * token lives in `~/.burnguard/config.json` (chmod 600 — see
 * `loadConfig`). Never log or echo it.
 */

import { DEFAULT_ACQUISITION_LIMITS, ExtractionAcquisitionError, throwIfAcquisitionAborted, type AcquisitionLimits } from "./extraction-acquisition";
import { assertFigmaItemCount, readFigmaResponse } from "./extraction-figma-response";
import { FigmaApiError } from "./figma-errors";
import { createHash } from "node:crypto";

export { FigmaApiError };

const FIGMA_API_ROOT = "https://api.figma.com";

export interface FigmaFileMeta {
  name: string;
  lastModified: string;
  thumbnailUrl?: string | null;
  version?: string;
}

export interface FigmaPublishedStyle {
  key: string;
  fileKey: string;
  nodeId: string;
  name: string;
  description: string;
  styleType: "FILL" | "TEXT" | "EFFECT" | "GRID" | string;
}

interface FigmaNodePaint {
  type?: string;
  color?: { r: number; g: number; b: number; a?: number };
  opacity?: number;
  visible?: boolean;
}

interface FigmaTypeStyle {
  fontFamily?: string;
  fontPostScriptName?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
}

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  fills?: FigmaNodePaint[];
  style?: FigmaTypeStyle;
  // The styles map references published style keys by role, e.g. { fill: "K1:23" }.
  styles?: Record<string, string>;
}

export interface FigmaTokens {
  colors: Map<string, string>; // hex without '#'
  textStyles: Array<{
    name: string;
    fontFamily?: string;
    fontSizePx?: number;
    fontWeight?: number;
  }>;
  fontFamilies: string[]; // unique
}

/**
 * Parses a Figma URL into a file key.
 * Accepts:
 *   - https://www.figma.com/file/<key>/<title>
 *   - https://www.figma.com/design/<key>/<title>
 *   - https://www.figma.com/proto/<key>/...
 *   - bare <key>
 */
export function parseFigmaUrl(input: string): { fileKey: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new FigmaApiError("invalid_url", "Figma URL is empty.");
  }

  // Bare alphanumeric token = treat as already-extracted file key.
  if (/^[A-Za-z0-9]{8,}$/.test(trimmed)) {
    return { fileKey: trimmed };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new FigmaApiError(
      "invalid_url",
      `Could not parse Figma URL: ${trimmed}`,
    );
  }

  const host = url.hostname.toLowerCase();
  if (host !== "figma.com" && host !== "www.figma.com") {
    throw new FigmaApiError(
      "invalid_url",
      `Not a figma.com URL: ${url.origin}`,
    );
  }

  const segments = url.pathname.split("/").filter(Boolean);
  // Path layout: ["file" | "design" | "proto", <fileKey>, <title>?]
  const kindIdx = segments.findIndex(
    (s) => s === "file" || s === "design" || s === "proto",
  );
  if (kindIdx < 0 || !segments[kindIdx + 1]) {
    throw new FigmaApiError(
      "invalid_url",
      `Figma URL is missing a file key: ${trimmed}`,
    );
  }
  const fileKey = segments[kindIdx + 1];
  if (!/^[A-Za-z0-9]+$/.test(fileKey)) {
    throw new FigmaApiError(
      "invalid_url",
      `Figma file key is malformed: ${fileKey}`,
    );
  }
  return { fileKey };
}

async function figmaFetch(
  pathAndQuery: string,
  token: string,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!token) {
    throw new FigmaApiError("missing_token", "No Figma access token configured.");
  }
  let res: Response;
  try {
    res = await fetch(`${FIGMA_API_ROOT}${pathAndQuery}`, {
      headers: { "X-Figma-Token": token },
      signal,
    });
  } catch (err) {
    if (signal?.reason instanceof ExtractionAcquisitionError) throw signal.reason;
    throw new FigmaApiError(
      "fetch_failed",
      `Figma API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new FigmaApiError(
      "auth_failed",
      "Figma rejected the access token. Check the PAT value and that it has access to this file.",
      res.status,
    );
  }
  if (res.status === 404) {
    throw new FigmaApiError(
      "not_found",
      "Figma file not found. The file may be private to a different team or the key may be wrong.",
      404,
    );
  }
  if (res.status === 429) {
    throw new FigmaApiError(
      "rate_limited",
      "Figma rate limit hit. Wait a minute before retrying.",
      429,
    );
  }
  if (!res.ok) {
    throw new FigmaApiError(
      "fetch_failed",
      `Figma API returned HTTP ${res.status}.`,
      res.status,
    );
  }
  return readFigmaResponse(res, signal);
}

export async function fetchFigmaFileMeta(
  fileKey: string,
  token: string,
  signal?: AbortSignal,
): Promise<FigmaFileMeta> {
  // depth=1 keeps the response cheap — we only need top-level metadata.
  const json = (await figmaFetch(`/v1/files/${fileKey}?depth=1`, token, signal)) as {
    name: string;
    lastModified: string;
    thumbnailUrl?: string;
    version?: string;
  };
  return {
    name: json.name,
    lastModified: json.lastModified,
    thumbnailUrl: json.thumbnailUrl ?? null,
    version: json.version,
  };
}

export async function fetchFigmaPublishedStyles(
  fileKey: string,
  token: string,
  signal?: AbortSignal,
): Promise<FigmaPublishedStyle[]> {
  const json = (await figmaFetch(`/v1/files/${fileKey}/styles`, token, signal)) as {
    meta?: {
      styles?: Array<{
        key: string;
        file_key: string;
        node_id: string;
        name: string;
        description?: string;
        style_type: string;
      }>;
    };
  };
  const styles = json.meta?.styles ?? [];
  assertFigmaItemCount(styles.length);
  return styles.map((s) => ({
    key: s.key,
    fileKey: s.file_key,
    nodeId: s.node_id,
    name: s.name,
    description: s.description ?? "",
    styleType: s.style_type,
  }));
}

export async function fetchFigmaNodes(
  fileKey: string,
  nodeIds: string[],
  token: string,
  signal?: AbortSignal,
): Promise<Record<string, FigmaNode>> {
  if (nodeIds.length === 0) return {};
  const ids = encodeURIComponent(nodeIds.join(","));
  const json = (await figmaFetch(
    `/v1/files/${fileKey}/nodes?ids=${ids}`,
    token,
    signal,
  )) as {
    nodes: Record<string, { document?: FigmaNode } | null>;
  };
  const out: Record<string, FigmaNode> = {};
  const entries = Object.entries(json.nodes ?? {});
  assertFigmaItemCount(entries.length);
  for (const [id, wrapper] of entries) {
    throwIfAcquisitionAborted(signal);
    if (wrapper?.document) {
      out[id] = wrapper.document;
    }
  }
  return out;
}

/**
 * Pure: turns a list of published-style metadata + a node lookup into
 * the canonical token shape `writeCanonicalDesignSystem` expects to
 * see in its `analysis` argument.
 *
 * Color naming: published-style names are kebab-cased so they slot
 * straight into a CSS custom property (`--color-brand-primary`).
 */
export type FigmaTokenExtractionOptions = {
  readonly signal?: AbortSignal;
  readonly limits?: AcquisitionLimits;
};

export function extractFigmaTokens(
  styles: FigmaPublishedStyle[],
  nodes: Record<string, FigmaNode>,
  options: FigmaTokenExtractionOptions = {},
): FigmaTokens {
  const limits = options.limits ?? DEFAULT_ACQUISITION_LIMITS;
  assertFigmaItemCount(styles.length, limits);
  const colors = new Map<string, string>();
  const textStyles: FigmaTokens["textStyles"] = [];
  const fontFamilies = new Set<string>();
  const slugCounts = new Map<string, number>();
  for (const style of styles) {
    const slug = slugifyStyleName(style.name);
    slugCounts.set(slug, (slugCounts.get(slug) ?? 0) + 1);
  }

  for (const style of styles) {
    throwIfAcquisitionAborted(options.signal);
    const node = nodes[style.nodeId];
    if (!node) continue;
    const baseSlug = slugifyStyleName(style.name);
    const slug = baseSlug.length === 0 || (slugCounts.get(baseSlug) ?? 0) > 1
      ? `${baseSlug || "style"}--${createHash("sha256").update(style.key).digest("hex")}`
      : baseSlug;

    if (style.styleType === "FILL") {
      const hex = pickFirstFillHex(node.fills);
      if (hex) colors.set(`--color-${slug}`, hex);
    } else if (style.styleType === "TEXT") {
      const ts = node.style;
      if (ts) {
        textStyles.push({
          name: slug,
          fontFamily: ts.fontFamily,
          fontSizePx: ts.fontSize,
          fontWeight: ts.fontWeight,
        });
        if (ts.fontFamily) fontFamilies.add(ts.fontFamily);
      }
    }
    // EFFECT and GRID styles are intentionally skipped at MVP.
  }

  return {
    colors,
    textStyles,
    fontFamilies: [...fontFamilies].sort(),
  };
}

/**
 * Lower-cased, kebab-cased version of a Figma style name.
 * "Brand / Primary 50" → "brand-primary-50".
 */
export function slugifyStyleName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Resolves the first visible solid-paint fill on a node into a 6-digit
 * hex string (no leading '#'). Returns null when nothing usable is
 * present so the caller can skip the token.
 */
export function pickFirstFillHex(
  fills: FigmaNodePaint[] | undefined,
): string | null {
  if (!fills) return null;
  for (const fill of fills) {
    if (fill.visible === false) continue;
    if (fill.type !== "SOLID" || !fill.color) continue;
    const r = Math.round((fill.color.r ?? 0) * 255);
    const g = Math.round((fill.color.g ?? 0) * 255);
    const b = Math.round((fill.color.b ?? 0) * 255);
    return [r, g, b]
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")
      .toLowerCase();
  }
  return null;
}
