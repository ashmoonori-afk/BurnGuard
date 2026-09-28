import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type {
  ExportFormat,
  ExportParitySummary,
} from "@bg/shared";
import { resolveWithin } from "../security/path-boundary";
import {
  attachParityThumbnails,
  decodeParityImage,
  pdfParityPages,
} from "./export-parity-images";
import {
  pptxParityImages,
  zipParityImages,
} from "./export-parity-archives";
import { buildStructuralParity, type ParityPixelPage } from "./export-parity";
import { canonicalJson } from "./export-receipt";
import type {
  ExportValidation,
  PngZipValidation,
} from "./export-receipt-validation";

export const EXPORT_PARITY_FILE = "parity.json";
export const EXPORT_PARITY_DIRECTORY = "parity";

export async function writeExportParityArtifacts(input: {
  readonly stageRoot: string;
  readonly outputPath: string;
  readonly format: ExportFormat;
  readonly validation: ExportValidation;
  readonly sourcePages: readonly ParityPixelPage[];
  readonly signal: AbortSignal;
}): Promise<ExportParitySummary> {
  const parityRoot = resolveWithin(input.stageRoot, EXPORT_PARITY_DIRECTORY);
  await mkdir(parityRoot, { recursive: true });
  let summary: ExportParitySummary;
  try {
    summary = await pixelParity(input, parityRoot);
  } catch (error) {
    if (input.signal.aborted) throw error;
    await rm(resolveWithin(parityRoot, "thumbnails"), {
      recursive: true,
      force: true,
    });
    summary = structuralFallback(input.format, input.validation, true);
  }
  await writeFile(
    resolveWithin(parityRoot, EXPORT_PARITY_FILE),
    canonicalJson(summary),
    "utf8",
  );
  return summary;
}

export async function writeUnavailableExportParity(input: {
  readonly stageRoot: string;
  readonly format: ExportFormat;
  readonly validation: ExportValidation;
}): Promise<ExportParitySummary> {
  const parityRoot = resolveWithin(input.stageRoot, EXPORT_PARITY_DIRECTORY);
  await rm(resolveWithin(parityRoot, "thumbnails"), {
    recursive: true,
    force: true,
  });
  await mkdir(parityRoot, { recursive: true });
  const summary = structuralFallback(input.format, input.validation, true);
  await writeFile(
    resolveWithin(parityRoot, EXPORT_PARITY_FILE),
    canonicalJson(summary),
    "utf8",
  );
  return summary;
}

async function pixelParity(
  input: Parameters<typeof writeExportParityArtifacts>[0],
  parityRoot: string,
): Promise<ExportParitySummary> {
  if (!isPixelFormat(input.format)) {
    return structuralFallback(input.format, input.validation, false);
  }
  const outputBytes = new Uint8Array(await readFile(input.outputPath));
  const output = await outputPages(
    input.format,
    outputBytes,
    input.validation,
    input.signal,
  );
  const source = input.sourcePages;
  if (source.length === 0) {
    throw new TypeError("Export parity source evidence is unavailable");
  }
  const result = attachParityThumbnails(source, output, {
    warnDimensionMismatch: input.format !== "pdf",
  });
  const thumbnailsRoot = resolveWithin(parityRoot, "thumbnails");
  await mkdir(thumbnailsRoot, { recursive: true });
  for (const thumbnail of result.thumbnails) {
    await writeFile(
      resolveWithin(
        thumbnailsRoot,
        `page-${String(thumbnail.page).padStart(3, "0")}.png`,
      ),
      thumbnail.bytes,
    );
  }
  return result.summary;
}

export type ParitySourceCollector = {
  readonly add: (png: Uint8Array) => Promise<void>;
  readonly unavailable: () => void;
  readonly pages: () => readonly ParityPixelPage[];
};

export function createParitySourceCollector(
  signal: AbortSignal,
  decode: (png: Uint8Array) => Promise<ParityPixelPage> = decodeParityImage,
): ParitySourceCollector {
  const values: ParityPixelPage[] = [];
  let available = true;
  return {
    add: async (png) => {
      if (!available) return;
      try {
        values.push(await decode(png));
      } catch (error) {
        signal.throwIfAborted();
        available = false;
        values.length = 0;
        void error;
      }
    },
    unavailable: () => {
      available = false;
      values.length = 0;
    },
    pages: () => (available ? values : []),
  };
}

async function outputPages(
  format: "pdf" | "png" | "png_zip" | "pptx",
  bytes: Uint8Array,
  validation: ExportValidation,
  signal: AbortSignal,
): Promise<readonly ParityPixelPage[]> {
  switch (format) {
    case "pdf":
      return pdfParityPages(bytes, signal);
    case "png":
      return [await decodeParityImage(bytes)];
    case "png_zip":
      if (!isPngZipValidation(validation)) {
        throw new TypeError("PNG ZIP parity validation is unavailable");
      }
      return zipParityImages(
        bytes,
        validation.outputs.map((output) => output.rel_path),
      );
    case "pptx": {
      const count =
        "slides" in validation && typeof validation.slides === "number"
          ? validation.slides
          : 0;
      return pptxParityImages(bytes, count);
    }
  }
}

function structuralFallback(
  format: ExportFormat,
  validation: ExportValidation,
  comparisonUnavailable: boolean,
): ExportParitySummary {
  const count = validationPageCount(format, validation);
  const sourceCount = format === "svg" ? 1 : null;
  return buildStructuralParity({
    sourcePageCount: sourceCount,
    outputPageCount: count,
    ...(comparisonUnavailable ? { comparisonUnavailable: true } : {}),
  });
}

function validationPageCount(
  format: ExportFormat,
  validation: ExportValidation,
): number | null {
  if (format === "svg") return 1;
  if ("pages" in validation && typeof validation.pages === "number") {
    return validation.pages;
  }
  if ("slides" in validation && typeof validation.slides === "number") {
    return validation.slides;
  }
  if ("aggregate" in validation) return validation.aggregate.frames;
  return null;
}

function isPixelFormat(
  format: ExportFormat,
): format is "pdf" | "png" | "png_zip" | "pptx" {
  return (
    format === "pdf" ||
    format === "png" ||
    format === "png_zip" ||
    format === "pptx"
  );
}

function isPngZipValidation(
  validation: ExportValidation,
): validation is PngZipValidation {
  return "transformation_version" in validation && "aggregate" in validation;
}
