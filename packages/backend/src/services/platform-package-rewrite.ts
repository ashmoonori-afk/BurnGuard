import path from "node:path";
import { parse, type HTMLElement } from "node-html-parser";
import postcss from "postcss";
import { ExportError } from "./export-errors";
import { slugifyProjectName } from "./export-naming";

export type AssetBucket = "css" | "js" | "img" | "fonts";
export type AssetDestination = { readonly source: string; readonly bucket: AssetBucket; readonly package_path: string; readonly url: string };
/** Resolves a staged closure path to its published URL, or null when the reference must stay as authored. */
export type ReferenceResolver = (relPath: string) => string | null;

const HTML_URL_ATTRIBUTES = ["src", "poster", "xlink:href"] as const;
const MAX_URL_LENGTH = 4096;
const MAX_IMPORT_DEPTH = 4;

export function packageSlug(name: string): string {
  return slugifyProjectName(name).toLocaleLowerCase("en-US");
}

export function defaultAssetBaseUrl(slug: string): string {
  return `/web/upload/burnguard/${slug}/`;
}

export function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

/** Rejects credentials, protocol-relative, traversal, encoded separators, control characters and unsafe schemes (T13). */
export function safeAssetUrl(base: string, suffix: string): string {
  const url = `${base}${suffix}`;
  if (url.length === 0 || url.length > MAX_URL_LENGTH || url.startsWith("//") || url.includes("\\") || /["'<>\s]/u.test(url) || /%2f|%5c/iu.test(url) || [...url].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) throw new ExportError("invalid_asset_destination");
  const pathname = url.startsWith("/") ? url : url.replace(/^https:\/\/[^/]+/iu, "");
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { throw new ExportError("invalid_asset_destination"); }
  if (decoded.split("/").includes("..")) throw new ExportError("invalid_asset_destination");
  if (url.startsWith("/")) return url;
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new ExportError("invalid_asset_destination"); }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") throw new ExportError("invalid_asset_destination");
  return url;
}

export function planAssetDestinations(sources: readonly string[], baseUrl: string, slug: string): ReadonlyMap<string, AssetDestination> {
  const destinations = new Map<string, AssetDestination>();
  const taken = new Set<string>();
  for (const source of [...sources].sort()) {
    const bucket = bucketFor(source);
    const base = path.posix.basename(source).normalize("NFC");
    let name = base; let counter = 2;
    while (taken.has(`${bucket}/${name.toLocaleLowerCase("en-US")}`)) { name = `${counter}-${base}`; counter += 1; }
    taken.add(`${bucket}/${name.toLocaleLowerCase("en-US")}`);
    destinations.set(source, { source, bucket, package_path: `web/${slug}/${bucket}/${name}`, url: safeAssetUrl(baseUrl, `${bucket}/${encodeURI(name)}`) });
  }
  return destinations;
}

export function bucketFor(source: string): AssetBucket {
  const extension = path.posix.extname(source).slice(1).toLowerCase();
  if (extension === "css") return "css";
  if (extension === "js" || extension === "mjs" || extension === "cjs") return "js";
  if (["woff", "woff2", "ttf", "otf", "eot"].includes(extension)) return "fonts";
  return "img";
}

export function isImagePath(source: string): boolean {
  return ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"].includes(path.posix.extname(source).slice(1).toLowerCase());
}

/** Resolves an authored reference against its owning document; null for fragments, data URIs and anything not local. */
export function resolveLocalReference(raw: string, owner: string): string | null {
  const value = raw.trim();
  if (value === "" || value.startsWith("#") || value.startsWith("data:") || value.startsWith("//") || /^[a-z][a-z\d+.-]*:/iu.test(value)) return null;
  const pathPart = value.split(/[?#]/u)[0] ?? "";
  let decoded: string;
  try { decoded = decodeURIComponent(pathPart); } catch { return null; }
  if (decoded === "" || decoded.includes("\\") || [...decoded].some((character) => character.charCodeAt(0) <= 31)) return null;
  const joined = decoded.startsWith("/") ? decoded.slice(1) : path.posix.join(path.posix.dirname(owner), decoded);
  const normalized = path.posix.normalize(joined);
  return normalized.startsWith("../") || normalized === ".." ? null : normalized;
}

export function rewriteHtmlReferences(root: HTMLElement, owner: string, resolve: ReferenceResolver): void {
  for (const element of root.querySelectorAll("link,script,img,source,video,audio,input,object,embed,use,image")) {
    for (const attribute of HTML_URL_ATTRIBUTES) rewriteAttribute(element, attribute, owner, resolve);
    if (element.tagName !== "A") rewriteAttribute(element, "href", owner, resolve);
    const srcset = element.getAttribute("srcset");
    if (srcset !== undefined) element.setAttribute("srcset", srcset.split(",").map((candidate) => rewriteCandidate(candidate, owner, resolve)).join(", "));
  }
  for (const element of root.querySelectorAll("[style]")) {
    const style = element.getAttribute("style");
    if (style !== undefined) element.setAttribute("style", rewriteCssText(style, owner, resolve));
  }
  for (const style of root.querySelectorAll("style")) style.set_content(rewriteCssText(style.text, owner, resolve));
}

export function rewriteCssText(css: string, owner: string, resolve: ReferenceResolver): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/giu, (match, _quote: string, reference: string) => {
    const local = resolveLocalReference(reference, owner);
    const replacement = local === null ? null : resolve(local);
    return replacement === null ? match : `url("${replacement}")`;
  });
}

/** Rewrites `url()` and `@import` targets inside a stylesheet, preserving everything else. */
export function rewriteStylesheet(css: string, owner: string, resolve: ReferenceResolver): string {
  const root = parseCss(css);
  root.walkAtRules("import", (rule) => {
    const match = /^(?:url\()?\s*["']?([^"')\s]+)["']?/u.exec(rule.params);
    const reference = match?.[1];
    if (reference === undefined) return;
    const local = resolveLocalReference(reference, owner);
    const replacement = local === null ? null : resolve(local);
    if (replacement !== null) rule.params = `url("${replacement}")`;
  });
  root.walkDecls((declaration) => { declaration.value = rewriteCssText(declaration.value, owner, resolve); });
  return root.toString();
}

/** Inlines `@import` targets so a single scoped stylesheet can be pasted into a host page. */
export async function flattenStylesheet(css: string, owner: string, read: (relPath: string) => Promise<string | null>, depth = 0): Promise<string> {
  if (depth >= MAX_IMPORT_DEPTH) return css;
  const root = parseCss(css);
  const inlined: { rule: postcss.AtRule; css: string }[] = [];
  const pending: Promise<void>[] = [];
  root.walkAtRules("import", (rule) => {
    const reference = /^(?:url\()?\s*["']?([^"')\s]+)["']?/u.exec(rule.params)?.[1];
    const local = reference === undefined ? null : resolveLocalReference(reference, owner);
    if (local === null) return;
    pending.push(read(local).then(async (source) => {
      if (source === null) return;
      inlined.push({ rule, css: await flattenStylesheet(source, local, read, depth + 1) });
    }));
  });
  await Promise.all(pending);
  for (const item of inlined) item.rule.replaceWith(parseCss(item.css));
  return root.toString();
}

export function parseCss(css: string): postcss.Root {
  // `map: false`: project CSS is untrusted, so a sourceMappingURL comment must never make PostCSS read a file on this host.
  try { return postcss.parse(css, { from: undefined, map: false }); }
  catch { throw new ExportError("platform_package_incomplete"); }
}

export type StyleBlocks = { readonly shared: string; readonly page: string };
/** Splits the authored `<style>` block on the shared/page marker comments; legacy pages count as all-shared. */
export function splitStyleBlocks(document: HTMLElement): StyleBlocks {
  let shared = ""; let page = "";
  for (const style of document.querySelectorAll("style")) {
    const source = style.text;
    const marked = /\/\*\s*@bg-shared-css\s*\*\/([\s\S]*?)\/\*\s*@bg-page-css\s*\*\/([\s\S]*)$/iu.exec(source);
    if (marked === null) shared += source;
    else { shared += marked[1] ?? ""; page += marked[2] ?? ""; }
  }
  return { shared, page };
}

export type PageContent = { readonly element: HTMLElement | null; readonly html: string };
/** Returns the marked content landmark, falling back to `<main>` and then to the body minus shared chrome. */
export function extractPageContent(document: HTMLElement): PageContent {
  const marked = document.querySelector("main[data-bg-content]") ?? document.querySelector("main");
  if (marked !== null) return { element: marked, html: marked.innerHTML };
  const body = document.querySelector("body");
  if (body === null) throw new ExportError("platform_package_incomplete");
  const clone = parse(body.innerHTML, { comment: true });
  for (const chrome of clone.querySelectorAll("header,nav,footer")) chrome.remove();
  return { element: null, html: clone.toString() };
}

/**
 * Finds references no static rewriter can follow — lazy-load `data-*` attributes and
 * asset paths built inside scripts — so they are reported instead of silently broken (T27).
 */
export function findDynamicReferences(html: string, owner: string, assetPaths: ReadonlySet<string>): readonly string[] {
  const document = parse(html, { comment: false });
  const found = new Set<string>();
  for (const element of document.querySelectorAll("*")) {
    for (const [name, value] of Object.entries(element.attributes)) {
      if (!name.toLowerCase().startsWith("data-") || typeof value !== "string") continue;
      const target = resolveLocalReference(value, owner);
      if (target !== null && assetPaths.has(target)) found.add(value.trim());
    }
  }
  for (const script of document.querySelectorAll("script")) {
    for (const match of script.text.matchAll(/["'`]([^"'`]{1,512})["'`]/gu)) {
      const literal = match[1] ?? "";
      const target = resolveLocalReference(literal, owner);
      if (target !== null && assetPaths.has(target)) found.add(literal);
    }
  }
  return [...found].sort();
}

export function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/gu, "");
}

export function parseDocument(html: string): { readonly doctype: string; readonly document: HTMLElement } {
  const doctype = /^\s*<!doctype[^>]*>/iu.exec(html)?.[0]?.trim() ?? "<!doctype html>";
  return { doctype, document: parse(html.replace(/^\s*<!doctype[^>]*>/iu, ""), { comment: true }) };
}

function rewriteAttribute(element: HTMLElement, attribute: string, owner: string, resolve: ReferenceResolver): void {
  const value = element.getAttribute(attribute);
  if (value === undefined) return;
  const local = resolveLocalReference(value, owner);
  const replacement = local === null ? null : resolve(local);
  if (replacement !== null) element.setAttribute(attribute, replacement);
}

function rewriteCandidate(candidate: string, owner: string, resolve: ReferenceResolver): string {
  const trimmed = candidate.trim();
  const [reference, ...descriptors] = trimmed.split(/\s+/u);
  if (reference === undefined) return trimmed;
  const local = resolveLocalReference(reference, owner);
  const replacement = local === null ? null : resolve(local);
  return [replacement ?? reference, ...descriptors].join(" ");
}
