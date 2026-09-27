import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { createCanvas } from "../src/services/export-native-modules";
import { extractAttachmentUpload } from "../src/services/attachment-extraction";
import { inferAttachmentKind } from "../src/services/upload-kind";

// Two 4x4 frames, red then blue, looping forever.
const ANIMATED_GIF = Buffer.from("R0lGODlhBAAEAIEAAP8AAAAA/wAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAABAAEAAAICQABCBxIsCCAgAAh+QQBCgABACwAAAAABAAEAIEAAP8AAAAAAAAAAAAICQABCBxIsCCAgAA7", "base64");

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "latin1");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(Bun.hash.crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

test("Given an animated GIF and a PNG whose C2PA manifest embeds SVG When extracted Then both are read as images with their pixel colours", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-attachment-gif-c2pa-"));
  try {
    const canvas = createCanvas(4, 4);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 4, 4);
    const png = canvas.toBuffer("image/png");
    const manifest = pngChunk("caBX", Buffer.from('jumb c2pa.thumbnail.claim image/svg+xml <svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'));
    const credentialed = Buffer.concat([png.subarray(0, 33), manifest, png.subarray(33)]);
    expect(inferAttachmentKind("animated.GIF")).toBe("image");
    for (const [name, bytes] of [["animated.gif", ANIMATED_GIF], ["credentialed.png", credentialed]] as const) {
      const input = { sourcePath: path.join(root, name), manifestPath: path.join(root, `${name}.json`), extractedTextPath: path.join(root, `${name}.md`), originalName: name };
      await writeFile(input.sourcePath, bytes);
      await extractAttachmentUpload(input);
      const summary = JSON.parse(await readFile(input.manifestPath, "utf8"));
      expect(summary.kind).toBe("image");
      expect(summary.colors).toEqual(["#ff0000"]);
      expect(await readFile(input.sourcePath)).toEqual(bytes);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
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
