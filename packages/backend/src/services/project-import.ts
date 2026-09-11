import { Readable } from "node:stream";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { parse } from "node-html-parser";
import { createProjectRecord } from "../db/seed";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import { inspectCanonicalTree } from "./canonical-tree-manifest";
import { HTML_EXPORT_MANIFEST } from "./export-html-validation";
import { importDocumentFiles, initializeImportedProject, isImportedDocument } from "./project-import-init";
import { getSqlite } from "../db/sqlite-client";
import { projectsDir } from "../lib/paths";
import { localAssetReferences } from "./export-closure";
import { isProjectDocumentPath } from "./project-document-paths";

const MAX_UPLOAD = 48 * 1024 * 1024;
const MAX_EXPANDED = 128 * 1024 * 1024;
const MAX_FILES = 10_000;
export class ProjectImportError extends Error {
  constructor(readonly code: "invalid_project_import" | "project_import_limit" | "project_import_entrypoint") { super(code); }
}
type Entry = { name: string; bytes: Uint8Array };

function safePath(name: string): string {
  if (name.length > 1024 || name.includes("\\") || name.split("/").length > 32) throw new ProjectImportError("invalid_project_import");
  try { name.split("/").forEach(assertSafeName); } catch { throw new ProjectImportError("invalid_project_import"); }
  return name.normalize("NFC");
}

/** Reads uploaded bytes only. Never follows a client-supplied filesystem path or executes imported code. */
export async function importProject(form: FormData) {
  const name = form.get("name");
  const source = form.get("source");
  const files = form.getAll("files");
  if (typeof name !== "string" || !name.trim() || name.length > 200 || !["zip", "folder"].includes(String(source)) || !files.length || files.length > MAX_FILES || files.some(file => !(file instanceof File))) throw new ProjectImportError("invalid_project_import");
  const uploads = files as File[];
  if (uploads.reduce((sum, file) => sum + file.size, 0) > MAX_UPLOAD) throw new ProjectImportError("project_import_limit");
  let entries: Entry[] = [];
  if (source === "zip") {
    if (uploads.length !== 1) throw new ProjectImportError("invalid_project_import");
    let zip: JSZip;
    try { zip = await JSZip.loadAsync(await uploads[0]!.arrayBuffer()); } catch { throw new ProjectImportError("invalid_project_import"); }
    if (Object.keys(zip.files).length > MAX_FILES) throw new ProjectImportError("project_import_limit");
    let remaining = MAX_EXPANDED;
    for (const file of Object.values(zip.files)) {
      const raw = (file as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? file.name;
      const normalized = safePath(raw.replace(/\/$/, ""));
      if (file.unixPermissions !== null && (Number(file.unixPermissions) & 0xf000) === 0xa000) throw new ProjectImportError("invalid_project_import");
      if (file.dir) continue;
      const bytes = await boundedZip(file, remaining);
      remaining -= bytes.length;
      entries.push({ name: normalized, bytes });
    }
  } else {
    const paths = form.getAll("paths");
    if (paths.length !== uploads.length || paths.some(value => typeof value !== "string")) throw new ProjectImportError("invalid_project_import");
    for (let i = 0; i < uploads.length; i++) entries.push({ name: safePath(paths[i] as string), bytes: new Uint8Array(await uploads[i]!.arrayBuffer()) });
  }
  // Browser folder selection and Finder ZIPs both include one enclosing directory.
  entries = entries.filter(entry => !entry.name.split("/").some(part => part === "__MACOSX" || part === ".DS_Store" || part.startsWith("._")));
  while (entries.length && entries.every(entry => entry.name.includes("/") && entry.name.split("/")[0] === entries[0]!.name.split("/")[0])) entries = entries.map(entry => ({ ...entry, name: entry.name.slice(entry.name.indexOf("/") + 1) }));
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    if (seen.has(key) || entry.name.split("/").some(part => part.startsWith(".")) || /(?:^|\/)(?:node_modules|AGENTS\.md|CLAUDE\.md)(?:\/|$)/i.test(entry.name) || /\.(?:exe|dll|sh|bat|cmd|ps1|pem|key|p12|pfx)$/i.test(entry.name)) throw new ProjectImportError("invalid_project_import");
    seen.add(key);
  }
  let documents: File[];
  try { documents = importDocumentFiles(entries); } catch { throw new ProjectImportError("project_import_limit"); }
  const manifest = entries.find(entry => entry.name === HTML_EXPORT_MANIFEST);
  let entrypoint = entries.some(entry => entry.name === "index.html") ? "index.html" : entries.some(entry => entry.name === "deck.html") ? "deck.html" : "";
  if (manifest) {
    try { const value: unknown = JSON.parse(new TextDecoder().decode(manifest.bytes)); if (typeof value !== "object" || !value || !("entrypoint" in value) || typeof value.entrypoint !== "string") throw new Error(); entrypoint = safePath(value.entrypoint); } catch { throw new ProjectImportError("invalid_project_import"); }
  }
  if (!entrypoint) { const html = entries.filter(entry => /\.html?$/i.test(entry.name)); if (html.length === 1) entrypoint = html[0]!.name; }
  const entry = entries.find(item => item.name === entrypoint);
  if (!entry || !/\.html?$/i.test(entrypoint)) throw new ProjectImportError("project_import_entrypoint");
  const html = parse(new TextDecoder().decode(entry.bytes));
  const type = html.querySelector("[data-slide]") ? "slide_deck" : "prototype";
  // Explicitly referenced images remain authored assets; other docs stay private inputs.
  const referencedImages = new Set(entries.filter(item => /\.(?:html?|css)$/i.test(item.name)).flatMap(item => localAssetReferences(new TextDecoder().decode(item.bytes), item.name)).filter(name => /\.(?:png|jpe?g|webp)$/i.test(name) && !isProjectDocumentPath(name)));
  const created = await createProjectRecord({ name: name.trim(), type, designSystemId: null, backendId: "codex", optionsJson: null, entrypoint, thumbnailPath: null,
    initializeArtifact: async stage => {
      for (const item of entries.filter(item => item.name !== HTML_EXPORT_MANIFEST && (!isImportedDocument(item.name) || referencedImages.has(item.name)))) {
        const target = resolveWithin(stage, item.name);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, item.bytes, { flag: "wx" });
      }
      await inspectCanonicalTree(stage);
    },
  });
  try {
    const initialization = await initializeImportedProject(created, entries, documents);
    return { id: created.id, session_id: created.session_id, entrypoint: created.entrypoint, initialization };
  } catch {
    const owned = resolveWithin(projectsDir, assertSafeName(created.id));
    if (path.resolve(created.dir_path) !== owned) throw new ProjectImportError("invalid_project_import");
    getSqlite().prepare("DELETE FROM projects WHERE id=?").run(created.id);
    await rm(owned, { recursive: true, force: true });
    throw new ProjectImportError("invalid_project_import");
  }
}

function boundedZip(file: JSZip.JSZipObject, limit: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Uint8Array[] = [];
    const stream = file.nodeStream("nodebuffer");
    stream.on("data", (chunk: Uint8Array) => { size += chunk.length; if (size > limit) { stream.pause(); if (stream instanceof Readable) stream.destroy(); reject(new ProjectImportError("project_import_limit")); } else chunks.push(chunk); });
    stream.on("error", () => reject(new ProjectImportError("invalid_project_import")));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.resume();
  });
}
