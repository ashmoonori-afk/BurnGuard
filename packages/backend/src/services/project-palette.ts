import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { parse } from "node-html-parser";
import postcss from "postcss";
import type { ProjectPalette } from "@bg/shared";
import { resolveWithin } from "../security/path-boundary";
import { inspectCanonicalTree } from "./canonical-tree-manifest";
import { ArtifactOperationError } from "./artifact-coordinator";

type Color = ProjectPalette["colors"][number];
type Range = { start: number; end: number; inline: boolean };

function hex(value: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) return `#${[...value.slice(1)].map((c) => c + c).join("").toLowerCase()}`;
  return null;
}

/** Only opaque hexadecimal CSS colors are exposed. Strings, URLs and alpha colors stay untouched. */
export function paletteCss(css: string, colors: Map<string, Color>, change?: { color: string; value: string }, inline = false): string {
  const tree = postcss.parse(inline ? `a{${css}}` : css);
  tree.walkDecls((decl) => {
    if (!/^(?:--|color$|background|border|outline|(?:box|text)-shadow$|fill$|stroke$|caret-color$|accent-color$|text-decoration-color$)/i.test(decl.prop)) return;
    decl.value = decl.value.replace(/url\((?:\\.|[^)])*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|#[\w-]+/gi, (token) => {
      const value = hex(token);
      if (value === null) return token;
      const previous = colors.get(value);
      colors.set(value, { id: value, value, name: decl.prop.startsWith("--") ? decl.prop : previous?.name ?? value, count: (previous?.count ?? 0) + 1 });
      return change?.color === value ? change.value : token;
    });
  });
  const output = tree.toString();
  return inline ? output.slice(2, -1) : output;
}

function htmlCssRanges(source: string): Range[] {
  const root = parse(source, { comment: true });
  const ranges: Range[] = [];
  for (const node of root.querySelectorAll("*")) {
    if (node.tagName === "SCRIPT") continue;
    const start = node.range[0];
    const opening = /^<[^\s>]+(?:"[^"]*"|'[^']*'|[^'">])*>/.exec(source.slice(start))?.[0];
    if (!opening) continue;
    if (node.tagName === "STYLE" && (!node.getAttribute("type") || node.getAttribute("type")?.toLowerCase() === "text/css")) {
      ranges.push({ start: start + opening.length, end: node.range[1] - (/<\/style\s*>$/i.exec(source.slice(start, node.range[1]))?.[0].length ?? 0), inline: false });
    }
    // Match attributes as tokens so text inside another attribute cannot become a style attribute.
    const attributes = /([^\s=<>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
    attributes.lastIndex = 1 + node.rawTagName.length;
    for (let match = attributes.exec(opening); match !== null; match = attributes.exec(opening)) {
      const raw = match[2];
      if (match[1]?.toLowerCase() !== "style" || raw === undefined) continue;
      const quoted = raw.startsWith('"') || raw.startsWith("'");
      const offset = match.index + match[0].lastIndexOf(raw) + (quoted ? 1 : 0);
      const end = offset + raw.length - (quoted ? 2 : 0);
      // Entity-encoded inline CSS needs HTML decoding/re-encoding; leave it unchanged rather than corrupt bytes.
      if (!opening.slice(offset, end).includes("&")) ranges.push({ start: start + offset, end: start + end, inline: true });
    }
  }
  return ranges.sort((a, b) => b.start - a.start);
}

export function paletteHtml(source: string, colors: Map<string, Color>, change?: { color: string; value: string }): string {
  for (const range of htmlCssRanges(source)) {
    const css = source.slice(range.start, range.end);
    const next = paletteCss(css, colors, change, range.inline);
    if (change !== undefined && css !== next) source = source.slice(0, range.start) + next + source.slice(range.end);
  }
  return source;
}

/** Reads only canonical authored files; local linked stylesheets are included in the reported scope. */
export async function projectPaletteFiles(root: string, relPath: string): Promise<Map<string, string>> {
  if (!/\.html?$/i.test(relPath)) throw new ArtifactOperationError("unsupported_palette_file", "Select an HTML page");
  const manifest = await inspectCanonicalTree(root);
  const allowed = new Set(manifest.files.map((file) => file.path));
  const read = async (name: string): Promise<string> => {
    const bytes = await readFile(resolveWithin(root, name));
    if (createHash("sha256").update(bytes).digest("hex") !== manifest.files.find((file) => file.path === name)?.sha256) throw new ArtifactOperationError("stale_artifact_digest", "Artifact changed while reading colors");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  };
  if (!allowed.has(relPath)) throw new ArtifactOperationError("palette_file_not_found", "Page is unavailable");
  const source = await read(relPath);
  const files = new Map([[relPath, source]]);
  const document = parse(source);
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    const href = link.getAttribute("href");
    if (!href || /^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) continue;
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), decodeURIComponent(href.split(/[?#]/)[0] ?? "")));
    if (!relative.endsWith(".css") || !allowed.has(relative)) continue;
    files.set(relative, await read(relative));
  }
  return files;
}

export async function readProjectPalette(root: string, relPath: string): Promise<Pick<ProjectPalette, "colors" | "files">> {
  const files = await projectPaletteFiles(root, relPath);
  const colors = new Map<string, Color>();
  for (const [name, source] of files) {
    if (/\.html?$/i.test(name)) paletteHtml(source, colors);
    else paletteCss(source, colors);
  }
  return { colors: [...colors.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)), files: [...files.keys()] };
}

export async function replaceProjectPalette(root: string, relPath: string, color: string, value: string): Promise<void> {
  const files = await projectPaletteFiles(root, relPath);
  const colors = new Map<string, Color>();
  const updates = new Map<string, string>();
  for (const [name, source] of files) {
    const next = /\.html?$/i.test(name) ? paletteHtml(source, colors, { color, value }) : paletteCss(source, colors, { color, value });
    if (next !== source) updates.set(name, next);
  }
  if (!colors.has(color)) throw new ArtifactOperationError("stale_palette_color", "Selected color is no longer present");
  for (const [name, source] of updates) await writeFile(resolveWithin(root, name), source);
}
