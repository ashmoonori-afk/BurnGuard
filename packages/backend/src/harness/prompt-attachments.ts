import path from "node:path";
import type { buildSessionContext } from "../services/context";
import type { StageAttachmentInput } from "../services/stage-attachment-inputs";
import {
  attachmentExtractedTextPath,
  attachmentSummaryPath,
} from "../services/attachment-paths";
import {
  readAttachmentSummaryFile,
  type AttachmentSummary,
} from "../services/attachment-summary";
import { readOptional } from "./prompt-file-reader";

type SessionContext = NonNullable<
  Awaited<ReturnType<typeof buildSessionContext>>
>;
type Attachment = SessionContext["attachments"][number];

const MAX_ATTACHMENT_PAGES = 4;

export async function appendAttachmentContext(
  lines: string[],
  attachments: readonly Attachment[],
  requestedPaths: readonly string[],
  projectDir: string,
  stageInputs?: readonly StageAttachmentInput[],
): Promise<void> {
  lines.push("## Attachments");
  const selected = attachments.filter((attachment) =>
    requestedPaths.includes(attachment.file_path),
  );
  for (const attachment of selected) {
    lines.push(`- ${attachment.original_name} (${attachment.mime_type}, ${attachment.size_bytes}B)`);
    const stageInput = stageInputs?.find((input) => input.attachmentId === attachment.id);
    const relativeSource = stageInput?.sourcePath ?? path.relative(projectDir, attachment.file_path).replaceAll("\\", "/");
    const summary = await readAttachmentSummaryFile(
      attachmentSummaryPath(attachment.file_path),
    );
    if (summary) {
      const extractedTextPath = attachmentExtractedTextPath(attachment.file_path);
      const relativeExtracted = stageInput?.extractedTextPath ?? path.relative(projectDir, extractedTextPath).replaceAll("\\", "/");
      const hasExtractedText = stageInput !== undefined
        ? stageInput.extractedTextPath !== null
        : (await readOptional(extractedTextPath)) !== null;
      lines.push(
        `  source_path: ${relativeSource} (binary attachment; do not Read/Glob/Bash this file directly)`,
      );
      if (hasExtractedText) {
        lines.push(
          `  extracted_text_path: ${relativeExtracted} (safe text version for Read)`,
        );
      }
      // Everything inside the delimiter came out of the uploaded document. It is
      // data for the model to design from, never instructions to follow.
      lines.push("  <burnguard-untrusted-document-text>");
      for (const summaryLine of renderAttachmentSummary(summary)) {
        lines.push(`  ${summaryLine}`);
      }
      lines.push("  </burnguard-untrusted-document-text>");
    } else {
      lines.push(`  path: ${relativeSource}`);
    }
  }
  lines.push("");
}

function renderAttachmentSummary(summary: AttachmentSummary): string[] {
  const lines = [
    `summary: ${summary.kind.toUpperCase()} | ${summary.page_count} page(s) | brand=${summary.brand_name ?? "unknown"}`,
  ];
  if (summary.fonts.length > 0) {
    lines.push(`fonts: ${summary.fonts.slice(0, 4).join(", ")}`);
  }
  if (summary.colors.length > 0) {
    lines.push(`colors: ${summary.colors.slice(0, 6).join(", ")}`);
  }
  if (summary.headings.length > 0) {
    lines.push(`headings: ${summary.headings.slice(0, 3).join(" | ")}`);
  }
  if (summary.bodies.length > 0) {
    lines.push(`body samples: ${summary.bodies.slice(0, 2).join(" | ")}`);
  }
  if (summary.pages.length > 0) {
    lines.push("page summaries:");
    for (const page of summary.pages.slice(0, MAX_ATTACHMENT_PAGES)) {
      lines.push(
        `- page ${page.index}: ${page.title} -> ${page.summary || page.text_excerpt}`,
      );
    }
  }
  if (summary.notes.length > 0) {
    lines.push(`notes: ${summary.notes.slice(0, 2).join(" | ")}`);
  }
  lines.push("instruction: use this compact summary first for planning.");
  lines.push(
    "instruction: if an extracted_text_path is listed and you need slide/page wording, Read that file instead of the original binary file.",
  );
  lines.push(
    "instruction: do not use Read, Glob, or Bash against the original .pptx/.pdf attachment path.",
  );
  return lines;
}
