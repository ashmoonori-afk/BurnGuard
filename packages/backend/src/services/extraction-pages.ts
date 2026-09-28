import { parse, type HTMLElement } from "node-html-parser";
import {
  MAX_PAGE_COVERAGE_BYTES,
  MAX_PAGE_PATH_LENGTH,
  PAGE_TYPES,
  type DesignSystemPageCoverage,
  type DesignSystemPageDifference,
  type DesignSystemPageEvidence,
  type DesignSystemPageRecord,
  type DesignSystemPageTemplate,
  type DesignSystemPageType,
} from "@bg/shared";
import type { SourceEvidence } from "./extraction-evidence";

export type RobotsRules = { readonly allows: (path: string) => boolean; readonly sitemaps: readonly string[] };

const MAX_ROBOTS_RULES = 500;
const MAX_ROBOTS_PATTERN = 512;

/**
 * Linear wildcard match of a robots.txt path pattern (`*` any run, trailing `$` end anchor) as a prefix
 * match. Greedy two-pointer matching with a single backtrack point, so hostile patterns cannot blow up.
 */
export function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  let p = 0, s = 0, star = -1, mark = 0;
  while (s < path.length) {
    if (p < body.length && body[p] !== "*" && body[p] === path[s]) { p += 1; s += 1; continue; }
    if (p < body.length && body[p] === "*") { star = p; mark = s; p += 1; continue; }
    if (p === body.length && !anchored) return true;
    if (star === -1) return false;
    p = star + 1; mark += 1; s = mark;
  }
  while (p < body.length && body[p] === "*") p += 1;
  return p === body.length;
}

/**
 * robots.txt per RFC 9309 for the BurnGuard crawler: groups naming BurnGuard apply when present, otherwise
 * the `*` groups; the longest matching Allow/Disallow wins and ties go to Allow. A missing or unreadable
 * file allows everything.
 */
export function parseRobots(text: string): RobotsRules {
  type Group = { agents: string[]; rules: { allow: boolean; pattern: string }[] };
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let collectingAgents = false;
  for (const raw of text.split(/\r?\n/).slice(0, 5000)) {
    const line = raw.replace(/#.*$/, "").trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (field === "sitemap") { if (value && sitemaps.length < 20) sitemaps.push(value); continue; }
    if (field === "user-agent") {
      if (!collectingAgents || current === null) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
      continue;
    }
    if (field !== "allow" && field !== "disallow") continue;
    collectingAgents = false;
    if (current === null || current.rules.length >= MAX_ROBOTS_RULES || value.length > MAX_ROBOTS_PATTERN) continue;
    if (field === "disallow" && value === "") continue;
    current.rules.push({ allow: field === "allow", pattern: value });
  }
  const specific = groups.filter(group => group.agents.some(agent => agent.includes("burnguard")));
  const rules = (specific.length ? specific : groups.filter(group => group.agents.includes("*"))).flatMap(group => group.rules);
  return {
    sitemaps,
    allows: (path) => {
      let best: { allow: boolean; pattern: string } | undefined;
      for (const rule of rules) {
        if (!robotsPatternMatches(rule.pattern, path)) continue;
        if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
      }
      return best === undefined || best.allow;
    },
  };
}

export function parseSitemap(xml: string, limit = 500): { readonly urls: readonly string[]; readonly isIndex: boolean } {
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].slice(0, limit).map(match => match[1]!.replace(/&amp;/g, "&"));
  return { urls, isIndex: /<sitemapindex[\s>]/i.test(xml) };
}

const NON_PAGE = /\.(?:pdf|png|jpe?g|gif|webp|avif|svg|ico|zip|gz|mp4|webm|mp3|css|js|json|xml|txt)$/i;

/**
 * A same-origin page link as its deduplication key (no hash or query, no trailing slash except root,
 * index.html folded) and the path that is actually fetched and checked against robots.txt. Null when
 * the link is not a page or its key exceeds the persisted path limit.
 */
export function pageLink(href: string, base: URL): { readonly key: string; readonly fetchPath: string } | null {
  let url: URL;
  try { url = new URL(href, base); } catch { return null; }
  if (url.origin !== base.origin || NON_PAGE.test(url.pathname)) return null;
  const fetchPath = url.pathname.replace(/\/{2,}/g, "/");
  const folded = fetchPath.replace(/\/index\.html?$/i, "/");
  const key = folded.length > 1 ? folded.replace(/\/+$/, "") : "/";
  return key.length <= MAX_PAGE_PATH_LENGTH ? { key, fetchPath } : null;
}

