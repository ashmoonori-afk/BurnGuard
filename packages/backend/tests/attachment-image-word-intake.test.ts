import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { createCanvas } from "../src/services/export-native-modules";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { listSessionAttachments } from "../src/db/attachments";
import { saveSessionAttachments } from "../src/services/attachments";
import { canonicalizeAttachmentRequest } from "../src/services/attachment-request";
import { withPrivateAttachmentInputs } from "../src/services/stage-attachment-inputs";
import { appendAttachmentContext } from "../src/harness/prompt-attachments";

test("Given a Word and image upload, when saved and canonicalized, then private AI input contains its original and extracted text without calling AI", async () => {
  await runMigrations();
  const root = await mkdtemp(path.join(tmpdir(), "bg-word-image-intake-"));
  const projectId = `word-image-intake-${crypto.randomUUID()}`;
  const sessionId = `${projectId}-session`;
  const operation = path.join(root, "operation");
  const db = getSqlite();
  try {
    await mkdir(operation);
    db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, root);
    db.prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
    const zip = new JSZip();
    zip.file("word/document.xml", '<w:document xmlns:w="word"><w:body><w:p><w:r><w:t>Real Word body</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table content</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');
    const bytes = await zip.generateAsync({type:"uint8array"});
    const saved = await saveSessionAttachments(sessionId, [new File([bytes], "사용자 자료.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })]);
    const canonical = await canonicalizeAttachmentRequest({ sessionId, requestedPaths: saved });
    expect(canonical.paths).toEqual(saved);
    expect(canonical.selections[0]?.role).toBe("ordinary_content");
    const rows = await listSessionAttachments(sessionId);
    expect(rows).toHaveLength(1);
    await withPrivateAttachmentInputs({ operationDir: operation, projectDir: root, attachments: rows, requestedPaths: canonical.paths, immutableSnapshots: [] }, async (sources) => {
      expect(sources).toHaveLength(1);
      expect(await readFile(sources[0]!.sourcePath)).toEqual(Buffer.from(bytes));
      expect(sources[0]!.extractedTextPath).not.toBeNull();
      expect(await readFile(sources[0]!.extractedTextPath!, "utf8")).toContain("Real Word body");
      expect(await readFile(sources[0]!.extractedTextPath!, "utf8")).toContain("Table content");
      const lines: string[] = [];
      await appendAttachmentContext(lines, rows, canonical.paths, root, sources);
      expect(lines.join("\n")).toContain(`extracted_text_path: ${sources[0]!.extractedTextPath}`);
      expect(lines.join("\n")).toContain("Real Word body");
      // Previously shipped PDF manifests omitted these arrays. The derivative
      // must remain available even when that legacy summary cannot be parsed.
      await writeFile(`${saved[0]}.summary.json`, JSON.stringify({ kind: "pdf", page_count: 1, pages: [], notes: [] }));
      const legacyLines: string[] = [];
      await appendAttachmentContext(legacyLines, rows, canonical.paths, root, sources);
      expect(legacyLines.join("\n")).toContain(`extracted_text_path: ${sources[0]!.extractedTextPath}`);
    });
    const png = createCanvas(24, 24).toBuffer("image/png");
    const imagePaths = await saveSessionAttachments(sessionId, [new File([png], "photo.png", { type: "image/png" })]);
    const imageRows = await listSessionAttachments(sessionId);
    const imageLines: string[] = [];
    await appendAttachmentContext(imageLines, imageRows, imagePaths, root);
    expect(imageLines.join("\n")).toContain("image_path:");
    expect(imageLines.join("\n")).not.toContain("binary attachment; do not");
    expect((await readdir(path.join(root, "docs/attachments"))).length).toBe(2);
    expect(await readdir(operation)).toEqual([]);
    expect(db.query<{ status: string }, [string]>("SELECT status FROM sessions WHERE id=?").get(sessionId)?.status).toBe("idle");
  } finally {
    db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
