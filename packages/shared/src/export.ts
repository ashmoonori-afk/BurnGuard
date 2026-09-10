import { UpgradeContractError, decodeContract } from "./contract-parser";
export { UpgradeContractError };

export type ExportFormat =
  | "html_zip"
  | "pdf"
  | "png"
  | "pptx"
  | "handoff"
  | "png_zip"
  | "cafe24_package"
  | "imweb_package";
export type ExportStatus = "pending" | "running" | "succeeded" | "failed";
export type PdfPaper = "a4" | "letter" | "widescreen-16x9" | "artboard";
export type PptxSize = "16x9" | "4x3";

export type ExportOptions = {
  readonly pdf_paper?: PdfPaper;
  readonly png_width?: number;
  readonly png_height?: number;
  readonly png_dpr?: 1 | 2;
  readonly pptx_size?: PptxSize;
  readonly asset_base_url?: string;
  readonly slice_height?: 3000 | 5000;
  readonly slice_format?: "png" | "jpeg";
  readonly jpeg_quality?: number;
};

export function parseExportOptions(format: ExportFormat, input: unknown): ExportOptions {
  const record = decodeContract(input);
  switch (format) {
    case "html_zip":
    case "handoff":
      requireKeys(record, []);
      return {};
    case "cafe24_package":
    case "imweb_package": {
      requireKeys(record, ["asset_base_url"]);
      const assetBaseUrl = record["asset_base_url"];
      if (assetBaseUrl === undefined) return {};
      if (!isSafeAssetBaseUrl(assetBaseUrl)) invalid("asset_base_url");
      return { asset_base_url: assetBaseUrl };
    }
    case "pdf": {
      requireKeys(record, ["pdf_paper"]);
      const value = record["pdf_paper"] ?? "a4";
      if (value !== "a4" && value !== "letter" && value !== "widescreen-16x9" && value !== "artboard") invalid("pdf_paper");
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
    case "png_zip": {
      requireKeys(record, ["slice_height", "slice_format", "jpeg_quality"]);
      const sliceHeight = record["slice_height"] ?? 5000;
      if (sliceHeight !== 3000 && sliceHeight !== 5000) invalid("slice_height");
      const sliceFormat = record["slice_format"] ?? "png";
      if (sliceFormat !== "png" && sliceFormat !== "jpeg") invalid("slice_format");
      const jpegQuality = record["jpeg_quality"];
      if (jpegQuality !== undefined && sliceFormat !== "jpeg") invalid("jpeg_quality");
      if (jpegQuality !== undefined && (typeof jpegQuality !== "number" || !Number.isSafeInteger(jpegQuality) || jpegQuality < 60 || jpegQuality > 95)) invalid("jpeg_quality");
      return sliceFormat === "jpeg"
        ? { slice_height: sliceHeight, slice_format: sliceFormat, jpeg_quality: jpegQuality ?? 85 }
        : { slice_height: sliceHeight, slice_format: sliceFormat };
    }
  }
}

function isSafeAssetBaseUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
  if (/[\\?#]/u.test(value) || [...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127) || /%2f|%5c/iu.test(value)) return false;
  const pathValue = value.startsWith("/") ? value : value.replace(/^https:\/\/[^/]+/iu, "");
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathValue);
  } catch (error) {
    if (error instanceof URIError) return false;
    throw error;
  }
  if (decodedPath.split("/").some((segment) => segment === "..")) return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" && url.search === "" && url.hash === "";
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
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
