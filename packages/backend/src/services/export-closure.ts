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
      : extension === ".css" ? cssReferences(content, relativePath, limit) : scriptReferences(content, relativePath, limit);
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

const DOUBLE_QUOTE = 0x22;
const SINGLE_QUOTE = 0x27;
const OPEN_PAREN = 0x28;
const CLOSE_PAREN = 0x29;

/** The characters `\s` matches in a pattern. */
function isPatternSpace(code: number): boolean {
  return (code >= 0x09 && code <= 0x0d) || code === 0x20 || code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a)
    || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
}

/**
 * Collects what `/url\(\s*["']?([^"')]+)["']?\s*\)/giu` captures, in one forward pass instead of that pattern: on a value
 * that repeats `url(` and closes none of them, the pattern rescans the rest of the value from every opener. Every opener
 * before the next quote or `)` closes on that same character, so it is found once and its outcome is kept.
 * Appends to `values` and stops once it holds `limit` of them. Returns how many characters it examined: the test seam
 * that pins the pass as linear (at most four looks per character).
 */
export function cssUrlValues(value: string, values: string[], limit: number): number {
  const length = value.length;
  let examined = 0;
  // The first quote or `)` at or after the last place asked (`length`: none), and where a reference that closes on it ends (-1: it closes none).
  let delimiter = -1;
  let closedEnd = -1;
  const closeFrom = (from: number): number => {
    if (delimiter >= from) return closedEnd;
    delimiter = from;
    for (; delimiter < length; delimiter += 1) {
      examined += 1;
      const code = value.charCodeAt(delimiter);
      if (code === DOUBLE_QUOTE || code === SINGLE_QUOTE || code === CLOSE_PAREN) break;
    }
    closedEnd = -1;
    if (delimiter === length) return closedEnd;
    let close = delimiter;
    if (value.charCodeAt(close) !== CLOSE_PAREN) {
      close += 1;
      while (close < length && isPatternSpace(value.charCodeAt(close))) { close += 1; examined += 1; }
    }
    if (value.charCodeAt(close) === CLOSE_PAREN) closedEnd = close + 1;
    return closedEnd;
  };
  let index = 0;
  while (values.length < limit) {
    let open = -1;
    for (; index + 3 < length; index += 1) {
      examined += 1;
      // `| 0x20` lowers an ASCII letter; no other character folds to "u", "r" or "l".
      if ((value.charCodeAt(index) | 0x20) === 0x75 && (value.charCodeAt(index + 1) | 0x20) === 0x72 && (value.charCodeAt(index + 2) | 0x20) === 0x6c && value.charCodeAt(index + 3) === OPEN_PAREN) { open = index + 4; break; }
    }
    if (open === -1) break;
    let content = open;
    while (content < length && isPatternSpace(value.charCodeAt(content))) { content += 1; examined += 1; }
    // An opener that closes nothing: the next one is looked for right after it.
    index = open;
    if (content === length) continue;
    const first = value.charCodeAt(content);
    if (first === DOUBLE_QUOTE || first === SINGLE_QUOTE) {
      const end = closeFrom(content + 1);
      if (end !== -1 && delimiter > content + 1) { values.push(value.slice(content + 1, delimiter)); index = end; }
      // The pattern gives back one whitespace character to have a non-empty capture before a quote it then reads as the closing one.
      else if (content > open && value.charCodeAt(content + 1) === CLOSE_PAREN) { values.push(value.slice(content - 1, content)); index = content + 2; }
    } else if (first === CLOSE_PAREN) {
      // The same give-back for `url( )`.
      if (content > open) { values.push(value.slice(content - 1, content)); index = content + 1; }
    } else {
      const end = closeFrom(content);
      if (end !== -1) { values.push(value.slice(content, delimiter)); index = end; }
    }
  }
  return examined;
}

/** Collects imports in source order and stops once it holds `limit` of them. */
function scriptReferences(source: string, file: string, limit: number): readonly string[] {
  if (!file.endsWith(".js") && !file.endsWith(".mjs") && !file.endsWith(".cjs")) return [];
  const values: string[] = [];
  // A parser, not a pattern: comments, string and template literals and regex literals are not imports.
  try {
    for (const entry of IMPORT_SCANNER.scanImports(source)) {
      if (values.length >= limit) break;
      if (entry.kind === "import-statement" || entry.kind === "dynamic-import") values.push(entry.path);
    }
    return values;
  } catch { /* Not parseable as a module: keep the textual scan so an import a browser may still run cannot slip past. */ }
  scriptImportValues(source, values, limit);
  return values;
}

