import { readManagedFile } from "./artifact-tree-storage";
import { inspectCanonicalTree } from "./canonical-tree-manifest";

export async function findHtmlEncodingIssues(root: string, signal?: AbortSignal) {
  const manifest = await inspectCanonicalTree(root);
  const issues: { path: string; code: "invalid_utf8" | "invalid_html_control" }[] = [];
  for (const file of manifest.files) {
    signal?.throwIfAborted();
    if (!/\.html?$/i.test(file.path)) continue;
    const bytes = await readManagedFile(root, file);
    let html: string;
    try { html = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { issues.push({ path: file.path, code: "invalid_utf8" }); continue; }
    // Raw C1 controls are invalid HTML input and survive an ANSI read followed by a UTF-8 write.
    // Do not guess from Korean/CJK wording or attempt a lossy reverse transcode.
    if (/[\u0080-\u009f]/u.test(html)) issues.push({ path: file.path, code: "invalid_html_control" });
  }
  return issues;
}
