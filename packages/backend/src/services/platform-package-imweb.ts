import path from "node:path";
import postcss from "postcss";
import { IMWEB_INLINE_IMAGE_BUDGET_BYTES, type PlatformLintDocument, type PlatformLintFinding } from "./platform-lint";
import { IMWEB_FOOTER_PATH, IMWEB_HEADER_PATH, IMWEB_SCOPE_CLASS } from "./platform-package-roles";
import { encode, type PackageEntry, type PackageEntryRole, type PlatformBuildInput, type PlatformBuildResult, type StagedAsset } from "./platform-package-contract";
import { extractPageContent, flattenStylesheet, isImagePath, normalizeBaseUrl, parseCss, parseDocument, resolveLocalReference, rewriteHtmlReferences, rewriteCssText, safeAssetUrl, splitStyleBlocks, stripHtmlComments } from "./platform-package-rewrite";

const SCOPE = `.${IMWEB_SCOPE_CLASS}`;
/** The code widget is not style-isolated, so Imweb's own heading and paragraph rules leak in (doc/14 section 7, [14]). */
const RESET = `${SCOPE} h1,${SCOPE} h2,${SCOPE} h3,${SCOPE} h4,${SCOPE} h5,${SCOPE} h6,${SCOPE} p{margin:0;padding:0;font:inherit;line-height:inherit}${SCOPE}{box-sizing:border-box}${SCOPE} *,${SCOPE} *::before,${SCOPE} *::after{box-sizing:inherit}`;
const IMAGE_MIME: Readonly<Record<string, string>> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp" };

/** Builds the code-widget package: one scoped fragment per page plus the shared header and footer code. */
export async function buildImwebPackage(input: PlatformBuildInput): Promise<PlatformBuildResult> {
  const baseUrl = input.options.asset_base_url === undefined ? null : normalizeBaseUrl(input.options.asset_base_url);
  const findings: PlatformLintFinding[] = [];
  const hosted = new Set<string>();
  const resolve = (relPath: string): string | null => {
    const asset = input.staged.assets.find((item) => item.rel_path === relPath);
    if (asset === undefined) return null;
    if (isImagePath(relPath) && asset.bytes.byteLength <= IMWEB_INLINE_IMAGE_BUDGET_BYTES) return dataUri(relPath, asset.bytes);
    if (baseUrl !== null) return safeAssetUrl(baseUrl, encodeURI(path.posix.basename(relPath)));
    if (isImagePath(relPath) && !hosted.has(relPath)) {
      hosted.add(relPath);
      findings.push({ code: "imweb_image_needs_hosting", severity: "warning", path: relPath, evidence: `${asset.bytes.byteLength} bytes exceed the inline budget; attach the image to a board post and re-export with that URL.` });
    }
    return null;
  };

  const entries: PackageEntry[] = [];
  const roles: PackageEntryRole[] = [];
  const documents: PlatformLintDocument[] = [];
  let sharedCss = "";
  const scripts: string[] = [];

  for (const page of input.staged.pages) {
    const { document } = parseDocument(page.html);
    const content = extractPageContent(document);
    const styles = splitStyleBlocks(document);
    if (page.rel_path === input.entrypoint) {
      sharedCss = `${await linkedStylesheets(document, page.rel_path, input.staged.assets, resolve)}${rewriteCssText(styles.shared, page.rel_path, resolve)}`;
      scripts.push(...linkedScripts(document, page.rel_path, input.staged.assets));
    }
    const slug = pageSlug(page.rel_path);
    if (content.element !== null) rewriteHtmlReferences(content.element, page.rel_path, resolve);
    const body = stripHtmlComments(content.element === null ? content.html : content.element.toString());
    const pageCss = scopeCss(rewriteCssText(styles.page, page.rel_path, resolve), slug);
    const fragmentPath = `pages/${slug}.imweb.html`;
    const fragment = `<div class="${IMWEB_SCOPE_CLASS} bg-page-${slug}">${pageCss.trim() === "" ? "" : `<style>${pageCss}</style>`}${body}</div>\n`;
    entries.push({ path: fragmentPath, bytes: encode(fragment) });
    roles.push({ path: fragmentPath, role: "page_fragment" });
    documents.push({ path: fragmentPath, text: fragment, role: "page_fragment" });
  }

  const header = `<style>\n${RESET}${scopeCss(sharedCss, "shared")}\n</style>\n`;
  const footer = `<script>\n${scripts.join("\n")}\n</script>\n`;
  for (const [entryPath, text] of [[IMWEB_HEADER_PATH, header], [IMWEB_FOOTER_PATH, footer]] as const) {
    entries.push({ path: entryPath, bytes: encode(text) });
    roles.push({ path: entryPath, role: "common_code" });
    documents.push({ path: entryPath, text, role: "common_code" });
  }
  return { entries, roles, documents, assets: [], findings, external_urls: baseUrl === null ? [] : [baseUrl] };
}

