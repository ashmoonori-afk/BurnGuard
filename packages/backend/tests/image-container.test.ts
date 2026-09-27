import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractAttachmentUpload } from "../src/services/attachment-extraction";
import { createCanvas } from "../src/services/export-native-modules";
import { assertDecodableImageContainer } from "../src/services/image-container";
import { isolatedImagePalette } from "../src/services/image-palette-process";
import { imagePalette } from "../src/services/pinterest-mood";

function redWebp(): Buffer {
  const canvas = createCanvas(4, 4);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, 4, 4);
  return canvas.toBuffer("image/webp");
}

function withRiffSize(bytes: Buffer): Buffer {
  bytes.writeUInt32LE(bytes.length - 8, 4);
  return bytes;
}

function malformedContainers(webp: Buffer): Buffer[] {
  const headerSize = webp.readUInt32LE(16);
  const headerEnd = 12 + 8 + headerSize + (headerSize & 1);
  const repeatedHeader = withRiffSize(Buffer.concat([webp.subarray(0, headerEnd), webp.subarray(12, headerEnd), webp.subarray(headerEnd)]));
  const overrunningChunk = withRiffSize(Buffer.from(webp.subarray(0, webp.length - 2)));
  const wrongRiffSize = Buffer.from(webp);
  wrongRiffSize.writeUInt32LE(webp.length, 4);
  return [repeatedHeader, overrunningChunk, wrongRiffSize];
}

test("Given a well-formed WebP When its palette is sampled in the isolated decoder Then the pixels decode", async () => {
  const webp = redWebp();
  expect(webp.toString("latin1", 12, 16)).toBe("VP8X");
  expect(() => assertDecodableImageContainer(webp)).not.toThrow();
  expect(await isolatedImagePalette(webp)).toEqual(["#ff0000"]);
});

test("Given malformed WebP containers When decoded or attached Then they are refused before native decoding", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-image-container-"));
  try {
    for (const [index, bytes] of malformedContainers(redWebp()).entries()) {
      expect(() => assertDecodableImageContainer(bytes)).toThrow("invalid_image_container");
      await expect(imagePalette(bytes)).rejects.toMatchObject({ code: "invalid_image_container" });
      await expect(isolatedImagePalette(bytes)).rejects.toMatchObject({ code: "invalid_image_container" });
      const input = { sourcePath: path.join(root, `crafted-${index}.webp`), manifestPath: path.join(root, `crafted-${index}.json`), extractedTextPath: path.join(root, `crafted-${index}.md`), originalName: `crafted-${index}.webp` };
      await writeFile(input.sourcePath, bytes);
      await expect(extractAttachmentUpload(input)).rejects.toMatchObject({ code: "attachment_extract_failed" });
      expect(await Bun.file(input.sourcePath).exists()).toBe(false);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given a decoder child that crashes or answers garbage When a palette is requested Then a typed error is returned and this process keeps working", async () => {
  const webp = redWebp();
  for (const script of ["process.kill(process.pid, 'SIGSEGV')", "process.stdout.write('not json')"]) {
    await expect(isolatedImagePalette(webp, { command: [process.execPath, "-e", script] })).rejects.toMatchObject({ code: "image_decode_failed" });
  }
  expect(await isolatedImagePalette(webp)).toEqual(["#ff0000"]);
});
