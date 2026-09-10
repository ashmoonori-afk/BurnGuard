import { rm, writeFile } from "node:fs/promises";
import { AttachmentPdfError, extractPdfAttachment } from "./attachment-pdf";
import type { UploadManifest } from "./extraction-upload";

export type AttachmentExtractionInput = {
  readonly sourcePath: string;
  readonly manifestPath: string;
  readonly extractedTextPath: string;
  readonly originalName: string;
};

export async function extractAttachmentUpload(input: AttachmentExtractionInput): Promise<void> {
  try {
    const isPdf = input.sourcePath.toLowerCase().endsWith(".pdf");
    if (isPdf) await extractPdfAttachment(input.sourcePath, input.manifestPath, input.extractedTextPath);
    else {
      const { runPythonUploadExtractor } = await import("./design-system-extract");
      await runPythonUploadExtractor({ sourcePath: input.sourcePath, manifestPath: input.manifestPath });
    }
    const { readUploadManifest } = await import("./extraction-upload");
    const manifest = await readUploadManifest(input.manifestPath);
    if (!isPdf) await writeFile(input.extractedTextPath, renderAttachmentExtract(manifest, input.originalName), "utf8");
  } catch (error) {
    await Promise.all([
      rm(input.sourcePath, { force: true }),
      rm(input.manifestPath, { force: true }),
      rm(input.extractedTextPath, { force: true }),
    ]);
    const message = error instanceof Error ? error.message : String(error);
    throw new AttachmentExtractionError(input.originalName, message, error instanceof AttachmentPdfError ? error.code : "attachment_extract_failed");
  }
}

export class AttachmentExtractionError extends Error {
  readonly name = "AttachmentExtractionError";
  constructor(readonly originalName: string, reason: string, readonly code = "attachment_extract_failed") {
    super(`attachment_extract_failed:${originalName}:${reason}`);
  }
}

function renderAttachmentExtract(manifest: UploadManifest, originalName: string): string {
  const lines = [
    "# Extracted attachment text", "", `- source: ${originalName}`, `- kind: ${manifest.kind.toUpperCase()}`,
    `- page_count: ${manifest.page_count}`, `- brand_name: ${manifest.brand_name ?? "unknown"}`,
  ];
  if (manifest.notes.length > 0) lines.push(`- notes: ${manifest.notes.slice(0, 3).join(" | ")}`);
  for (const page of manifest.pages) {
    lines.push("", `## Page ${page.index}: ${page.title || `${manifest.kind.toUpperCase()} page ${page.index}`}`);
    if (page.summary) lines.push("", `Summary: ${page.summary}`);
    if (page.text_excerpt) lines.push("", "```text", page.text_excerpt, "```");
  }
  if (manifest.pages.length === 0) lines.push("", "_No structured page text was extracted from this attachment._");
  return lines.join("\n");
}
