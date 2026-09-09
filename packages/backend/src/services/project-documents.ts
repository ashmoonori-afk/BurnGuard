import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { getAttachmentContext } from "../db/attachment-context";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import { ATTACHMENT_LIMITS, validateAttachmentFiles } from "./attachments";
import { indexProjectFiles } from "./managed-project-files";
import { PROJECT_DOCUMENTS_DIR } from "./project-document-paths";
import { writePrivateFile } from "./stage-input-file-io";

export class ProjectDocumentError extends Error {
  readonly code = "project_document_invalid";
  constructor() { super("Project document could not be verified"); }
}

async function documentDirectory(projectDir: string): Promise<string> {
  let current = resolveWithin(projectDir);
  for (const part of PROJECT_DOCUMENTS_DIR.split("/")) {
    current = path.join(current, part);
    await mkdir(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new ProjectDocumentError();
  }
  return current;
}

/** Save before AI processing. Content identity makes retries safe without replacing another upload. */
export async function saveProjectDocuments(sessionId: string, files: readonly File[]): Promise<string[]> {
  const context = getAttachmentContext(sessionId);
  if (!context) throw new Error("session_not_found");
  validateAttachmentFiles(files);
  if (files.length === 0) return [];
  const directory = await documentDirectory(context.project_dir);
  const paths: string[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== file.size) throw new ProjectDocumentError();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const original = file.name.normalize("NFC").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[ .]+$/, "") || "attachment";
    const extension = path.extname(original).slice(0, 10);
    const label = Array.from(original.slice(0, original.length - extension.length)).slice(0, 60).join("") + extension;
    const name = assertSafeName(`${sha256}-${label}`);
    const relativePath = `${PROJECT_DOCUMENTS_DIR}/${name}`;
    const target = path.join(directory, name);
    const present = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (present) {
      await readProjectDocument(context.project_dir, relativePath);
    } else {
      const temporary = path.join(directory, `.${crypto.randomUUID()}.tmp`);
      try {
        await writePrivateFile(temporary, bytes);
        await rename(temporary, target).catch(async (error: unknown) => {
          // A concurrent identical upload may have published the same readonly file.
          await readProjectDocument(context.project_dir, relativePath).catch(() => { throw error; });
        });
      } finally { await rm(temporary, { force: true }); }
    }
    paths.push(relativePath);
  }
  await indexProjectFiles(context.project_id);
  return paths;
}

/** Only hash-named, bounded regular files are downloadable; private processing sidecars stay hidden. */
export async function readProjectDocument(projectDir: string, relativePath: string) {
  const parts = relativePath.split("/");
  if (parts.length !== 3 || parts.slice(0, 2).join("/") !== PROJECT_DOCUMENTS_DIR) throw new ProjectDocumentError();
  const name = assertSafeName(parts[2]!);
  const digest = /^([a-f0-9]{64})-(.+)$/.exec(name);
  if (!digest) throw new ProjectDocumentError();
  const root = resolveWithin(projectDir);
  for (const relative of ["docs", PROJECT_DOCUMENTS_DIR, relativePath]) {
    if ((await lstat(path.join(root, relative))).isSymbolicLink()) throw new ProjectDocumentError();
  }
  const file = await open(resolveWithin(root, relativePath), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > ATTACHMENT_LIMITS.maxBytesPerFile) throw new ProjectDocumentError();
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await file.stat();
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || offset !== before.size || createHash("sha256").update(bytes).digest("hex") !== digest[1]) throw new ProjectDocumentError();
    return { bytes, sha256: digest[1], filename: digest[2]! };
  } finally { await file.close(); }
}
