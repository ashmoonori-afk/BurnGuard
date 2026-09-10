import path from "node:path";
import type { SitePage } from "@bg/shared/artifact";
import { DESIGN_BRIEF_PAGE_LIMIT } from "@bg/shared/design-brief";
import type { FileInfo } from "@bg/shared/harness";

export const SITE_MAP_PAGE_LIMIT = 24;
export const SITE_BRIEF_PAGE_LIMIT = DESIGN_BRIEF_PAGE_LIMIT;

export type SiteNavLink = {
  readonly from: string;
  readonly href: string;
  readonly target_rel_path: string | null;
};

export type SiteMap = {
  readonly pages: readonly SitePage[];
  readonly nav_links: readonly SiteNavLink[];
  readonly dangling: readonly { readonly from: string; readonly href: string }[];
  readonly overflow: boolean;
  readonly omitted_count: number;
};

type HtmlReader = (relPath: string) => string | Promise<string>;

export async function buildSiteMap(
  files: readonly FileInfo[],
  entrypoint: string,
  readHtml: HtmlReader,
): Promise<SiteMap> {
  const htmlPaths = files
    .filter((file) => file.category === "html")
    .map((file) => file.rel_path.replaceAll("\\", "/"));
  const indexed = new Set(htmlPaths);
  const home = indexed.has(entrypoint) ? entrypoint : [...htmlPaths].sort(comparePaths)[0];
  if (home === undefined) return { pages: [], nav_links: [], dangling: [], overflow: false, omitted_count: 0 };

  const htmlByPath = new Map<string, string>();
  htmlByPath.set(home, await readHtml(home));
  const homeLinks = extractNavHrefs(htmlByPath.get(home) ?? "").map((href): SiteNavLink => ({
    from: home,
    href,
    target_rel_path: resolveLocalHtmlTarget(home, href, indexed),
  }));
  const homeTargets = homeLinks.flatMap((link) => link.target_rel_path === null || link.target_rel_path === home ? [] : [link.target_rel_path]);
  const ordered = unique([home, ...homeTargets, ...[...htmlPaths].sort(comparePaths)]);
  const visible = ordered.slice(0, SITE_MAP_PAGE_LIMIT);
  await Promise.all(visible.filter((relPath) => relPath !== home).map(async (relPath) => htmlByPath.set(relPath, await readHtml(relPath))));
  const links = visible.flatMap((relPath) => extractNavHrefs(htmlByPath.get(relPath) ?? "").map((href): SiteNavLink => ({
    from: relPath,
    href,
    target_rel_path: resolveLocalHtmlTarget(relPath, href, indexed),
  })));
  const pages = visible.map((relPath, navOrder): SitePage => ({
    rel_path: relPath,
    title: extractTitle(htmlByPath.get(relPath) ?? "", relPath),
    is_home: relPath === home,
    nav_order: navOrder,
  }));
  const dangling = links
    .filter((link) => isLocalPageHref(link.href) && link.target_rel_path === null)
    .map(({ from, href }) => ({ from, href }));
  return {
    pages,
    nav_links: links,
    dangling,
    overflow: ordered.length > SITE_MAP_PAGE_LIMIT,
    omitted_count: Math.max(0, ordered.length - SITE_MAP_PAGE_LIMIT),
  };
}

function extractNavHrefs(html: string): readonly string[] {
  const shared = html.match(/<nav\b[^>]*\bdata-bg-shared\s*=\s*["']nav["'][^>]*>[\s\S]*?<\/nav>/iu)?.[0];
  const nav = shared ?? html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/iu)?.[0] ?? "";
  return [...nav.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>/giu)].map((match) => decodeEntities(match[2] ?? "").trim()).filter(Boolean);
}

function resolveLocalHtmlTarget(owner: string, href: string, indexed: ReadonlySet<string>): string | null {
  if (!isLocalPageHref(href)) return null;
  const pathPart = href.split(/[?#]/u, 1)[0] ?? "";
  if (pathPart === "") return owner;
  let decoded: string;
  try { decoded = decodeURIComponent(pathPart); } catch { return null; }
  if (decoded.startsWith("/") || decoded.includes("\\") || [...decoded].some((character) => character.charCodeAt(0) < 32)) return null;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(owner), decoded));
  if (resolved === ".." || resolved.startsWith("../")) return null;
  if (indexed.has(resolved)) return resolved;
  const directoryIndex = `${resolved.replace(/\/$/u, "")}/index.html`;
  return indexed.has(directoryIndex) ? directoryIndex : null;
}

function isLocalPageHref(href: string): boolean {
  const value = href.trim();
  return value !== "" && !value.startsWith("#") && !value.startsWith("/") && !value.startsWith("//") && !/^[a-z][a-z\d+.-]*:/iu.test(value);
}

function extractTitle(html: string, relPath: string): string {
  const source = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1]
    ?? html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu)?.[1];
  const title = source?.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
  return title ? decodeEntities(title) : path.posix.basename(relPath, path.posix.extname(relPath));
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt);/gu, (entity) => ({
    "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">",
  })[entity] ?? entity);
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
