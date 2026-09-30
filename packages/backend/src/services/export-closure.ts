import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "node-html-parser";
import postcss from "postcss";
import type { CanonicalTreeManifest } from "./canonical-tree-manifest";
import { resolveWithin } from "../security/path-boundary";

const MAX_DEPTH = 16;
const MAX_REFERENCES = 10_000;
const MAX_DATA_IMAGE_BYTES = 2 * 1024 * 1024;
const HTML_ATTRIBUTES = ["src", "poster", "href", "xlink:href"] as const;
const METADATA_LINK_RELATIONS: ReadonlySet<string> = new Set(["canonical", "alternate"]);
const IMPORT_SCANNER = new Bun.Transpiler({ loader: "js" });

export class ExportClosureError extends Error {
  readonly name = "ExportClosureError";
  constructor(readonly code: "malformed_html" | "missing_asset" | "remote_asset" | "unsafe_asset" | "closure_limit", readonly asset: string) {
    super(`${code}: ${asset}`);
  }
}

export type ExportClosure = { readonly entrypoint: string; readonly referenced_paths: readonly string[] };

/** Test seam: reports how many raw references one file's scan collected. */
export type ClosureScanProbe = (file: string, collected: number) => void;

export async function resolveStaticClosure(root: string, entrypoint: string, manifest: CanonicalTreeManifest, onScan?: ClosureScanProbe): Promise<ExportClosure> {
  const files = new Set(manifest.files.map((file) => file.path));
  if (!files.has(entrypoint)) throw new ExportClosureError("missing_asset", entrypoint);
  const visited = new Set<string>();
  const references = new Set<string>();
  let count = 0;

  const visit = async (relativePath: string, depth: number): Promise<void> => {
    if (visited.has(relativePath)) return;
    if (depth > MAX_DEPTH) throw new ExportClosureError("closure_limit", relativePath);
    visited.add(relativePath);
    const content = await readFile(resolveWithin(root, relativePath), "utf8");
    const extension = path.posix.extname(relativePath).toLowerCase();
    // One past the remaining budget is enough to refuse: a scan never collects what the cap below would reject anyway.
    const limit = MAX_REFERENCES - count + 1;
    const rawReferences = extension === ".html" || extension === ".htm"
      ? htmlReferences(content, relativePath, limit)
      : extension === ".css" ? cssReferences(content, relativePath, limit) : scriptReferences(content, relativePath);
    onScan?.(relativePath, rawReferences.length);
    for (const raw of rawReferences) {
      count += 1;
      if (count > MAX_REFERENCES) throw new ExportClosureError("closure_limit", raw);
      const resolved = resolveReference(raw, relativePath);
      if (resolved === null) continue;
      if (!files.has(resolved)) throw new ExportClosureError("missing_asset", resolved);
      references.add(resolved);
      const childExtension = path.posix.extname(resolved).toLowerCase();
      if (childExtension === ".css" || childExtension === ".js" || childExtension === ".mjs" || childExtension === ".cjs") await visit(resolved, depth + 1);
    }
  };

  await visit(entrypoint, 0);
  return { entrypoint, referenced_paths: [...references].sort(compareText) };
}

/** Best-effort inventory for imports; strict export validation still uses the full closure. */
export function localAssetReferences(source: string, file: string): readonly string[] {
  let values: readonly string[];
  try { values = /\.css$/i.test(file) ? cssReferences(source, file, Number.POSITIVE_INFINITY) : htmlReferences(`<html><body>${source}</body></html>`, file, Number.POSITIVE_INFINITY); }
  catch { return []; }
  // Documents repeat their references: each distinct value is resolved once (null: not a local path, or refused).
  const resolvedByValue = new Map<string, string | null>();
  const resolved: string[] = [];
  for (const value of values) {
    let local = resolvedByValue.get(value);
    if (local === undefined) {
      try { local = resolveReference(value, file) || null; }
      catch { local = null; }
      resolvedByValue.set(value, local);
    }
    if (local !== null) resolved.push(local);
  }
  return resolved;
}

/** Collects raw references in document order and stops once `limit` of them are held. */
function htmlReferences(source: string, file: string, limit: number): readonly string[] {
  const document = parse(source);
  if (document.querySelector("html") === null || document.querySelector("body") === null) throw new ExportClosureError("malformed_html", file);
  const values: string[] = [];
  for (const element of document.querySelectorAll("link,script,img,source,video,audio,input,object,embed,use,image")) {
    for (const attribute of HTML_ATTRIBUTES) {
      if (values.length >= limit) return values;
      if (attribute === "href" && (element.tagName === "A" || (element.tagName === "LINK" && isMetadataLink(element.getAttribute("rel"))))) continue;
      const value = element.getAttribute(attribute);
      if (value !== undefined) values.push(value);
    }
    const srcset = element.getAttribute("srcset");
    if (srcset !== undefined) srcsetUrls(srcset, values, limit);
  }
  for (const style of document.querySelectorAll("style")) {
    if (values.length >= limit) return values;
    cssReferences(style.text, file, limit, values);
  }
  if (values.length >= limit) return values;
  for (const element of document.querySelectorAll("[style]")) {
    if (values.length >= limit) return values;
    cssUrlValues(element.getAttribute("style") ?? "", values, limit);
  }
  return values;
}

