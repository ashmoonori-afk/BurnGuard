import type { DesignAuditCheckCode, DesignAuditSeverity } from "@bg/shared/design-audit";
import type { SiteMap } from "./site-map";

export type SiteHtml = { readonly rel_path: string; readonly html: string };
export type SiteStructureFinding = {
  readonly code: Extract<DesignAuditCheckCode, `site_${string}`>;
  readonly rel_path: string;
  readonly severity: DesignAuditSeverity;
  readonly evidence: string;
};
export type SiteStructureAudit = {
  readonly findings: readonly SiteStructureFinding[];
  readonly divergent_pages: readonly string[];
};

type SharedParts = {
  readonly header: string;
  readonly nav: string;
  readonly footer: string;
  readonly sharedCss: string;
  readonly marked: boolean;
};

export function auditSiteStructure(siteMap: SiteMap, pages: readonly SiteHtml[]): SiteStructureAudit {
  const htmlByPath = new Map(pages.map((page) => [page.rel_path, page.html]));
  const homePath = siteMap.pages.find((page) => page.is_home)?.rel_path;
  const homeHtml = homePath === undefined ? "" : htmlByPath.get(homePath) ?? "";
  const homeParts = extractSharedParts(homeHtml);
  const findings: SiteStructureFinding[] = [];
  const divergentPages: string[] = [];

  for (const page of siteMap.pages) {
    const html = htmlByPath.get(page.rel_path) ?? "";
    const parts = extractSharedParts(html);
    if (!parts.marked) findings.push(finding("site_missing_shared_block", page.rel_path, "Shared header, nav, footer, content, or CSS markers are missing; legacy landmarks were used."));
    if (!/\baria-current\s*=\s*["']page["']/iu.test(parts.nav)) findings.push(finding("site_missing_aria_current", page.rel_path, "Navigation does not mark the current page with aria-current=page."));
    if (page.rel_path !== homePath && normalizeShared(parts.nav) !== normalizeShared(homeParts.nav)) findings.push(finding("site_nav_mismatch", page.rel_path, "Shared navigation differs from the entrypoint after active-link normalization."));
    if (page.rel_path !== homePath && sharedSignature(parts) !== sharedSignature(homeParts)) divergentPages.push(page.rel_path);
    if (hasRootAbsoluteAsset(html)) findings.push(finding("site_root_absolute_asset", page.rel_path, "Page contains a root-absolute asset reference."));
  }
  for (const dangling of siteMap.dangling) findings.push(finding("site_dangling_link", dangling.from, `Navigation target is missing: ${dangling.href}`));
  return { findings, divergent_pages: divergentPages };
}

export function findSharedBlockDivergence(pages: readonly SiteHtml[], entrypoint: string): readonly string[] {
  const home = pages.find((page) => page.rel_path === entrypoint);
  if (home === undefined) return [];
  const signature = sharedSignature(extractSharedParts(home.html));
  return pages.filter((page) => page.rel_path !== entrypoint && sharedSignature(extractSharedParts(page.html)) !== signature).map((page) => page.rel_path);
}

function finding(code: SiteStructureFinding["code"], relPath: string, evidence: string): SiteStructureFinding {
  return { code, rel_path: relPath, severity: "recommended", evidence };
}

function extractSharedParts(html: string): SharedParts {
  const markedHeader = block(html, "header", /<header\b[^>]*\bdata-bg-shared\s*=\s*["']header["'][^>]*>[\s\S]*?<\/header>/iu);
  const markedNav = block(html, "nav", /<nav\b[^>]*\bdata-bg-shared\s*=\s*["']nav["'][^>]*>[\s\S]*?<\/nav>/iu);
  const markedFooter = block(html, "footer", /<footer\b[^>]*\bdata-bg-shared\s*=\s*["']footer["'][^>]*>[\s\S]*?<\/footer>/iu);
  const contentMarked = /<main\b[^>]*\bdata-bg-content(?:\s|=|>)/iu.test(html);
  const sharedCss = html.match(/\/\*\s*@bg-shared-css\s*\*\/([\s\S]*?)\/\*\s*@bg-page-css\s*\*\//iu)?.[1] ?? "";
  return {
    header: markedHeader ?? block(html, "header", /<header\b[^>]*>[\s\S]*?<\/header>/iu) ?? "",
    nav: markedNav ?? block(html, "nav", /<nav\b[^>]*>[\s\S]*?<\/nav>/iu) ?? "",
    footer: markedFooter ?? block(html, "footer", /<footer\b[^>]*>[\s\S]*?<\/footer>/iu) ?? "",
    sharedCss,
    marked: markedHeader !== null && markedNav !== null && markedFooter !== null && contentMarked && sharedCss !== "",
  };
}

function block(html: string, _name: string, pattern: RegExp): string | null {
  return html.match(pattern)?.[0] ?? null;
}

function sharedSignature(parts: SharedParts): string {
  return [parts.header, parts.nav, parts.footer, parts.sharedCss].map(normalizeShared).join("\n---\n");
}

function normalizeShared(value: string): string {
  return value
    .replace(/\s+aria-current\s*=\s*(["'])page\1/giu, "")
    .replace(/\s+/gu, " ")
    .replace(/>\s+</gu, "><")
    .trim();
}

function hasRootAbsoluteAsset(html: string): boolean {
  return /\b(?:src|poster)\s*=\s*["']\/(?!\/)/iu.test(html)
    || /\bsrcset\s*=\s*["'][^"']*(?:^|\s)\/(?!\/)/imu.test(html)
    || /url\(\s*["']?\/(?!\/)/iu.test(html);
}
