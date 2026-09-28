import {
  FIGMA_IMPORT_LIMITS,
  FigmaImportContractError,
  parseFigmaNodeIds,
} from "@bg/shared/figma-import";
import {
  AcquisitionLimitError,
  DEFAULT_ACQUISITION_LIMITS,
  ExtractionAcquisitionError,
  throwIfAcquisitionAborted,
} from "../services/extraction-acquisition";
import {
  parseFigmaImportDocument,
  type FigmaExportAsset,
  type FigmaImportDocument,
} from "../services/figma-import";
import { FigmaImportError } from "../services/figma-import-errors";

const SHA256 = /^[a-f0-9]{64}$/u;

export type ParsedFigmaExportForm = {
  readonly expectedRevision: number;
  readonly expectedDigest: string;
  readonly sourceFileName: string;
  readonly document: FigmaImportDocument;
  readonly nodeIds: readonly string[];
  readonly assets: readonly FigmaExportAsset[];
};

export async function parseFigmaExportForm(
  form: FormData,
  signal: AbortSignal,
): Promise<ParsedFigmaExportForm> {
  throwIfAcquisitionAborted(signal);
  const allowed = new Set([
    "expected_revision",
    "expected_artifact_digest",
    "node_ids",
    "document",
    "assets",
    "asset_paths",
  ]);
  if ([...form.keys()].some((key) => !allowed.has(key))) invalidRequest();
  const rawRevision = form.get("expected_revision");
  const expectedDigest = form.get("expected_artifact_digest");
  const rawNodeIds = form.get("node_ids");
  const documentFile = form.get("document");
  const files = form.getAll("assets");
  const paths = form.getAll("asset_paths");
  const expectedRevision = typeof rawRevision === "string"
    ? Number(rawRevision)
    : Number.NaN;
  if (
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    typeof expectedDigest !== "string" ||
    !SHA256.test(expectedDigest) ||
    typeof rawNodeIds !== "string" ||
    !(documentFile instanceof File) ||
    documentFile.size > Math.min(
      DEFAULT_ACQUISITION_LIMITS.figmaBodyBytes,
      FIGMA_IMPORT_LIMITS.documentBytes,
    ) ||
    files.length !== paths.length ||
    files.length > Math.min(
      DEFAULT_ACQUISITION_LIMITS.assets,
      FIGMA_IMPORT_LIMITS.assets,
    )
  ) invalidRequest();
  assertAssetLimits(files);
  const { nodeIds, documentJson } = await readDocument(
    rawNodeIds,
    documentFile,
    signal,
  );
  const assets: FigmaExportAsset[] = [];
  for (let index = 0; index < files.length; index += 1) {
    throwIfAcquisitionAborted(signal);
    const file = files[index];
    const relativePath = paths[index];
    if (!(file instanceof File) || typeof relativePath !== "string") {
      invalidRequest();
    }
    const mediaType = file.type === "image/png" ||
        file.name.toLowerCase().endsWith(".png")
      ? "image/png" as const
      : file.type === "image/svg+xml" ||
          file.name.toLowerCase().endsWith(".svg")
      ? "image/svg+xml" as const
      : null;
    if (mediaType === null) throw new FigmaImportError("unsafe_figma_asset");
    assets.push({
      relative_path: relativePath,
      bytes: new Uint8Array(await file.arrayBuffer()),
      media_type: mediaType,
    });
  }
  return {
    expectedRevision,
    expectedDigest,
    sourceFileName: documentFile.name,
    document: parseFigmaImportDocument(
      documentJson,
      DEFAULT_ACQUISITION_LIMITS,
      signal,
    ),
    nodeIds,
    assets,
  };
}

function assertAssetLimits(files: readonly FormDataEntryValue[]): void {
  let aggregateAssetBytes = 0;
  for (const file of files) {
    if (!(file instanceof File)) invalidRequest();
    aggregateAssetBytes += file.size;
    if (
      aggregateAssetBytes >
      Math.min(
        DEFAULT_ACQUISITION_LIMITS.assetBytes,
        FIGMA_IMPORT_LIMITS.assetBytes,
      )
    ) {
      throw new AcquisitionLimitError(
        "asset_bytes",
        DEFAULT_ACQUISITION_LIMITS.assetBytes,
        aggregateAssetBytes,
      );
    }
  }
}

async function readDocument(
  rawNodeIds: string,
  documentFile: File,
  signal: AbortSignal,
): Promise<{ readonly nodeIds: readonly string[]; readonly documentJson: unknown }> {
  try {
    throwIfAcquisitionAborted(signal);
    const nodeIds = parseFigmaNodeIds(JSON.parse(rawNodeIds));
    const documentJson: unknown = JSON.parse(await documentFile.text());
    return { nodeIds, documentJson };
  } catch (error) {
    if (
      error instanceof FigmaImportContractError ||
      error instanceof ExtractionAcquisitionError
    ) throw error;
    throw new FigmaImportError("invalid_figma_export");
  }
}

function invalidRequest(): never {
  throw new FigmaImportContractError("invalid_figma_request");
}
