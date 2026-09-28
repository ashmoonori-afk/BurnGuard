import { parse, type HTMLElement } from "node-html-parser";
import {
  PAGE_TYPES,
  type DesignSystemPageCoverage,
  type DesignSystemPageDifference,
  type DesignSystemPageRecord,
  type DesignSystemPageTemplate,
  type DesignSystemPageType,
} from "@bg/shared";
import type { SourceEvidence } from "./extraction-evidence";

export type RobotsRules = { readonly allows: (path: string) => boolean; readonly sitemaps: readonly string[] };

/**
 * robots.txt groups for `*` and BurnGuard. The longest matching Allow/Disallow prefix wins, ties go to
 * Allow, and `*`/`$` wildcards are honoured. A missing or unreadable file allows everything.
 */
export function parseRobots(text: string): RobotsRules {
  const rules: { allow: boolean; pattern: string }[] = [];
  const sitemaps: string[] = [];
  let agents: string[] = [];
  let inRules = false;
  for (const raw of text.split(/\r?\n/).slice(0, 2000)) {
    const line = raw.replace(/#.*$/, "").trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (field === "sitemap") { if (value) sitemaps.push(value); continue; }
    if (field === "user-agent") { if (inRules) { agents = []; inRules = false; } agents.push(value.toLowerCase()); continue; }
    if (field !== "allow" && field !== "disallow") continue;
    inRules = true;
    if (!agents.some(agent => agent === "*" || agent.includes("burnguard"))) continue;
    if (field === "disallow" && value === "") continue;
    rules.push({ allow: field === "allow", pattern: value });
  }
  const matches = (pattern: string, path: string): boolean => {
    const anchored = pattern.endsWith("$");
    const source = (anchored ? pattern.slice(0, -1) : pattern).split("*").map(part => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
  };
  return {
    sitemaps,
    allows: (path) => {
      const best = rules.filter(rule => matches(rule.pattern, path)).sort((a, b) => b.pattern.length - a.pattern.length || Number(b.allow) - Number(a.allow))[0];
      return best === undefined || best.allow;
    },
  };
}

export function parseSitemap(xml: string, limit = 500): { readonly urls: readonly string[]; readonly isIndex: boolean } {
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].slice(0, limit).map(match => match[1]!.replace(/&amp;/g, "&"));
  return { urls, isIndex: /<sitemapindex[\s>]/i.test(xml) };
}

const NON_PAGE = /\.(?:pdf|png|jpe?g|gif|webp|avif|svg|ico|zip|gz|mp4|webm|mp3|css|js|json|xml|txt)$/i;

/** Same-origin canonical path (no hash or query, no trailing slash except root), or null when not a page. */
export function canonicalPagePath(href: string, base: URL): string | null {
  let url: URL;
  try { url = new URL(href, base); } catch { return null; }
  if (url.origin !== base.origin || NON_PAGE.test(url.pathname)) return null;
  const path = url.pathname.replace(/\/{2,}/g, "/").replace(/\/index\.html?$/i, "/");
  return path.length > 1 ? path.replace(/\/+$/, "") : "/";
}

export type PageCandidate = { readonly path: string; readonly source: DesignSystemPageRecord["source"] };

/**
 * Ordered, deduplicated page candidates: the entry page, then navigation, footer, sitemap and other
 * links. robots.txt-disallowed paths and those beyond the limit are returned as skipped, not dropped.
 */
export function discoverPages(input: {
  readonly base: URL;
  readonly homepageHtml: string;
  readonly sitemapUrls: readonly string[];
  readonly robots: RobotsRules;
  readonly limit: number;
}): { readonly selected: readonly PageCandidate[]; readonly skipped: readonly (PageCandidate & { readonly reason: "robots" | "cap" })[]; readonly discovered: number } {
  const root = parse(input.homepageHtml, { comment: false });
  const anchors = (elements: readonly HTMLElement[]) => elements.flatMap(element => element.querySelectorAll("a[href]")).map(anchor => anchor.getAttribute("href") ?? "");
  const ordered: PageCandidate[] = [];
  const seen = new Set<string>();
  const push = (href: string, source: PageCandidate["source"]) => {
    const path = canonicalPagePath(href, input.base);
    if (path === null || seen.has(path)) return;
    seen.add(path);
    ordered.push({ path, source });
  };
  push(input.base.pathname || "/", "entry");
  for (const href of anchors(root.querySelectorAll("header nav, nav, header"))) push(href, "nav");
  for (const href of anchors(root.querySelectorAll("footer"))) push(href, "footer");
  for (const href of input.sitemapUrls) push(href, "sitemap");
  for (const href of anchors([root])) push(href, "link");
  const skipped: (PageCandidate & { reason: "robots" | "cap" })[] = [];
  const allowed = ordered.filter(candidate => {
    if (candidate.source === "entry" || input.robots.allows(candidate.path)) return true;
    skipped.push({ ...candidate, reason: "robots" });
    return false;
  });
  // Spend the limit on variety first: one page per new page type, then one per new top-level section,
  // then the rest in priority order, so a long run of sibling links cannot crowd out other page kinds.
  const chosen = new Set<string>();
  const types = new Set<DesignSystemPageType>();
  const sections = new Set<string>();
  const section = (path: string) => path.split("/")[1] ?? "";
  const take = (candidate: PageCandidate) => { chosen.add(candidate.path); types.add(classifyPageType(candidate.path, "")); sections.add(section(candidate.path)); };
  const passes: ((candidate: PageCandidate) => boolean)[] = [
    candidate => candidate.source === "entry",
    candidate => !types.has(classifyPageType(candidate.path, "")),
    candidate => !sections.has(section(candidate.path)),
    () => true,
  ];
  for (const pass of passes) for (const candidate of allowed) if (chosen.size < input.limit && !chosen.has(candidate.path) && pass(candidate)) take(candidate);
  const selected = allowed.filter(candidate => chosen.has(candidate.path));
  for (const candidate of allowed) if (!chosen.has(candidate.path)) skipped.push({ ...candidate, reason: "cap" });
  return { selected, skipped, discovered: ordered.length };
}

const PAGE_TYPE_PATTERNS: readonly [DesignSystemPageType, RegExp][] = [
  ["pricing", /\b(?:pricing|prices|plans?|billing)\b/],
  ["docs", /\b(?:docs?|documentation|guides?|help|api|reference|manual|learn)\b/],
  ["blog", /\b(?:blog|news|posts?|articles?|stories|changelog|updates?)\b/],
  ["product", /\b(?:products?|features?|platform|solutions?|integrations?|use-cases?)\b/],
  ["about", /\b(?:about|company|team|careers|jobs|mission)\b/],
  ["contact", /\b(?:contact|support|sales|demo)\b/],
];

/** Page type from the path first, then the title/h1 text; the root path is always home. */
export function classifyPageType(path: string, html: string): DesignSystemPageType {
  if (path === "/") return "home";
  const segments = path.toLowerCase().replace(/[/_.]+/g, " ");
  for (const [type, pattern] of PAGE_TYPE_PATTERNS) if (pattern.test(segments)) return type;
  const root = parse(html, { comment: false });
  const heading = `${root.querySelector("title")?.text ?? ""} ${root.querySelector("h1")?.text ?? ""}`.toLowerCase();
  for (const [type, pattern] of PAGE_TYPE_PATTERNS) if (pattern.test(heading)) return type;
  return "other";
}

export function observedPatterns(evidence: SourceEvidence): string[] {
  return [
    ...(evidence.hero ? ["hero"] : []),
    ...(evidence.featureColumns ? ["feature-grid"] : []),
    ...(evidence.proofStrip ? ["proof-strip"] : []),
    ...(evidence.pricing ? ["pricing"] : []),
    ...(evidence.testimonials ? ["testimonials"] : []),
    ...(evidence.footerColumns ? ["footer"] : []),
  ];
}

export type ExtractedPage = {
  readonly path: string;
  readonly source: PageCandidate["source"];
  readonly pageType: DesignSystemPageType;
  readonly layoutTokens: Readonly<Record<string, string>>;
  readonly patterns: readonly string[];
  readonly colors: readonly string[];
  readonly fonts: readonly string[];
};

/**
 * Coverage document: every discovered page with its status, the first extracted page of each type as
 * that type's template, and every layout token or font that differs between extracted pages.
 */
export function buildPageCoverage(input: {
  readonly limit: number;
  readonly discovered: number;
  readonly extracted: readonly ExtractedPage[];
  readonly skipped: readonly (PageCandidate & { readonly reason: "robots" | "cap" | "fetch_failed"; readonly pageType: DesignSystemPageType })[];
}): DesignSystemPageCoverage {
  const pages: DesignSystemPageRecord[] = [
    ...input.extracted.map((page): DesignSystemPageRecord => ({ path: page.path, page_type: page.pageType, source: page.source, status: "extracted", skip_reason: null, layout_tokens: { ...page.layoutTokens }, patterns: [...page.patterns], colors: [...page.colors].slice(0, 12), fonts: [...page.fonts].slice(0, 6) })),
    ...input.skipped.map((page): DesignSystemPageRecord => ({ path: page.path, page_type: page.pageType, source: page.source, status: "skipped", skip_reason: page.reason, layout_tokens: {}, patterns: [], colors: [], fonts: [] })),
  ].slice(0, 200);
  const templates: DesignSystemPageTemplate[] = PAGE_TYPES.flatMap(type => {
    const page = input.extracted.find(candidate => candidate.pageType === type);
    return page ? [{ page_type: type, path: page.path, patterns: [...page.patterns], layout_tokens: { ...page.layoutTokens } }] : [];
  });
  const differences: DesignSystemPageDifference[] = [];
  const keys = [...new Set(input.extracted.flatMap(page => Object.keys(page.layoutTokens)))].sort();
  for (const key of keys) {
    const values = input.extracted.filter(page => page.layoutTokens[key] !== undefined).map(page => ({ path: page.path, value: page.layoutTokens[key]! }));
    if (values.length >= 2 && new Set(values.map(value => value.value)).size > 1) differences.push({ key, values });
  }
  const fontValues = input.extracted.filter(page => page.fonts.length > 0).map(page => ({ path: page.path, value: page.fonts[0]! }));
  if (fontValues.length >= 2 && new Set(fontValues.map(value => value.value)).size > 1) differences.push({ key: "primary-font", values: fontValues });
  return { schema_version: 1, page_limit: input.limit, discovered: input.discovered, pages, templates, differences: differences.slice(0, 64) };
}


/** README `## Page templates` section summarising per-type templates and cross-page differences. */
export function buildPageTemplateReadme(coverage: DesignSystemPageCoverage): string {
  const extracted = coverage.pages.filter(page => page.status === "extracted").length;
  const lines = [
    "",
    "## Page templates",
    `${extracted} of ${coverage.discovered} discovered same-origin pages were extracted (limit ${coverage.page_limit}); per-page records are in pages.json.`,
    "",
    ...coverage.templates.map(template => `- ${template.page_type} (${template.path}): patterns ${template.patterns.join(", ") || "none observed"}; layout ${Object.entries(template.layout_tokens).map(([key, value]) => `${key} ${value}`).join(", ") || "site-wide defaults"}.`),
    ...(coverage.differences.length ? ["", "Pages differ on:", ...coverage.differences.map(difference => `- ${difference.key}: ${difference.values.map(value => `${value.path} ${value.value}`).join("; ")}`)] : []),
    "",
  ];
  return lines.join("\n");
}