/** Whether `source` holds `import` or `export` at `index`. */
function isImportKeyword(source: string, index: number): boolean {
  return source.startsWith("import", index) || source.startsWith("export", index);
}

/**
 * The first quote at or after a position, for positions asked in non-decreasing order: a quote found once answers every
 * later question up to it, so each character is examined at most once. `length` when there is none.
 */
function quoteCursor(source: string, count: (examined: number) => void): (from: number) => number {
  let found = -1;
  return (from) => {
    if (found >= from) return found;
    found = from;
    let examined = 0;
    while (found < source.length && source.charCodeAt(found) !== DOUBLE_QUOTE && source.charCodeAt(found) !== SINGLE_QUOTE) { found += 1; examined += 1; }
    count(examined + 1);
    return found;
  };
}

/**
 * Collects what `/(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/gu` and then `/import\(\s*["']([^"']+)["']\s*\)/gu`
 * capture, in one forward pass each instead of those patterns: on a script that repeats `import` without a quoted
 * specifier, the patterns rescan the rest of the script from every keyword. Between a keyword and its specifier no quote
 * can appear, so the specifier always opens on the first quote after the keyword, and that quote is found once.
 * Appends to `values` and stops once it holds `limit` of them. Returns how many characters it examined: the test seam
 * that pins the pass as linear (at most eight looks per character).
 */
export function scriptImportValues(source: string, values: string[], limit: number): number {
  const length = source.length;
  let examined = 0;
  const count = (looks: number): void => { examined += looks; };
  // Statements: a keyword, whitespace, then either the specifier or `<anything> from` between whitespace before it.
  const openQuote = quoteCursor(source, count);
  const closeQuote = quoteCursor(source, count);
  // The start of the whitespace run that ends at the last opening quote looked at.
  let runQuote = -1;
  let runStart = -1;
  for (let index = 0; index + 6 < length && values.length < limit; index += 1) {
    examined += 1;
    if (!isImportKeyword(source, index)) continue;
    const keywordEnd = index + 6;
    if (!isPatternSpace(source.charCodeAt(keywordEnd))) continue;
    const open = openQuote(keywordEnd);
    if (open === length) break;
    const close = closeQuote(open + 1);
    // No quote after this one: no later keyword finds two either.
    if (close === length) break;
    if (close === open + 1) continue;
    if (runQuote !== open) {
      runQuote = open; runStart = open;
      while (runStart > keywordEnd && isPatternSpace(source.charCodeAt(runStart - 1))) { runStart -= 1; examined += 1; }
    }
    // `from` must end where the non-empty whitespace before the quote starts (it cannot end in whitespace), with
    // whitespace before it and room for the whitespace and the non-empty clause after the keyword.
    const from = runStart - 4;
    const matched = runStart === keywordEnd
      || (runStart < open && from >= keywordEnd + 3 && source.startsWith("from", from) && isPatternSpace(source.charCodeAt(from - 1)));
    if (!matched) continue;
    values.push(source.slice(open + 1, close));
    index = close;
  }
  // Calls: `import(`, optional whitespace, the quoted specifier, optional whitespace, `)`.
  const callClose = quoteCursor(source, count);
  for (let index = 0; index + 7 < length && values.length < limit; index += 1) {
    examined += 1;
    if (!source.startsWith("import(", index)) continue;
    let open = index + 7;
    while (open < length && isPatternSpace(source.charCodeAt(open))) { open += 1; examined += 1; }
    const quote = source.charCodeAt(open);
    if (quote !== DOUBLE_QUOTE && quote !== SINGLE_QUOTE) continue;
    const close = callClose(open + 1);
    if (close === length) break;
    if (close === open + 1) continue;
    let end = close + 1;
    while (end < length && isPatternSpace(source.charCodeAt(end))) { end += 1; examined += 1; }
    if (source.charCodeAt(end) !== CLOSE_PAREN) continue;
    values.push(source.slice(open + 1, close));
    index = end;
  }
  return examined;
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
