import { open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { DesignSystemAssetEditError } from "./extraction-asset-errors";

/** Replaces `filePath` with `content` via a same-directory temp file, fsync and rename. */
export async function writeTextFileAtomically(filePath: string, content: string): Promise<void> {
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o644);
    try { await file.writeFile(content, "utf8"); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, filePath);
    if (process.platform !== "win32") {
      const directory = await open(path.dirname(filePath), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await rm(temporary, { force: true }); }
}

/** Reads a managed CSS file; a missing file is empty, any other failure is a typed error (never silently empty). */
export async function readManagedCssForEdit(filePath: string): Promise<string> {
  try { return await readFile(filePath, "utf8"); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw new DesignSystemAssetEditError("token_file_unreadable", "Design system CSS file could not be read");
  }
}
