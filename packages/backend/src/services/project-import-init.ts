import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "node-html-parser";
import { ulid } from "ulid";
import { saveSessionAttachments, validateAttachmentFiles } from "./attachments";
import { saveProjectDocuments } from "./project-documents";
import { getSqlite } from "../db/sqlite-client";
import { insertAttachmentRecord } from "../db/attachment-context";
import { createHash } from "node:crypto";
import { insertNormalizedEvent } from "../db/events";
import { resolveWithin } from "../security/path-boundary";

export const IMPORT_CONTEXT_PATH = ".meta/import-context.json";
export type ImportEntry = { name: string; bytes: Uint8Array };
export const isImportedDocument = (name: string) => /^docs\//i.test(name) && /\.(pdf|pptx|docx|png|jpe?g|webp|txt|md|csv)$/i.test(name);
export function importDocumentFiles(entries: ImportEntry[]): File[] {
  const mime: Record<string, string> = { ".pdf": "application/pdf", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv" };
  const files = entries.filter(entry => isImportedDocument(entry.name)).map(entry => {
    const extension = path.extname(entry.name), name = entry.name.slice(5, -extension.length).replaceAll("/", " — ");
    return new File([Buffer.from(entry.bytes)], `${Array.from(name).slice(0, 100).join("")}${extension}`, { type: mime[extension.toLowerCase()] ?? "application/octet-stream" });
  });
  validateAttachmentFiles(files);
  return files;
}

/** Local initialization only: inspect documents and markup; never execute instructions or imported scripts. */
export async function initializeImportedProject(project: { id: string; session_id: string; dir_path: string; entrypoint: string }, entries: ImportEntry[], documents: File[]) {
  const pages = entries.filter(entry => /\.html?$/i.test(entry.name) && !isImportedDocument(entry.name)).slice(0, 20).map(entry => {
    if (entry.bytes.length > 2 * 1024 * 1024) return { path: entry.name, status: "too_large", title: "", headings: [] };
    const root = parse(new TextDecoder().decode(entry.bytes));
    return { path: entry.name, status: "read", title: (root.querySelector("title")?.textContent ?? "").slice(0, 120), headings: root.querySelectorAll("h1,h2,h3").slice(0, 8).map(heading => heading.textContent.trim().slice(0, 120)), slides: root.querySelectorAll("[data-slide]").length, charts: root.querySelectorAll("[data-bg-chart]").length };
  });
  const styles = entries.filter(entry => /\.css$/i.test(entry.name)).slice(0, 20).map(entry => ({ path: entry.name, tokens: [...new TextDecoder().decode(entry.bytes.slice(0, 256000)).matchAll(/(--[\w-]+)\s*:\s*([^;{}]{1,100})/g)].slice(0, 20).map(match => ({ name: match[1], value: match[2] })) }));
  // Originals survive extraction errors and artifact rollback. Store first, then extract each independently.
  await saveProjectDocuments(project.session_id, documents);
  const results: { name: string; status: "ready" | "needs_review" }[] = [];
  const initId = ulid();
  for (const file of documents) {
    try {
      const paths = await saveSessionAttachments(project.session_id, [file]);
      for (const source of paths) getSqlite().prepare("UPDATE attachments SET turn_id=? WHERE session_id=? AND file_path=? AND turn_id IS NULL").run(initId, project.session_id, source);
      results.push({ name: file.name, status: "ready" });
    } catch {
      // An extractor failure must not remove the original from future AI context.
      const bytes = Buffer.from(await file.arrayBuffer());
      const source = resolveWithin(project.dir_path, ".attachments", `${ulid()}-${file.name.replace(/[^A-Za-z0-9_.-]/g, "_")}`);
      await writeFile(source, bytes, { flag: "wx" });
      insertAttachmentRecord({ sessionId: project.session_id, filePath: source, mimeType: file.type, originalName: file.name, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
      getSqlite().prepare("UPDATE attachments SET turn_id=? WHERE session_id=? AND file_path=? AND turn_id IS NULL").run(initId, project.session_id, source);
      results.push({ name: file.name, status: "needs_review" });
    }
  }
  const report = { schema_version: 1, entrypoint: project.entrypoint, file_count: entries.length, pages, styles, documents: results, initialized_at: Date.now() };
  await writeFile(resolveWithin(project.dir_path, IMPORT_CONTEXT_PATH), JSON.stringify(report));
  const failed = results.filter(item => item.status === "needs_review").length;
  await insertNormalizedEvent(project.session_id, { id: ulid(), ts: Date.now(), type: "tool.started", turnId: initId, toolCallId: initId, tool: "프로젝트 자동 초기화", input: { pages: pages.length, documents: results.length } });
  await insertNormalizedEvent(project.session_id, { id: ulid(), ts: Date.now(), type: "tool.finished", turnId: initId, toolCallId: initId, tool: "프로젝트 자동 초기화", ok: failed === 0, output: `${pages.filter(page => page.status === "read").length}개 HTML과 ${styles.length}개 CSS를 읽었어요. 자료 ${results.length - failed}개를 다음 AI 작업에 연결했어요.${failed ? ` 자료 ${failed}개는 텍스트 추출을 확인해야 해요. 원본은 프로젝트 파일에 보존했어요.` : ""}` });
  return { pages: pages.length, documents: results.length, needs_review: failed };
}

export async function readImportContext(projectDir: string): Promise<string | null> {
  try {
    const bytes = await readFile(resolveWithin(projectDir, IMPORT_CONTEXT_PATH));
    if (bytes.length > 128000) return null;
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || !("schema_version" in value) || value.schema_version !== 1) return null;
    return JSON.stringify(value);
  } catch { return null; }
}
