import { createHash } from "node:crypto";
import type { VisualSourceRole } from "@bg/shared";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { ulid } from "ulid";
import { getAttachmentContext, insertAttachmentRecord } from "../db/attachment-context";
import { getSqlite } from "../db/sqlite-client";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import { inferAttachmentKind } from "./upload-kind";
import { attachmentExtractedTextPath, attachmentSummaryPath } from "./attachment-paths";
export { attachmentExtractedTextPath, attachmentSummaryPath };

/** Authoritative intake limits. The composer mirrors these for early feedback only. */
export const ATTACHMENT_LIMITS = {
  maxCount: 8,
  maxBytesPerFile: 10 * 1024 * 1024,
  maxBytesTotal: 25 * 1024 * 1024,
} as const;

/** Raised when an upload's kind is one `inferAttachmentKind` cannot resolve to an extractor. */
export class UnsupportedAttachmentKindError extends Error {
  readonly name = "UnsupportedAttachmentKindError";
  readonly code = "unsupported_file_kind";
  readonly fileNames: readonly string[];

  constructor(fileNames: readonly string[]) {
    super(`unsupported_file_kind:${fileNames.join(",")}`);
    this.fileNames = fileNames;
  }
}

export type AttachmentUpload = File | {
  readonly file: File;
  readonly role: VisualSourceRole;
  readonly roleExplicit?: boolean;
};

export function validateAttachmentFiles(files: readonly File[]): void {
  if (files.length > ATTACHMENT_LIMITS.maxCount) {
    throw new Error(`attachment_limit_exceeded:${ATTACHMENT_LIMITS.maxCount}`);
  }

  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  const oversized = files.find((file) => file.size > ATTACHMENT_LIMITS.maxBytesPerFile);
  if (oversized !== undefined) throw new Error(`attachment_too_large:${oversized.name || "attachment"}:${ATTACHMENT_LIMITS.maxBytesPerFile}`);
  if (totalBytes > ATTACHMENT_LIMITS.maxBytesTotal) throw new Error(`attachment_total_too_large:${ATTACHMENT_LIMITS.maxBytesTotal}`);

  // Kind gate runs before any write so a batch containing a source the
  // extractor cannot process persists nothing at all.
  const unsupported = files.filter((file) => inferAttachmentKind(file.name || "attachment") === null);
  if (unsupported.length > 0) {
    throw new UnsupportedAttachmentKindError(unsupported.map((file) => file.name || "attachment"));
  }
}

export async function saveSessionAttachments(sessionId: string, uploads: readonly AttachmentUpload[]) {
  const files = uploads.map((upload) => upload instanceof File ? upload : upload.file);
  const context = getAttachmentContext(sessionId);
  if (!context) throw new Error("session_not_found");
  validateAttachmentFiles(files);
  // Keep a durable original even if extraction, sending, or a later AI turn fails.
  const { saveProjectDocuments } = await import("./project-documents");
  await saveProjectDocuments(sessionId, files);

  const attachmentsDir = resolveWithin(context.project_dir, ".attachments");
  await mkdir(attachmentsDir, { recursive: true });
  const records: string[] = [];
  const writtenPaths: string[] = [];

  try {
    for (const [index, file] of files.entries()) {
      const upload = uploads[index];
      const sourceRole = upload instanceof File ? "ordinary_content" : upload.role;
      const sourceRoleExplicit = upload instanceof File ? false : upload.roleExplicit ?? true;
      const base = sanitize(file.name || "attachment");
      const storedName = assertSafeName(`${ulid()}-${base}`);
      const absolutePath = resolveWithin(
        context.project_dir,
        ".attachments",
        storedName,
      );
      const buffer = Buffer.from(await file.arrayBuffer());
      const sha256 = createHash("sha256").update(buffer).digest("hex");

      await writeFile(absolutePath, buffer);
      writtenPaths.push(absolutePath);
      const manifestPath = resolveWithin(
        context.project_dir,
        ".attachments",
        assertSafeName(`${storedName}.summary.json`),
      );
      const extractedTextPath = resolveWithin(
        context.project_dir,
        ".attachments",
        assertSafeName(`${storedName}.extracted.md`),
      );
      const { extractAttachmentUpload } = await import("./attachment-extraction");
      await extractAttachmentUpload({ sourcePath: absolutePath, manifestPath, extractedTextPath, originalName: file.name || storedName });

      insertAttachmentRecord({
        sessionId,
        filePath: absolutePath,
        mimeType: file.type || "application/octet-stream",
        originalName: file.name || storedName,
        sizeBytes: buffer.byteLength,
        sha256,
        sourceRole,
        sourceRoleExplicit,
      });
      records.push(absolutePath);
    }
  } catch (error) {
    await rollbackSessionAttachments(sessionId, writtenPaths);
    throw error;
  }

  return records;
}

export async function rollbackSessionAttachments(sessionId: string, filePaths: readonly string[]): Promise<void> {
  const db = getSqlite();
  db.transaction(() => {
    for (const filePath of filePaths) db.prepare("DELETE FROM attachments WHERE session_id=? AND file_path=? AND turn_id IS NULL").run(sessionId, filePath);
  })();
  await Promise.all(filePaths.flatMap((filePath) => [
    rm(filePath, { force: true }),
    rm(attachmentSummaryPath(filePath), { force: true }),
    rm(attachmentExtractedTextPath(filePath), { force: true }),
  ]));
}

function sanitize(value: string) {
  return value.replace(/[^\w.-]+/g, "_");
}
