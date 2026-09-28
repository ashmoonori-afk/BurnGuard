import { createHash } from "node:crypto";
import path from "node:path";
import { FIGMA_IMPORT_LIMITS } from "@bg/shared/figma-import";
import {
  AcquisitionLimitError,
  throwIfAcquisitionAborted,
  type AcquisitionLimits,
} from "./extraction-acquisition";
import { FigmaImportError } from "./figma-import-errors";
import {
  PathBoundaryError,
  assertSafeName,
} from "../security/path-boundary";

export type FigmaExportAsset = {
  readonly relative_path: string;
  readonly bytes: Uint8Array;
  readonly media_type: "image/png" | "image/svg+xml";
};

export type ValidatedFigmaAsset = {
  readonly basename: string;
  readonly outputPath: string;
  readonly bytes: Uint8Array;
};

export function validateFigmaAssets(
  input: readonly FigmaExportAsset[],
  limits: AcquisitionLimits,
  signal?: AbortSignal,
): readonly ValidatedFigmaAsset[] {
  let aggregate = 0;
  const output: ValidatedFigmaAsset[] = [];
  const digestsByPath = new Map<string, string>();
  for (const asset of input) {
    throwIfAcquisitionAborted(signal);
    aggregate += asset.bytes.byteLength;
    if (
      aggregate > Math.min(limits.assetBytes, FIGMA_IMPORT_LIMITS.assetBytes)
    ) {
      throw new AcquisitionLimitError(
        "asset_bytes",
        limits.assetBytes,
        aggregate,
      );
    }
    const segments = asset.relative_path.replaceAll("\\", "/").split("/");
    if (segments.length === 0) failUnsafe();
    try {
      for (const segment of segments) assertSafeName(segment);
    } catch (error) {
      if (error instanceof PathBoundaryError) failUnsafe();
      throw error;
    }
    const basename = segments[segments.length - 1];
    if (basename === undefined || !mediaTypeMatches(basename, asset.media_type)) {
      failUnsafe();
    }
    const assetDigest = digestFigmaBytes(asset.bytes);
    // The digest keeps names distinct even when the readable part slugs to nothing (e.g. non-Latin names).
    const outputPath = `assets/${
      slugFigmaName(path.parse(basename).name) || "asset"
    }-${assetDigest.slice(0, 16)}.${asset.media_type === "image/png" ? "png" : "svg"}`;
    const previous = digestsByPath.get(outputPath);
    if (previous !== undefined && previous !== assetDigest) failUnsafe();
    digestsByPath.set(outputPath, assetDigest);
    output.push({
      basename: path.parse(basename).name,
      outputPath,
      bytes: asset.bytes,
    });
  }
  return output;
}

/**
 * Assigns exported images to selected nodes. An exact node-id match wins; a name match is used only when the
 * name is unique among the selection and matches exactly one unclaimed asset. Anything ambiguous is refused,
 * because an assigned reference becomes immutable.
 */
export function assignFigmaAssets(
  nodes: readonly { readonly id: string; readonly name: string }[],
  assets: readonly ValidatedFigmaAsset[],
): ReadonlyMap<string, ValidatedFigmaAsset> {
  const byKey = new Map<string, ValidatedFigmaAsset[]>();
  for (const asset of assets) {
    const key = figmaMatchKey(asset.basename);
    if (key !== "") byKey.set(key, [...(byKey.get(key) ?? []), asset]);
  }
  const assigned = new Map<string, ValidatedFigmaAsset>();
  const claimed = new Set<ValidatedFigmaAsset>();
  for (const node of nodes) {
    const idMatches = [...new Set(
      [node.id, node.id.replaceAll(":", "-")].map(figmaMatchKey).filter((key) => key !== "")
        .flatMap((key) => byKey.get(key) ?? []),
    )];
    if (idMatches.length > 1) throw new FigmaImportError("ambiguous_figma_asset");
    const match = idMatches[0];
    if (match !== undefined) {
      // Distinct ids can normalize to one key (a:b-c vs a-b:c); one asset never backs two references.
      if (claimed.has(match)) throw new FigmaImportError("ambiguous_figma_asset");
      assigned.set(node.id, match);
      claimed.add(match);
    }
  }
  const nameCounts = new Map<string, number>();
  for (const node of nodes) {
    const key = figmaMatchKey(node.name);
    if (key !== "") nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  for (const node of nodes) {
    if (assigned.has(node.id)) continue;
    const key = figmaMatchKey(node.name);
    const matches = key === "" ? [] : (byKey.get(key) ?? []).filter((asset) => !claimed.has(asset));
    if (matches.length === 0) continue;
    if (matches.length > 1 || (nameCounts.get(key) ?? 0) > 1) throw new FigmaImportError("ambiguous_figma_asset");
    const match = matches[0];
    if (match === undefined) continue;
    assigned.set(node.id, match);
    claimed.add(match);
  }
  return assigned;
}

export function nodeFileName(nodeId: string): string {
  // The readable prefix may collide ("a:b-c" vs "a-b:c"); the id digest keeps names injective.
  const readable = nodeId.replaceAll(":", "-").replaceAll(";", "_");
  return `${readable}-${createHash("sha256").update(nodeId).digest("hex").slice(0, 16)}`;
}

export function slugFigmaName(value: string): string {
  return value.normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
}

export function digestFigmaBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function mediaTypeMatches(
  fileName: string,
  mediaType: FigmaExportAsset["media_type"],
): boolean {
  const extension = path.extname(fileName).toLowerCase();
  return (mediaType === "image/png" && extension === ".png") ||
    (mediaType === "image/svg+xml" && extension === ".svg");
}

function failUnsafe(): never {
  throw new FigmaImportError("unsafe_figma_asset");
}

/** Unicode-aware comparison key for matching exported file names to node names; empty never matches. */
function figmaMatchKey(value: string): string {
  return value.normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 160);
}