/** True only when every relation is one a browser never fetches; any other relation, or none, keeps the href under the closure rules. */
function isMetadataLink(rel: string | undefined): boolean {
  const relations = (rel ?? "").toLowerCase().split(/[ \t\n\f\r]+/u).filter((relation) => relation !== "");
  return relations.length > 0 && relations.every((relation) => METADATA_LINK_RELATIONS.has(relation));
}

/**
 * HTML candidate grammar, in one linear pass: a URL is a run without ASCII whitespace (so a comma inside a data: URL
 * stays in it), and its descriptors end at the first comma outside parentheses, exactly where a browser starts the next candidate.
 * Appends to `urls` and stops once it holds `limit` values.
 */
function srcsetUrls(srcset: string, urls: string[], limit: number): void {
  const space = (character: string | undefined): boolean => character === " " || character === "\t" || character === "\n" || character === "\f" || character === "\r";
  let index = 0;
  while (index < srcset.length && urls.length < limit) {
    while (index < srcset.length && (space(srcset[index]) || srcset[index] === ",")) index += 1;
    const start = index;
    while (index < srcset.length && !space(srcset[index])) index += 1;
    if (start === index) break;
    let end = index;
    while (end > start && srcset[end - 1] === ",") end -= 1;
    urls.push(srcset.slice(start, end));
    if (end < index) continue;
    for (let inParens = false; index < srcset.length; index += 1) {
      const character = srcset[index];
      if (character === "(") inParens = true;
      else if (character === ")") inParens = false;
      else if (character === "," && !inParens) { index += 1; break; }
    }
  }
}

/** Appends to `values` and stops once it holds `limit` of them; the stylesheet is still parsed whole, so malformed CSS is refused either way. */
function cssReferences(source: string, file: string, limit: number, values: string[] = []): readonly string[] {
  let root: postcss.Root;
  // `map: false`: project CSS is untrusted, so a `sourceMappingURL` comment must
  // not make PostCSS read a file on this host. The stable file name is the only
  // detail exposed; dependency exception text is not.
  try { root = postcss.parse(source, { from: file, map: false }); }
  catch { throw new ExportClosureError("malformed_html", file); }
  root.walkAtRules("import", (rule) => {
    if (values.length >= limit) return false;
    const match = /^(?:url\()?\s*["']?([^"')\s]+)["']?/.exec(rule.params);
    if (match?.[1] !== undefined) values.push(match[1]);
    return undefined;
  });
  root.walkDecls((declaration) => {
    if (values.length >= limit) return false;
    cssUrlValues(declaration.value, values, limit);
    return undefined;
  });
  return values;
}

/** One match at a time, not a spread of every match: appends to `values` and stops once it holds `limit` of them. */
function cssUrlValues(value: string, values: string[], limit: number): void {
  const pattern = /url\(\s*["']?([^"')]+)["']?\s*\)/giu;
  for (let match = pattern.exec(value); match !== null && values.length < limit; match = pattern.exec(value)) values.push(match[1] ?? "");
}

function scriptReferences(source: string, file: string): readonly string[] {
  if (!file.endsWith(".js") && !file.endsWith(".mjs") && !file.endsWith(".cjs")) return [];
  // A parser, not a pattern: comments, string and template literals and regex literals are not imports.
  try { return IMPORT_SCANNER.scanImports(source).filter((entry) => entry.kind === "import-statement" || entry.kind === "dynamic-import").map((entry) => entry.path); }
  catch { /* Not parseable as a module: keep the textual scan so an import a browser may still run cannot slip past. */ }
  const patterns = [/(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/gu, /import\(\s*["']([^"']+)["']\s*\)/gu];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1] ?? ""));
}

function resolveReference(raw: string, owner: string): string | null {
  const value = raw.trim();
  if (value.length === 0 || value.startsWith("#")) return null;
  if (value.startsWith("data:")) {
    // Image and font media types the artifact CSP admits via data:, in base64 or percent-encoded form.
    if (!/^data:(?:image\/(?:png|gif|jpeg|webp|avif|svg\+xml)|font\/(?:woff2?|ttf|otf))(?:;[a-z0-9=._-]+)*,/iu.test(value) || value.length > MAX_DATA_IMAGE_BYTES * 2) throw new ExportClosureError("unsafe_asset", value.slice(0, 64));
    return null;
  }
  let url: URL;
  try { url = new URL(value, "https://burnguard.invalid/"); }
  catch { throw new ExportClosureError("unsafe_asset", value); }
  if (url.username !== "" || url.password !== "" || value.startsWith("//") || /^[a-z][a-z\d+.-]*:/iu.test(value)) throw new ExportClosureError("remote_asset", value);
  let decoded: string;
  try { decoded = decodeURIComponent(value.split(/[?#]/u)[0] ?? ""); }
  catch { throw new ExportClosureError("unsafe_asset", value); }
  const joined = decoded.startsWith("/") ? decoded.slice(1) : path.posix.join(path.posix.dirname(owner), decoded);
  const normalized = path.posix.normalize(joined);
  if (normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/") || normalized.includes("\\")) throw new ExportClosureError("unsafe_asset", value);
  return normalized;
}

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