export function canonicalPagePath(href: string, base: URL): string | null {
  return pageLink(href, base)?.key ?? null;
}

export type PageCandidate = { readonly path: string; readonly fetchPath: string; readonly source: DesignSystemPageRecord["source"] };

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
    const link = pageLink(href, input.base);
    if (link === null || seen.has(link.key)) return;
    seen.add(link.key);
    ordered.push({ path: link.key, fetchPath: link.fetchPath, source });
  };
  push(input.base.pathname || "/", "entry");
  for (const href of anchors(root.querySelectorAll("header nav, nav, header"))) push(href, "nav");
  for (const href of anchors(root.querySelectorAll("footer"))) push(href, "footer");
  for (const href of input.sitemapUrls) push(href, "sitemap");
  for (const href of anchors([root])) push(href, "link");
  const skipped: (PageCandidate & { reason: "robots" | "cap" })[] = [];
  const allowed = ordered.filter(candidate => {
    if (candidate.source === "entry" || input.robots.allows(candidate.fetchPath)) return true;
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

export function pageEvidence(evidence: SourceEvidence): DesignSystemPageEvidence {
  return {
    hero_media: evidence.hero?.media ?? null,
    feature_columns: evidence.featureColumns,
    footer_lists: evidence.footerColumns,
    alignment: evidence.alignment,
    icons: evidence.iconCount,
    photos: evidence.photos,
    illustrations: evidence.illustrations,
    gradients: evidence.gradients,
    background_patterns: evidence.patterns,
    motion_ms: evidence.motionMs ? [evidence.motionMs[0], evidence.motionMs[1]] : null,
    animations: evidence.animations,
  };
}

export type ExtractedPage = {
  readonly path: string;
  readonly source: PageCandidate["source"];
  readonly pageType: DesignSystemPageType;
  readonly layoutTokens: Readonly<Record<string, string>>;
  readonly patterns: readonly string[];
  readonly colors: readonly string[];
  readonly fonts: readonly string[];
  readonly customProperties: Readonly<Record<string, string>>;
  readonly evidence: DesignSystemPageEvidence;
};

const differing = (key: string, values: readonly { path: string; value: string | undefined }[]): DesignSystemPageDifference | null => {
  const present = values.filter((value): value is { path: string; value: string } => value.value !== undefined);
  return present.length >= 2 && new Set(present.map(value => value.value)).size > 1 ? { key, values: present } : null;
};

/**
 * Coverage document: every discovered page once (an extracted record wins over a skipped one for the
 * same path), the first extracted page of each type as that type's template, and every layout token,
 * custom property, primary font or evidence value that differs between extracted pages.
 */
export function buildPageCoverage(input: {
  readonly limit: number;
  readonly discovered: number;
  readonly extracted: readonly ExtractedPage[];
  readonly skipped: readonly (Pick<PageCandidate, "path" | "source"> & { readonly reason: "robots" | "cap" | "fetch_failed" | "budget"; readonly pageType: DesignSystemPageType })[];
}): DesignSystemPageCoverage {
  const extracted: ExtractedPage[] = [];
  for (const page of input.extracted) if (!extracted.some(existing => existing.path === page.path)) extracted.push(page);
  const taken = new Set(extracted.map(page => page.path));
  const pages: DesignSystemPageRecord[] = [
    ...extracted.map((page): DesignSystemPageRecord => ({ path: page.path, page_type: page.pageType, source: page.source, status: "extracted", skip_reason: null, layout_tokens: { ...page.layoutTokens }, patterns: [...page.patterns], colors: [...page.colors].slice(0, 12), fonts: [...page.fonts].slice(0, 6), custom_properties: { ...page.customProperties }, evidence: page.evidence })),
    ...input.skipped.filter(page => !taken.has(page.path) && (taken.add(page.path), true)).map((page): DesignSystemPageRecord => ({ path: page.path, page_type: page.pageType, source: page.source, status: "skipped", skip_reason: page.reason, layout_tokens: {}, patterns: [], colors: [], fonts: [], custom_properties: {}, evidence: null })),
  ].slice(0, 200);
  const templates: DesignSystemPageTemplate[] = PAGE_TYPES.flatMap(type => {
    const page = extracted.find(candidate => candidate.pageType === type);
    return page ? [{ page_type: type, path: page.path, patterns: [...page.patterns], layout_tokens: { ...page.layoutTokens }, custom_properties: { ...page.customProperties }, colors: [...page.colors].slice(0, 12), evidence: page.evidence }] : [];
  });
  const differences: DesignSystemPageDifference[] = [];
  for (const key of [...new Set(extracted.flatMap(page => Object.keys(page.layoutTokens)))].sort()) {
    const difference = differing(key, extracted.map(page => ({ path: page.path, value: page.layoutTokens[key] })));
    if (difference) differences.push(difference);
  }
  const palette = differing("palette", extracted.map(page => ({ path: page.path, value: page.colors.length ? page.colors.slice(0, 6).join(" ").slice(0, 160) : undefined })));
  if (palette) differences.push(palette);
  const primaryFont = differing("primary-font", extracted.map(page => ({ path: page.path, value: page.fonts[0] })));
  if (primaryFont) differences.push(primaryFont);
  const alignment = differing("alignment", extracted.map(page => ({ path: page.path, value: page.evidence.alignment ?? undefined })));
  if (alignment) differences.push(alignment);
  // Custom properties come last: page-level palette, font and alignment differences outrank them when compacted.
  for (const key of [...new Set(extracted.flatMap(page => Object.keys(page.customProperties)))].sort()) {
    const difference = differing(key, extracted.map(page => ({ path: page.path, value: page.customProperties[key] })));
    if (difference) differences.push(difference);
  }
  return boundPageCoverage({ schema_version: 1, page_limit: input.limit, discovered: input.discovered, pages, templates, differences: differences.slice(0, 64) });
}

const serializedBytes = (coverage: DesignSystemPageCoverage) => Buffer.byteLength(JSON.stringify(coverage, null, 2));

/**
 * Deterministic compaction until pages.json fits MAX_PAGE_COVERAGE_BYTES: fewer skipped records, then
 * fewer custom properties and colours per page, then shorter difference lists, then no skipped records.
 */
export function boundPageCoverage(coverage: DesignSystemPageCoverage): DesignSystemPageCoverage {
  const trimRecord = <T extends { custom_properties: Readonly<Record<string, string>>; colors: readonly string[] }>(record: T, properties: number, colors: number): T =>
    ({ ...record, custom_properties: Object.fromEntries(Object.entries(record.custom_properties).slice(0, properties)), colors: record.colors.slice(0, colors) });
  const steps: ((current: DesignSystemPageCoverage) => DesignSystemPageCoverage)[] = [
    current => ({ ...current, pages: [...current.pages.filter(page => page.status === "extracted"), ...current.pages.filter(page => page.status === "skipped").slice(0, 60)] }),
    current => ({ ...current, pages: current.pages.map(page => trimRecord(page, 16, 6)), templates: current.templates.map(template => trimRecord(template, 16, 6)) }),
    current => ({ ...current, differences: current.differences.slice(0, 24).map(difference => ({ ...difference, values: difference.values.slice(0, 12) })) }),
    current => ({ ...current, pages: current.pages.filter(page => page.status === "extracted").map(page => trimRecord(page, 4, 3)), templates: current.templates.map(template => trimRecord(template, 8, 4)) }),
    current => ({ ...current, differences: current.differences.slice(0, 8).map(difference => ({ ...difference, values: difference.values.slice(0, 6) })) }),
  ];
  let current = coverage;
  for (const step of steps) {
    if (serializedBytes(current) <= MAX_PAGE_COVERAGE_BYTES) return current;
    current = step(current);
  }
  return current;
}

/** Bounded prompt view of the templates and differences; always well below the pinned-context limit. */
export function pageCoveragePromptSummary(coverage: DesignSystemPageCoverage, maxChars = 24_000): { readonly templates: DesignSystemPageCoverage["templates"]; readonly differences: DesignSystemPageCoverage["differences"] } {
  let templates = coverage.templates.map(template => ({ ...template, custom_properties: Object.fromEntries(Object.entries(template.custom_properties).slice(0, 24)), colors: template.colors.slice(0, 6) }));
  let differences = coverage.differences.slice(0, 24).map(difference => ({ ...difference, values: difference.values.slice(0, 12) }));
  const size = () => JSON.stringify({ templates, differences }).length;
  while (size() > maxChars && differences.length > 0) differences = differences.slice(0, -1);
  while (size() > maxChars && templates.some(template => Object.keys(template.custom_properties).length > 0)) templates = templates.map(template => ({ ...template, custom_properties: Object.fromEntries(Object.entries(template.custom_properties).slice(0, Math.floor(Object.keys(template.custom_properties).length / 2))) }));
  return { templates, differences };
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
