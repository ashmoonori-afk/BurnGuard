/** Uploaded originals are private project documents, separate from authored website docs. */
export const PROJECT_DOCUMENTS_DIR = "docs/attachments";

export function isProjectDocumentPath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase();
  return normalized === PROJECT_DOCUMENTS_DIR || normalized.startsWith(`${PROJECT_DOCUMENTS_DIR}/`);
}
