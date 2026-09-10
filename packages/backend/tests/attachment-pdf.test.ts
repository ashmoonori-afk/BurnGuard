import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { extractAttachmentUpload } from "../src/services/attachment-extraction";

test("Given a real PDF attachment, when extracted with bundled PDF.js, then Python is unnecessary, invalid input fails, and image-only input retains an OCR note", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bg-pdf-text-"));
  const input = { sourcePath: path.join(directory, "document.pdf"), manifestPath: path.join(directory, "manifest.json"), extractedTextPath: path.join(directory, "text.md"), originalName: "document.pdf" };
  try {
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText("Actual PDF attachment text");
    for (let index = 2; index <= 9; index++) {
      const page = pdf.addPage();
      for (let line = 0; line < 20; line++) page.drawText(`Page ${index} line ${line} with meaningful planning content`, { y: 750 - line * 25, size: 10 });
      page.drawText(`END_OF_PAGE_${index}`, { y: 200, size: 10 });
    }
    await writeFile(input.sourcePath, await pdf.save());
    await extractAttachmentUpload(input);
    expect(await readFile(input.extractedTextPath, "utf8")).toContain("Actual PDF attachment text");
    expect(await readFile(input.extractedTextPath, "utf8")).toContain("END_OF_PAGE_9");
    await writeFile(input.sourcePath, "%PDF-1.7\ninvalid");
    await expect(extractAttachmentUpload(input)).rejects.toMatchObject({ code: "pdf_invalid" });
    const blank = await PDFDocument.create(); blank.addPage();
    await writeFile(input.sourcePath, await blank.save());
    await extractAttachmentUpload(input);
    expect(await readFile(input.extractedTextPath, "utf8")).toContain("자동 OCR");
    expect((await readFile(input.sourcePath)).byteLength).toBeGreaterThan(0);
    const image = await blank.embedPng(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=", "base64"));
    blank.getPages()[0]!.drawImage(image, { x: 10, y: 10, width: 100, height: 100 });
    await writeFile(input.sourcePath, await blank.save());
    await extractAttachmentUpload(input);
    expect(await readFile(input.extractedTextPath, "utf8")).toContain("시각 자료를 직접 확인");
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30_000);
