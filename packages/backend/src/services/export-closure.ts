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

export class ExportClosureError extends Error {
  readonly name = "ExportClosureError";
  constructor(readonly code: "malformed_html" | "missing_asset" | "remote_asset" | "unsafe_asset" | "closure_limit", readonly asset: string) {
    super(`${code}: ${asset}`);
  }
}

export type ExportClosure = { readonly entrypoint: string; readonly referenced_paths: readonly string[] };

export async function resolveStaticClosure(root: string, entrypoint: string, manifest: CanonicalTreeManifest): Promise<ExportClosure> {
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
    const rawReferences = extension === ".html" || extension === ".htm"
      ? htmlReferences(content, relativePath)
      : extension === ".css" ? cssReferences(content, relativePath) : scriptReferences(content, relativePath);
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

function htmlReferences(source: string, file: string): readonly string[] {
  const document = parse(source);
  if (document.querySelector("html") === null || document.querySelector("body") === null) throw new ExportClosureError("malformed_html", file);
  const values: string[] = [];
  for (const element of document.querySelectorAll("link,script,img,source,video,audio,input,object,embed,use,image")) {
    for (const attribute of HTML_ATTRIBUTES) {
      if (attribute === "href" && element.tagName === "A") continue;
      const value = element.getAttribute(attribute);
      if (value !== undefined) values.push(value);
    }
    const srcset = element.getAttribute("srcset");
    if (srcset !== undefined) values.push(...srcset.split(",").map((item) => item.trim().split(/\s+/)[0] ?? ""));
  }
  for (const style of document.querySelectorAll("style")) values.push(...cssReferences(style.text, file));
  for (const element of document.querySelectorAll("[style]")) values.push(...cssUrlValues(element.getAttribute("style") ?? ""));
  return values;
}

function cssReferences(source: string, file: string): readonly string[] {
  let root: postcss.Root;
  // `map: false`: project CSS is untrusted, so a `sourceMappingURL` comment must
  // not make PostCSS read a file on this host. The stable file name is the only
  // detail exposed; dependency exception text is not.
  try { root = postcss.parse(source, { from: file, map: false }); }
  catch { throw new ExportClosureError("malformed_html", file); }
  const values: string[] = [];
  root.walkAtRules("import", (rule) => {
    const match = /^(?:url\()?\s*["']?([^"')\s]+)["']?/.exec(rule.params);
    if (match?.[1] !== undefined) values.push(match[1]);
  });
  root.walkDecls((declaration) => { values.push(...cssUrlValues(declaration.value)); });
  return values;
}

function cssUrlValues(value: string): readonly string[] {
  return [...value.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/giu)].map((match) => match[1] ?? "");
}

function scriptReferences(source: string, file: string): readonly string[] {
  if (!file.endsWith(".js") && !file.endsWith(".mjs") && !file.endsWith(".cjs")) return [];
  const patterns = [/(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/gu, /import\(\s*["']([^"']+)["']\s*\)/gu];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1] ?? ""));
}

function resolveReference(raw: string, owner: string): string | null {
  const value = raw.trim();
  if (value.length === 0 || value.startsWith("#")) return null;
  if (value.startsWith("data:")) {
    if (!/^data:image\/(?:png|gif|jpeg|webp|svg\+xml);base64,/iu.test(value) || value.length > MAX_DATA_IMAGE_BYTES * 2) throw new ExportClosureError("unsafe_asset", value.slice(0, 64));
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
