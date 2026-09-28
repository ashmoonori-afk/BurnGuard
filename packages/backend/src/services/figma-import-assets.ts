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
    const outputPath = `assets/${
      slugFigmaName(path.parse(basename).name) || "asset"
    }.${asset.media_type === "image/png" ? "png" : "svg"}`;
    const assetDigest = digestFigmaBytes(asset.bytes);
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

export function assetForFigmaNode(
  nodeId: string,
  nodeName: string,
  assets: readonly ValidatedFigmaAsset[],
): ValidatedFigmaAsset | undefined {
  const names = new Set([
    slugFigmaName(nodeName),
    slugFigmaName(nodeId),
    slugFigmaName(nodeId.replaceAll(":", "-")),
  ]);
  return assets.find((asset) => names.has(slugFigmaName(asset.basename)));
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