export function pageSlug(relPath: string): string {
  const withoutExtension = relPath.slice(0, relPath.length - path.posix.extname(relPath).length);
  return withoutExtension.replaceAll("/", "-").replace(/[^\p{L}\p{N}_-]/gu, "-").toLocaleLowerCase("en-US");
}

/** Prefixes every selector with the widget scope and remaps document-level selectors, keyframe names and animation references. */
export function scopeCss(css: string, keyframeNamespace: string): string {
  const root = parseCss(css);
  const renamed = new Map<string, string>();
  root.walkAtRules((rule) => {
    if (!rule.name.toLowerCase().endsWith("keyframes")) return;
    const from = rule.params.trim();
    const to = `bg-${keyframeNamespace}-${from}`;
    renamed.set(from, to);
    rule.params = to;
  });
  root.walkRules((rule) => {
    if (rule.parent instanceof postcss.AtRule && rule.parent.name.toLowerCase().endsWith("keyframes")) return;
    rule.selectors = rule.selectors.map(scopeSelector);
  });
  root.walkDecls(/^animation(-name)?$/u, (declaration) => {
    for (const [from, to] of renamed) declaration.value = declaration.value.replace(new RegExp(`(^|[\\s,])${escapeRegExp(from)}($|[\\s,])`, "gu"), `$1${to}$2`);
  });
  return root.toString();
}

function scopeSelector(selector: string): string {
  const value = selector.trim();
  if (value === "") return value;
  if (value.startsWith(SCOPE)) return value;
  const documentLevel = /^(?::root|html|body|:host)\b/iu.exec(value);
  if (documentLevel === null) return `${SCOPE} ${value}`;
  const rest = value.slice(documentLevel[0].length).trim();
  return rest === "" ? SCOPE : `${SCOPE} ${rest.replace(/^(?:>|~|\+)\s*/u, "")}`;
}

async function linkedStylesheets(document: ReturnType<typeof parseDocument>["document"], owner: string, assets: readonly StagedAsset[], resolve: (relPath: string) => string | null): Promise<string> {
  const read = async (relPath: string): Promise<string | null> => {
    const asset = assets.find((item) => item.rel_path === relPath);
    return asset === undefined ? null : new TextDecoder().decode(asset.bytes);
  };
  let css = "";
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    const target = resolveLocalReference(link.getAttribute("href") ?? "", owner);
    const source = target === null ? null : await read(target);
    if (target === null || source === null) continue;
    css += rewriteCssText(await flattenStylesheet(source, target, read), target, resolve);
  }
  return css;
}

function linkedScripts(document: ReturnType<typeof parseDocument>["document"], owner: string, assets: readonly StagedAsset[]): readonly string[] {
  const sources: string[] = [];
  for (const script of document.querySelectorAll("script")) {
    const reference = script.getAttribute("src");
    if (reference === undefined) { sources.push(script.text); continue; }
    const target = resolveLocalReference(reference, owner);
    const asset = target === null ? undefined : assets.find((item) => item.rel_path === target);
    if (asset !== undefined) sources.push(new TextDecoder().decode(asset.bytes));
  }
  return sources;
}

function dataUri(relPath: string, bytes: Uint8Array): string {
  const extension = path.posix.extname(relPath).slice(1).toLowerCase();
  return `data:${IMAGE_MIME[extension] ?? "application/octet-stream"};base64,${Buffer.from(bytes).toString("base64")}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
