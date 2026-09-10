import {
  UpgradeContractError,
  decodeContract,
  requiredNumber,
  requiredString,
} from "./contract-parser";

export const DESIGN_BRIEF_OUTPUT_TYPES = [
  "prototype",
  "slide_deck",
  "graphic",
  "from_template",
  "other",
] as const;
export const DESIGN_BRIEF_CONTENT_SOURCES = [
  "none",
  "attached",
  "template",
  "existing_files",
] as const;
export const DESIGN_BRIEF_BRAND_MODES = [
  "none",
  "selected_design_system",
  "template",
] as const;
export const DESIGN_BRIEF_VISUAL_MOODS = [
  "formal",
  "friendly",
  "premium",
] as const;
export const DESIGN_BRIEF_DENSITIES = [
  "sparse",
  "balanced",
  "dense",
] as const;
export const DESIGN_BRIEF_PAGE_LIMIT = 12;
export const DESIGN_BRIEF_OUTPUT_SIZES = [
  "responsive",
  "widescreen-16x9",
  "standard-4x3",
  "a4",
  "letter",
  "custom",
] as const;

export type DesignBriefOutputType =
  (typeof DESIGN_BRIEF_OUTPUT_TYPES)[number];
export type DesignBriefContentSource =
  (typeof DESIGN_BRIEF_CONTENT_SOURCES)[number];
export type DesignBriefBrandMode =
  (typeof DESIGN_BRIEF_BRAND_MODES)[number];
export type DesignBriefVisualMood =
  (typeof DESIGN_BRIEF_VISUAL_MOODS)[number];
export type DesignBriefDensity = (typeof DESIGN_BRIEF_DENSITIES)[number];
export type DesignBriefOutputSize =
  (typeof DESIGN_BRIEF_OUTPUT_SIZES)[number];

export type DesignBriefV1 = {
  readonly schema_version: 1;
  readonly output_type: DesignBriefOutputType;
  readonly audience: string;
  readonly objective: string;
  readonly content_source: DesignBriefContentSource;
  readonly locale: string;
  readonly brand_mode: DesignBriefBrandMode;
  readonly visual_mood: DesignBriefVisualMood;
  readonly density: DesignBriefDensity;
  readonly output_size: DesignBriefOutputSize;
  readonly section_count?: number;
  readonly pages?: readonly string[];
};

export function parseDesignBriefV1(input: unknown): DesignBriefV1 {
  const record = decodeContract(input);
  if (requiredNumber(record, "schema_version") !== 1) {
    invalid("schema_version");
  }
  const locale = boundedString(record, "locale", 32);
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale)) {
    invalid("locale");
  }
  const parsedOutputType = outputType(requiredString(record, "output_type"));
  const sectionCount = record.section_count;
  if (sectionCount !== undefined && (parsedOutputType !== "prototype" || typeof sectionCount !== "number" || !Number.isSafeInteger(sectionCount) || sectionCount < 1 || sectionCount > 30)) invalid("section_count");
  const pages = parsePages(record.pages, parsedOutputType);
  return {
    ...(typeof sectionCount === "number" ? { section_count: sectionCount } : {}),
    ...(pages === undefined ? {} : { pages }),
    schema_version: 1,
    output_type: parsedOutputType,
    audience: boundedString(record, "audience", 200),
    objective: boundedString(record, "objective", 1000),
    content_source: contentSource(requiredString(record, "content_source")),
    locale,
    brand_mode: brandMode(requiredString(record, "brand_mode")),
    visual_mood: visualMood(requiredString(record, "visual_mood")),
    density: density(requiredString(record, "density")),
    output_size: outputSize(requiredString(record, "output_size")),
  };
}

function parsePages(value: unknown, outputTypeValue: DesignBriefOutputType): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (outputTypeValue !== "prototype" || !Array.isArray(value) || value.length < 1 || value.length > DESIGN_BRIEF_PAGE_LIMIT) invalid("pages");
  const pagePattern = /^(?:[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*\/)*[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*\.html$/iu;
  if (!value.every((page): page is string => typeof page === "string" && pagePattern.test(page) && page.toLowerCase() !== "index.html")) invalid("pages");
  if (new Set(value.map((page) => page.toLowerCase())).size !== value.length) invalid("pages");
  return value;
}

function boundedString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  maxLength: number,
): string {
  const value = requiredString(record, key).trim();
  if (value.length === 0 || value.length > maxLength) invalid(key);
  return value;
}

function outputType(value: string): DesignBriefOutputType {
  switch (value) {
    case "prototype":
    case "slide_deck":
    case "graphic":
    case "from_template":
    case "other":
      return value;
    default:
      return invalid("output_type");
  }
}

function contentSource(value: string): DesignBriefContentSource {
  switch (value) {
    case "none":
    case "attached":
    case "template":
    case "existing_files":
      return value;
    default:
      return invalid("content_source");
  }
}

function brandMode(value: string): DesignBriefBrandMode {
  switch (value) {
    case "none":
    case "selected_design_system":
    case "template":
      return value;
    default:
      return invalid("brand_mode");
  }
}

function visualMood(value: string): DesignBriefVisualMood {
  switch (value) {
    case "formal":
    case "friendly":
    case "premium":
      return value;
    default:
      return invalid("visual_mood");
  }
}

function density(value: string): DesignBriefDensity {
  switch (value) {
    case "sparse":
    case "balanced":
    case "dense":
      return value;
    default:
      return invalid("density");
  }
}

function outputSize(value: string): DesignBriefOutputSize {
  switch (value) {
    case "responsive":
    case "widescreen-16x9":
    case "standard-4x3":
    case "a4":
    case "letter":
    case "custom":
      return value;
    default:
      return invalid("output_size");
  }
}

function invalid(path: string): never {
  throw new UpgradeContractError("invalid_field", path);
}
