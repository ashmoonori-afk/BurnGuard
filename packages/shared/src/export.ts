import { UpgradeContractError, decodeContract } from "./contract-parser";
export { UpgradeContractError };

export type ExportFormat = "html_zip" | "pdf" | "png" | "pptx" | "handoff";
export type ExportStatus = "pending" | "running" | "succeeded" | "failed";
export type PdfPaper = "a4" | "letter" | "widescreen-16x9";
export type PptxSize = "16x9" | "4x3";

export type ExportOptions = {
  readonly skip_quality_check?: boolean;
  readonly pdf_paper?: PdfPaper;
  readonly png_width?: number;
  readonly png_height?: number;
  readonly png_dpr?: 1 | 2;
  readonly pptx_size?: PptxSize;
};

export function parseExportOptions(format: ExportFormat, input: unknown): ExportOptions {
  const record = decodeContract(input);
  switch (format) {
    case "html_zip": {
      requireKeys(record, ["skip_quality_check"]);
      const value = record["skip_quality_check"];
      if (value === undefined) return {};
      if (typeof value !== "boolean") invalid("skip_quality_check");
      return { skip_quality_check: value };
    }
    case "handoff":
      requireKeys(record, []);
      return {};
    case "pdf": {
      requireKeys(record, ["pdf_paper"]);
      const value = record["pdf_paper"] ?? "a4";
      if (value !== "a4" && value !== "letter" && value !== "widescreen-16x9") invalid("pdf_paper");
      return { pdf_paper: value };
    }
    case "png": {
      requireKeys(record, ["png_width", "png_height", "png_dpr"]);
      const width = boundedInteger(record["png_width"] ?? 1280, "png_width", 320, 4096);
      const height = boundedInteger(record["png_height"] ?? 720, "png_height", 240, 4096);
      const dpr = record["png_dpr"] ?? 1;
      if (dpr !== 1 && dpr !== 2) invalid("png_dpr");
      if (width * height * dpr * dpr > 16_000_000) invalid("png_width");
      return { png_width: width, png_height: height, png_dpr: dpr };
    }
    case "pptx": {
      requireKeys(record, ["pptx_size"]);
      const value = record["pptx_size"] ?? "16x9";
      if (value !== "16x9" && value !== "4x3") invalid("pptx_size");
      return { pptx_size: value };
    }
  }
}

function requireKeys(record: Readonly<Record<string, unknown>>, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) invalid(key);
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(field);
  return value;
}

function invalid(field: string): never {
  throw new UpgradeContractError("invalid_field", field);
}

export interface ExportJob {
  readonly id: string;
  readonly project_id: string;
  readonly format: ExportFormat;
  readonly status: ExportStatus;
  readonly output_path: string | null;
  readonly error_message: string | null;
  readonly size_bytes: number | null;
  readonly options: ExportOptions;
  readonly latest_attempt: import("./export-attempt").ExportAttempt | null;
  readonly created_at: number;
  readonly completed_at: number | null;
}
