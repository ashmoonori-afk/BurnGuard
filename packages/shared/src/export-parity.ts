import {
  UpgradeContractError,
  decodeContract,
  requiredArray,
  requiredNumber,
  requiredRecord,
  requiredString,
  type UnknownRecord,
} from "./contract-parser";

export const EXPORT_PARITY_SIMILARITY_THRESHOLD = 97;
const MAX_PARITY_PAGES = 100;

export type ExportParityStatus = "pass" | "warn";
export type ExportParityComparison = "pixel" | "structural";
export type ExportParityWarning =
  | "page_count_mismatch"
  | "dimension_mismatch"
  | "similarity_below_threshold"
  | "comparison_unavailable";

export type ExportParityDimensions = {
  readonly width: number;
  readonly height: number;
};

export type ExportParityPage = {
  readonly page: number;
  readonly source_dimensions: ExportParityDimensions;
  readonly output_dimensions: ExportParityDimensions;
  readonly similarity_score: number | null;
  readonly warnings: readonly ExportParityWarning[];
  readonly thumbnail_available: boolean;
  readonly thumbnail_sha256: string | null;
};

export type ExportParitySummary = {
  readonly schema_version: 1;
  readonly status: ExportParityStatus;
  readonly comparison: ExportParityComparison;
  readonly threshold: number;
  readonly source_page_count: number | null;
  readonly output_page_count: number | null;
  readonly pages: readonly ExportParityPage[];
  readonly warnings: readonly ExportParityWarning[];
};

export function parseExportParitySummary(input: unknown): ExportParitySummary {
  const record = decodeContract(input);
  exact(record, [
    "schema_version",
    "status",
    "comparison",
    "threshold",
    "source_page_count",
    "output_page_count",
    "pages",
    "warnings",
  ]);
  if (record["schema_version"] !== 1) invalid("schema_version");
  const status = parityStatus(requiredString(record, "status"));
  const comparison = parityComparison(requiredString(record, "comparison"));
  const threshold = score(requiredNumber(record, "threshold"), "threshold");
  const sourcePageCount = nullableCount(record, "source_page_count");
  const outputPageCount = nullableCount(record, "output_page_count");
  const pages = requiredArray(record, "pages").map((value, index) =>
    parsePage(value, index, threshold),
  );
  const warnings = requiredArray(record, "warnings").map((value, index) =>
    parityWarning(value, `warnings.${index}`),
  );
  if (pages.length > MAX_PARITY_PAGES) invalid("pages");
  requireUnique(warnings, "warnings");
  const countMismatch =
    sourcePageCount !== null &&
    outputPageCount !== null &&
    sourcePageCount !== outputPageCount;
  if (warnings.includes("page_count_mismatch") !== countMismatch) {
    invalid("warnings");
  }
  if (
    comparison === "pixel" &&
    (sourcePageCount === null ||
      outputPageCount === null ||
      warnings.includes("comparison_unavailable"))
  ) {
    invalid("comparison");
  }
  if (comparison === "structural" && pages.length > 0) invalid("pages");
  const expectedStatus =
    warnings.length > 0 || pages.some((page) => page.warnings.length > 0)
      ? "warn"
      : "pass";
  if (status !== expectedStatus) invalid("status");
  if (
    comparison === "pixel" &&
    sourcePageCount !== null &&
    outputPageCount !== null &&
    pages.length !== Math.min(sourcePageCount, outputPageCount)
  ) {
    invalid("pages");
  }
  return {
    schema_version: 1,
    status,
    comparison,
    threshold,
    source_page_count: sourcePageCount,
    output_page_count: outputPageCount,
    pages,
    warnings,
  };
}

function parsePage(
  input: unknown,
  index: number,
  threshold: number,
): ExportParityPage {
  const record = requiredRecord({ value: input }, "value");
  exact(record, [
    "page",
    "source_dimensions",
    "output_dimensions",
    "similarity_score",
    "warnings",
    "thumbnail_available",
    "thumbnail_sha256",
  ]);
  const page = count(requiredNumber(record, "page"), `pages.${index}.page`, 1);
  if (page !== index + 1) invalid(`pages.${index}.page`);
  const similarityValue = record["similarity_score"];
  const similarity =
    similarityValue === null
      ? null
      : score(requiredNumber(record, "similarity_score"), `pages.${index}.similarity_score`);
  const thumbnailAvailable = record["thumbnail_available"];
  if (typeof thumbnailAvailable !== "boolean") invalid(`pages.${index}.thumbnail_available`);
  const thumbnailDigest = record["thumbnail_sha256"];
  if (
    thumbnailDigest !== null &&
    (typeof thumbnailDigest !== "string" || !/^[0-9a-f]{64}$/u.test(thumbnailDigest))
  ) {
    invalid(`pages.${index}.thumbnail_sha256`);
  }
  if (thumbnailAvailable !== (thumbnailDigest !== null)) {
    invalid(`pages.${index}.thumbnail_available`);
  }
  const warnings = requiredArray(record, "warnings").map((value, warningIndex) =>
    parityWarning(value, `pages.${index}.warnings.${warningIndex}`),
  );
  requireUnique(warnings, `pages.${index}.warnings`);
  if (similarity === null) invalid(`pages.${index}.similarity_score`);
  if (
    warnings.includes("similarity_below_threshold") !==
    (similarity < threshold)
  ) {
    invalid(`pages.${index}.warnings`);
  }
  return {
    page,
    source_dimensions: dimensions(
      requiredRecord(record, "source_dimensions"),
      `pages.${index}.source_dimensions`,
    ),
    output_dimensions: dimensions(
      requiredRecord(record, "output_dimensions"),
      `pages.${index}.output_dimensions`,
    ),
    similarity_score: similarity,
    warnings,
    thumbnail_available: thumbnailAvailable,
    thumbnail_sha256: thumbnailDigest,
  };
}

function dimensions(record: UnknownRecord, path: string): ExportParityDimensions {
  exact(record, ["width", "height"]);
  return {
    width: count(requiredNumber(record, "width"), `${path}.width`, 1),
    height: count(requiredNumber(record, "height"), `${path}.height`, 1),
  };
}

function parityStatus(value: string): ExportParityStatus {
  if (value === "pass" || value === "warn") return value;
  return invalid("status");
}

function parityComparison(value: string): ExportParityComparison {
  if (value === "pixel" || value === "structural") return value;
  return invalid("comparison");
}

function parityWarning(value: unknown, path: string): ExportParityWarning {
  if (
    value === "page_count_mismatch" ||
    value === "dimension_mismatch" ||
    value === "similarity_below_threshold" ||
    value === "comparison_unavailable"
  ) {
    return value;
  }
  return invalid(path);
}

function nullableCount(record: UnknownRecord, key: string): number | null {
  return record[key] === null ? null : count(requiredNumber(record, key), key, 0);
}

function count(value: number, path: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) invalid(path);
  return value;
}

function score(value: number, path: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) invalid(path);
  return value;
}

function requireUnique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) invalid(path);
}

function exact(record: UnknownRecord, keys: readonly string[]): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) if (!allowed.has(key)) invalid(key);
  for (const key of keys) {
    if (!(key in record)) throw new UpgradeContractError("missing_required_field", key);
  }
}

function invalid(path: string): never {
  throw new UpgradeContractError("invalid_field", path);
}
