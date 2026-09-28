import {
  EXPORT_PARITY_SIMILARITY_THRESHOLD,
  type ExportParityDimensions,
  type ExportParityPage,
  type ExportParitySummary,
  type ExportParityWarning,
} from "@bg/shared";

const SAMPLE_SIZE = 64;
const ASPECT_RATIO_TOLERANCE = 0.01;

export type ParityPixelPage = ExportParityDimensions & {
  readonly raster_width: number;
  readonly raster_height: number;
  readonly rgba: Uint8Array;
};

export function compareParityPages(input: {
  readonly source: readonly ParityPixelPage[];
  readonly output: readonly ParityPixelPage[];
  readonly threshold?: number;
  readonly warnDimensionMismatch?: boolean;
  readonly expectedOutputAspects?: readonly number[];
}): ExportParitySummary {
  const threshold = input.threshold ?? EXPORT_PARITY_SIMILARITY_THRESHOLD;
  const count = Math.min(input.source.length, input.output.length);
  const pages = Array.from({ length: count }, (_, index) =>
    comparePage(
      input.source[index],
      input.output[index],
      index + 1,
      threshold,
      input.warnDimensionMismatch ?? true,
      input.expectedOutputAspects,
    ),
  );
  const warnings: ExportParityWarning[] =
    input.source.length === input.output.length ? [] : ["page_count_mismatch"];
  return {
    schema_version: 1,
    status:
      warnings.length > 0 || pages.some((page) => page.warnings.length > 0)
        ? "warn"
        : "pass",
    comparison: "pixel",
    threshold,
    source_page_count: input.source.length,
    output_page_count: input.output.length,
    pages,
    warnings,
  };
}

export function buildStructuralParity(input: {
  readonly sourcePageCount: number | null;
  readonly outputPageCount: number | null;
  readonly comparisonUnavailable?: boolean;
}): ExportParitySummary {
  const countMismatch =
    input.sourcePageCount !== null &&
    input.outputPageCount !== null &&
    input.sourcePageCount !== input.outputPageCount;
  const warnings: ExportParityWarning[] = [
    ...(countMismatch ? ["page_count_mismatch" as const] : []),
    ...(input.comparisonUnavailable ? ["comparison_unavailable" as const] : []),
  ];
  return {
    schema_version: 1,
    status: warnings.length > 0 ? "warn" : "pass",
    comparison: "structural",
    threshold: EXPORT_PARITY_SIMILARITY_THRESHOLD,
    source_page_count: input.sourcePageCount,
    output_page_count: input.outputPageCount,
    pages: [],
    warnings,
  };
}

function comparePage(
  source: ParityPixelPage | undefined,
  output: ParityPixelPage | undefined,
  page: number,
  threshold: number,
  warnDimensionMismatch: boolean,
  expectedOutputAspects?: readonly number[],
): ExportParityPage {
  if (source === undefined || output === undefined) {
    throw new TypeError("Parity page pair is missing");
  }
  requirePixels(source);
  requirePixels(output);
  const similarity = similarityScore(source, output);
  const outputAspect = output.width / output.height;
  const expected = expectedOutputAspects ?? [source.width / source.height];
  const dimensionMismatch = expected.every(
    (aspect) => Math.abs(aspect - outputAspect) / aspect > ASPECT_RATIO_TOLERANCE,
  );
  const warnings: ExportParityWarning[] = [
    ...(warnDimensionMismatch && dimensionMismatch
      ? ["dimension_mismatch" as const]
      : []),
    ...(similarity < threshold ? ["similarity_below_threshold" as const] : []),
  ];
  return {
    page,
    source_dimensions: { width: source.width, height: source.height },
    output_dimensions: { width: output.width, height: output.height },
    similarity_score: similarity,
    warnings,
    thumbnail_available: false,
    thumbnail_sha256: null,
  };
}

function similarityScore(
  source: ParityPixelPage,
  output: ParityPixelPage,
): number {
  let difference = 0;
  for (let y = 0; y < SAMPLE_SIZE; y += 1) {
    for (let x = 0; x < SAMPLE_SIZE; x += 1) {
      const sourceOffset = sampleOffset(source, x, y);
      const outputOffset = sampleOffset(output, x, y);
      for (let channel = 0; channel < 3; channel += 1) {
        difference += Math.abs(
          compositedChannel(source.rgba, sourceOffset, channel) -
            compositedChannel(output.rgba, outputOffset, channel),
        );
      }
    }
  }
  const maximum = SAMPLE_SIZE * SAMPLE_SIZE * 3 * 255;
  return Math.round((1 - difference / maximum) * 100);
}

function sampleOffset(page: ParityPixelPage, x: number, y: number): number {
  const sourceX = Math.min(
    page.raster_width - 1,
    Math.floor(((x + 0.5) * page.raster_width) / SAMPLE_SIZE),
  );
  const sourceY = Math.min(
    page.raster_height - 1,
    Math.floor(((y + 0.5) * page.raster_height) / SAMPLE_SIZE),
  );
  return (sourceY * page.raster_width + sourceX) * 4;
}

function compositedChannel(
  rgba: Uint8Array,
  offset: number,
  channel: number,
): number {
  const alpha = (rgba[offset + 3] ?? 0) / 255;
  return Math.round((rgba[offset + channel] ?? 0) * alpha + 255 * (1 - alpha));
}

function requirePixels(page: ParityPixelPage): void {
  if (
    !Number.isSafeInteger(page.width) ||
    !Number.isSafeInteger(page.height) ||
    page.width <= 0 ||
    page.height <= 0 ||
    !Number.isSafeInteger(page.raster_width) ||
    !Number.isSafeInteger(page.raster_height) ||
    page.raster_width <= 0 ||
    page.raster_height <= 0 ||
    page.rgba.length !== page.raster_width * page.raster_height * 4
  ) {
    throw new TypeError("Invalid parity pixels");
  }
}
