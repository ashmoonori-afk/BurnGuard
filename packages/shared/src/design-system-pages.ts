import { isRecord, UpgradeContractError } from "./contract-parser";

export const PAGE_TYPES = ["home", "pricing", "blog", "docs", "product", "about", "contact", "other"] as const;
export type DesignSystemPageType = (typeof PAGE_TYPES)[number];
export const PAGE_SOURCES = ["entry", "nav", "footer", "sitemap", "link"] as const;
export const PAGE_SKIP_REASONS = ["robots", "cap", "fetch_failed"] as const;
export const DEFAULT_PAGE_LIMIT = 12;
export const MAX_PAGE_LIMIT = 24;

export type DesignSystemPageRecord = {
  /** Same-origin path, canonicalized: no hash, no query, no trailing slash except the root. */
  readonly path: string;
  readonly page_type: DesignSystemPageType;
  readonly source: (typeof PAGE_SOURCES)[number];
  readonly status: "extracted" | "skipped";
  readonly skip_reason: (typeof PAGE_SKIP_REASONS)[number] | null;
  /** Layout tokens measured from this page's own CSS; only observed values. */
  readonly layout_tokens: Readonly<Record<string, string>>;
  readonly patterns: readonly string[];
  readonly colors: readonly string[];
  readonly fonts: readonly string[];
};

export type DesignSystemPageTemplate = {
  readonly page_type: DesignSystemPageType;
  readonly path: string;
  readonly patterns: readonly string[];
  readonly layout_tokens: Readonly<Record<string, string>>;
};

/** A value that differs between extracted pages, recorded instead of silently averaged. */
export type DesignSystemPageDifference = {
  readonly key: string;
  readonly values: readonly { readonly path: string; readonly value: string }[];
};

export type DesignSystemPageCoverage = {
  readonly schema_version: 1;
  readonly page_limit: number;
  readonly discovered: number;
  readonly pages: readonly DesignSystemPageRecord[];
  readonly templates: readonly DesignSystemPageTemplate[];
  readonly differences: readonly DesignSystemPageDifference[];
};

const PATH = /^\/[\x21-\x7e]{0,300}$/;
const KEY = /^[a-z0-9-]{1,80}$/;
const TOKEN_NAME = /^--layout-[a-z0-9-]{1,70}$/;
const SHORT_TEXT = /^[^\p{Cc}<>]{1,160}$/u;
const MAX_PAGES = 200;

export function parseDesignSystemPageCoverage(input: unknown): DesignSystemPageCoverage {
  const invalid = (): never => { throw new UpgradeContractError("invalid_field", "design_system_pages"); };
  const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
    isRecord(value) && Object.keys(value).length === keys.length && keys.every(key => key in value);
  const strings = (value: unknown, pattern: RegExp, max: number): string[] =>
    Array.isArray(value) && value.length <= max && value.every(item => typeof item === "string" && pattern.test(item)) ? [...value as string[]] : invalid();
  const tokens = (value: unknown): Record<string, string> => {
    if (!isRecord(value) || Object.keys(value).length > 32) return invalid();
    return Object.fromEntries(Object.entries(value).map(([key, token]) => TOKEN_NAME.test(key) && typeof token === "string" && SHORT_TEXT.test(token) && !/url\s*\(/i.test(token) ? [key, token] : invalid()));
  };
  const pageType = (value: unknown): DesignSystemPageType => PAGE_TYPES.find(type => type === value) ?? invalid();
  const path = (value: unknown): string => typeof value === "string" && PATH.test(value) ? value : invalid();

  if (!exact(input, ["schema_version", "page_limit", "discovered", "pages", "templates", "differences"]) || input.schema_version !== 1) return invalid();
  const pageLimit = input.page_limit;
  const discovered = input.discovered;
  if (!Number.isInteger(pageLimit) || (pageLimit as number) < 1 || (pageLimit as number) > MAX_PAGE_LIMIT || !Number.isInteger(discovered) || (discovered as number) < 0 || (discovered as number) > 10_000) return invalid();
  if (!Array.isArray(input.pages) || input.pages.length > MAX_PAGES || !Array.isArray(input.templates) || input.templates.length > PAGE_TYPES.length || !Array.isArray(input.differences) || input.differences.length > 64) return invalid();

  const pages = input.pages.map((page): DesignSystemPageRecord => {
    if (!exact(page, ["path", "page_type", "source", "status", "skip_reason", "layout_tokens", "patterns", "colors", "fonts"])) return invalid();
    const status = page.status === "extracted" || page.status === "skipped" ? page.status : invalid();
    const skipReason = page.skip_reason === null ? null : PAGE_SKIP_REASONS.find(reason => reason === page.skip_reason) ?? invalid();
    if ((status === "skipped") !== (skipReason !== null)) return invalid();
    return {
      path: path(page.path),
      page_type: pageType(page.page_type),
      source: PAGE_SOURCES.find(source => source === page.source) ?? invalid(),
      status,
      skip_reason: skipReason,
      layout_tokens: tokens(page.layout_tokens),
      patterns: strings(page.patterns, KEY, 16),
      colors: strings(page.colors, SHORT_TEXT, 12),
      fonts: strings(page.fonts, SHORT_TEXT, 6),
    };
  });
  if (new Set(pages.map(page => page.path)).size !== pages.length) return invalid();
  const templates = input.templates.map((template): DesignSystemPageTemplate => {
    if (!exact(template, ["page_type", "path", "patterns", "layout_tokens"])) return invalid();
    return { page_type: pageType(template.page_type), path: path(template.path), patterns: strings(template.patterns, KEY, 16), layout_tokens: tokens(template.layout_tokens) };
  });
  if (new Set(templates.map(template => template.page_type)).size !== templates.length) return invalid();
  const differences = input.differences.map((difference): DesignSystemPageDifference => {
    if (!exact(difference, ["key", "values"]) || typeof difference.key !== "string" || !SHORT_TEXT.test(difference.key) || !Array.isArray(difference.values) || difference.values.length < 2 || difference.values.length > MAX_PAGES) return invalid();
    return {
      key: difference.key,
      values: difference.values.map(value => exact(value, ["path", "value"]) && typeof value.value === "string" && SHORT_TEXT.test(value.value) ? { path: path(value.path), value: value.value } : invalid()),
    };
  });
  return { schema_version: 1, page_limit: pageLimit as number, discovered: discovered as number, pages, templates, differences };
}
