import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type { VisualSourceRole } from "@bg/shared";
import { assertSafeName } from "../security/path-boundary";
import type { ImmutableSnapshot } from "./immutable-attachment-guard";
import {
  readManagedFile,
  readOptionalManagedFile,
  StageAttachmentInputError,
  type MaterializationHooks,
  writePrivateFile,
} from "./stage-input-file-io";
export { StageAttachmentInputError } from "./stage-input-file-io";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_BYTES = 5 * 1024 * 1024;

export type StageAttachmentInput = {
  readonly attachmentId: string;
  readonly attachmentPath: string;
  readonly sourcePath: string;
  readonly extractedTextPath: string | null;
  readonly immutable: boolean;
  readonly sourceSha256: string;
  readonly sourceSize: number;
};

export type StageAttachment = {
  readonly id: string;
  readonly file_path: string;
  readonly original_name: string;
  readonly size_bytes: number;
  readonly sha256: string | null;
  readonly source_role: VisualSourceRole;
};

export function redactPrivateAttachmentPaths<T>(value: T, sources: readonly StageAttachmentInput[]): T {
  const replacements = sources.flatMap((source) => {
    const safeSource = `.attachments/${path.basename(source.attachmentPath)}`;
    const paths: readonly (readonly [string, string])[] = [
      [source.sourcePath, safeSource],
      [path.dirname(source.sourcePath), ".attachments"],
      [path.dirname(path.dirname(source.sourcePath)), "[private-operation]"],
      ...(source.extractedTextPath === null ? [] : [[source.extractedTextPath, `${safeSource}.extracted.md`] as const]),
    ];
    return paths.flatMap(([privatePath, safePath]) => privatePath.includes("\\")
      ? [[privatePath, safePath] as const, [privatePath.replaceAll("\\", "/"), safePath] as const]
      : [[privatePath, safePath] as const]);
  }).sort((left, right) => right[0].length - left[0].length);
  const redactText = (text: string): string => replacements.reduce((safe, [privatePath, safePath]) => safe.replaceAll(privatePath, safePath), text);
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") return redactText(item);
    if (Array.isArray(item)) return item.map(visit);
    if (item !== null && typeof item === "object") {
      const entries = Object.entries(item);
      const reserved = new Set(entries.filter(([key]) => redactText(key) === key).map(([key]) => key));
      const used = new Set<string>();
      let privateKey = 1;
      return Object.fromEntries(entries.map(([key, nested]) => {
        let safeKey = key;
        if (redactText(key) !== key) {
          do {
            safeKey = privateKey === 1 ? "[private-input-path]" : `[private-input-path:${privateKey}]`;
            privateKey += 1;
          } while (reserved.has(safeKey) || used.has(safeKey));
        }
        used.add(safeKey);
        return [safeKey, visit(nested)];
      }));
    }
    return item;
  };
  return visit(value) as T;
}

export async function withPrivateAttachmentInputs<T>(
  input: {
    readonly operationDir: string;
    readonly projectDir: string;
    readonly attachments: readonly StageAttachment[];
    readonly requestedPaths: readonly string[];
    readonly immutableSnapshots: readonly ImmutableSnapshot[];
    readonly hooks?: MaterializationHooks;
  },
  run: (sources: readonly StageAttachmentInput[]) => Promise<T>,
): Promise<T> {
  const privateDirectory = await mkdtemp(path.join(input.operationDir, "inputs-"));
  let callbackStarted = false;
  try {
    const sources: StageAttachmentInput[] = [];
    for (const requestedPath of input.requestedPaths) {
      const attachment = input.attachments.find((candidate) => candidate.file_path === requestedPath);
      if (attachment === undefined || attachment.sha256 === null || attachment.size_bytes > MAX_SOURCE_BYTES) throw new StageAttachmentInputError();
      const safeOriginal = attachment.original_name.replace(/[^A-Za-z0-9_.-]+/gu, "_").slice(-80) || "attachment";
      const fileName = assertSafeName(`${attachment.id}-${safeOriginal}`);
      const immutable = input.immutableSnapshots.find((snapshot) => snapshot.filePath === attachment.file_path);
      const sourceBytes = immutable?.bytes ?? await readManagedFile({
        projectDir: input.projectDir,
        filePath: attachment.file_path,
        maximumBytes: MAX_SOURCE_BYTES,
        expectedSize: attachment.size_bytes,
        expectedSha256: attachment.sha256,
        kind: "source",
        hooks: input.hooks,
      });
      const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
      if (sourceBytes.byteLength !== attachment.size_bytes || sourceSha256 !== attachment.sha256) throw new StageAttachmentInputError();
      const sourcePath = path.join(privateDirectory, fileName);
      await writePrivateFile(sourcePath, sourceBytes);
      let extractedTextPath = await materializeExtractedText({
        privateDirectory,
        projectDir: input.projectDir,
        attachmentPath: attachment.file_path,
        fileName,
        hooks: input.hooks,
      });
      if (extractedTextPath === null && /\.pdf$/i.test(fileName)) {
        // Recover legacy/missing sidecars from the verified private copy only.
        const target = `${sourcePath}.extracted.md`;
        try {
          const { extractPdfAttachment } = await import("./attachment-pdf");
          await extractPdfAttachment(sourcePath, `${sourcePath}.manifest.json`, target);
          extractedTextPath = target;
        } catch {
          // A scanned/encrypted PDF can still be inspected with the PDF reader.
          await rm(target, { force: true });
        }
      }
      sources.push({ attachmentId: attachment.id, attachmentPath: attachment.file_path, sourcePath, extractedTextPath, immutable: attachment.source_role === "immutable_reference", sourceSha256, sourceSize: sourceBytes.byteLength });
    }
    callbackStarted = true;
    return await run(sources);
  } catch (error) {
    if (callbackStarted || error instanceof StageAttachmentInputError) throw error;
    throw new StageAttachmentInputError();
  } finally {
    await rm(privateDirectory, { recursive: true, force: true });
  }
}

async function materializeExtractedText(input: {
  readonly privateDirectory: string;
  readonly projectDir: string;
  readonly attachmentPath: string;
  readonly fileName: string;
  readonly hooks?: MaterializationHooks;
}): Promise<string | null> {
  const bytes = await readOptionalManagedFile({ projectDir: input.projectDir, filePath: `${input.attachmentPath}.extracted.md`, maximumBytes: MAX_EXTRACTED_TEXT_BYTES, kind: "extracted", hooks: input.hooks });
  if (bytes === null) return null;
  const target = path.join(input.privateDirectory, `${input.fileName}.extracted.md`);
  await writePrivateFile(target, bytes);
  return target;
}
