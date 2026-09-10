import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { createCanvas } from "../src/services/export-native-modules";
import { extractAttachmentUpload } from "../src/services/attachment-extraction";
test("Given raster images and malformed or oversized Word input When extracted Then valid images pass and unsafe files fail", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-attachment-kinds-"));
  try {
    for (const [extension, mime] of [["jpg", "image/jpeg"], ["webp", "image/webp"]] as const) {
      const input = { sourcePath: path.join(root, `source.${extension}`), manifestPath: path.join(root,"summary.json"), extractedTextPath: path.join(root,"text.md"), originalName: `source.${extension}` };
      const canvas = createCanvas(24,24);
      await writeFile(input.sourcePath, mime === "image/webp" ? canvas.toBuffer("image/webp") : canvas.toBuffer("image/jpeg"));
      await extractAttachmentUpload(input);
      expect(JSON.parse(await readFile(input.manifestPath,"utf8")).kind).toBe("image");
    }
    for (const xml of ["<!DOCTYPE test><w:document>unsafe</w:document>", "<w:document>" + "x".repeat(6*1024*1024) + "</w:document>"]) {
      const zip = new JSZip(); zip.file("word/document.xml", xml);
      const input = { sourcePath: path.join(root,"bad.docx"), manifestPath:path.join(root,"bad.json"),extractedTextPath:path.join(root,"bad.md"),originalName:"bad.docx" };
      await writeFile(input.sourcePath, await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE"}));
      await expect(extractAttachmentUpload(input)).rejects.toThrow();
      expect(await Bun.file(input.sourcePath).exists()).toBe(false);
    }
  } finally { await rm(root,{recursive:true,force:true}); }
});
