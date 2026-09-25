import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { inspectCanonicalTree } from "./canonical-tree-manifest";
import { resolveStaticClosure } from "./export-closure";

const MAX_ENTRIES = 10_000;
const MAX_BYTES = 128 * 1024 * 1024;
export const HTML_EXPORT_MANIFEST = "burnguard-export.json";

export type HtmlArchiveManifest = {
  readonly schema_version: 1;
  readonly entrypoint: string;
  readonly project_revision: number;
  readonly project_digest: string;
  readonly input_closure_digest: string;
  readonly entries: readonly { readonly path: string; readonly size: number; readonly sha256: string }[];
};
export class HtmlExportValidationError extends Error {
  readonly name = "HtmlExportValidationError";
  constructor(readonly code: "invalid_zip" | "unsafe_entry" | "archive_limit" | "manifest_mismatch") { super(code); }
}

export async function validateHtmlArchive(bytes: Uint8Array, expected: Omit<HtmlArchiveManifest, "entries">): Promise<HtmlArchiveManifest> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false }); }
  catch { throw new HtmlExportValidationError("invalid_zip"); }
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  if (files.length === 0 || files.length > MAX_ENTRIES) throw new HtmlExportValidationError("archive_limit");
  const canonicalNames = new Set<string>();
  const entries: { path: string; size: number; sha256: string; bytes: Uint8Array }[] = [];
  let total = 0;
  for (const file of files) {
    const normalized = safeArchivePath(file.name);
    const canonical = normalized.normalize("NFC").toLocaleLowerCase("en-US");
    if (canonicalNames.has(canonical)) throw new HtmlExportValidationError("unsafe_entry");
    canonicalNames.add(canonical);
    const content = await file.async("uint8array"); total += content.length;
    if (total > MAX_BYTES) throw new HtmlExportValidationError("archive_limit");
    entries.push({ path: normalized, size: content.length, sha256: hash(content), bytes: content });
  }
  const manifestEntry = entries.find((entry) => entry.path === HTML_EXPORT_MANIFEST);
  if (manifestEntry === undefined) throw new HtmlExportValidationError("manifest_mismatch");
  const manifest = parseManifest(new TextDecoder().decode(manifestEntry.bytes));
  if (manifest.entrypoint !== expected.entrypoint || manifest.project_revision !== expected.project_revision || manifest.project_digest !== expected.project_digest || manifest.input_closure_digest !== expected.input_closure_digest) throw new HtmlExportValidationError("manifest_mismatch");
  const actualEntries = entries.filter((entry) => entry.path !== HTML_EXPORT_MANIFEST).map(({ path: entryPath, size, sha256 }) => ({ path: entryPath, size, sha256 })).sort(compareEntry);
  if (JSON.stringify(actualEntries) !== JSON.stringify(manifest.entries)) throw new HtmlExportValidationError("manifest_mismatch");
  // Canonical spelling: the tree manifest relativises realpath targets, so an 8.3, junction or linked temp root would miss every entry.
  const stage = await realpath(await mkdtemp(path.join(tmpdir(), "bg-html-validate-")));
  try {
    for (const entry of entries.filter((item) => item.path !== HTML_EXPORT_MANIFEST)) { const target = path.join(stage, entry.path); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, entry.bytes); }
    await resolveStaticClosure(stage, manifest.entrypoint, await inspectCanonicalTree(stage));
  } finally { await rm(stage, { recursive: true, force: true }); }
  return manifest;
}

export function buildHtmlArchiveManifest(input: Omit<HtmlArchiveManifest, "entries">, entries: HtmlArchiveManifest["entries"]): HtmlArchiveManifest {
  return { ...input, entries: [...entries].sort(compareEntry) };
}
function parseManifest(source: string): HtmlArchiveManifest {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new HtmlExportValidationError("manifest_mismatch"); }
  if (!isRecord(value) || !exact(value, ["schema_version", "entrypoint", "project_revision", "project_digest", "input_closure_digest", "entries"]) || value["schema_version"] !== 1 || typeof value["entrypoint"] !== "string" || typeof value["project_revision"] !== "number" || typeof value["project_digest"] !== "string" || typeof value["input_closure_digest"] !== "string" || !Array.isArray(value["entries"])) throw new HtmlExportValidationError("manifest_mismatch");
  const entries = value["entries"].map((entry) => {
    if (!isRecord(entry) || !exact(entry, ["path", "size", "sha256"]) || typeof entry["path"] !== "string" || typeof entry["size"] !== "number" || typeof entry["sha256"] !== "string") throw new HtmlExportValidationError("manifest_mismatch");
    return { path: entry["path"], size: entry["size"], sha256: entry["sha256"] };
  });
  return { schema_version: 1, entrypoint: value["entrypoint"], project_revision: value["project_revision"], project_digest: value["project_digest"], input_closure_digest: value["input_closure_digest"], entries };
}
function safeArchivePath(value: string): string {
  if (value.length === 0 || value.includes("\\") || value.startsWith("/") || value.normalize("NFC") !== value || path.posix.normalize(value) !== value || value.split("/").includes("..")) throw new HtmlExportValidationError("unsafe_entry");
  return value;
}
function exact(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function hash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function compareEntry(left: { readonly path: string }, right: { readonly path: string }): number { return left.path < right.path ? -1 : left.path > right.path ? 1 : 0; }
