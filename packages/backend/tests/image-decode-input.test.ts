import { expect, test } from "bun:test";
import { createCanvas } from "../src/services/export-native-modules";
import { rasterForDecoding } from "../src/services/image-decode-input";
import { imagePalette } from "../src/services/pinterest-mood";

const SVG_TEXT = Buffer.from('image/svg+xml <svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');
// Two 4x4 frames, red then blue, looping forever.
const ANIMATED_GIF = Buffer.from("R0lGODlhBAAEAIEAAP8AAAAA/wAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAABAAEAAAICQABCBxIsCCAgAAh+QQBCgABACwAAAAABAAEAIEAAP8AAAAAAAAAAAAICQABCBxIsCCAgAA7", "base64");

function redCanvas() {
  const canvas = createCanvas(4, 4);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, 4, 4);
  return canvas;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "latin1");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(Bun.hash.crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function jpegSegment(marker: number, data: Buffer): Buffer {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([header, data]);
}

function riffChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(type, 0, "latin1");
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, Buffer.alloc(data.length & 1)]);
}

function webpWithXmp(extendedWebp: Buffer): Buffer {
  expect(extendedWebp.toString("latin1", 12, 16)).toBe("VP8X");
  const tagged = Buffer.concat([extendedWebp, riffChunk("XMP ", SVG_TEXT)]);
  tagged.writeUInt8(tagged.readUInt8(20) | 0x04, 20);
  tagged.writeUInt32LE(tagged.length - 8, 4);
  return tagged;
}

function gifWithComment(gif: Buffer): Buffer {
  const screen = gif.readUInt8(10);
  const afterColourTable = 13 + (screen & 0x80 ? 3 * 2 ** ((screen & 7) + 1) : 0);
  const comment = Buffer.concat([Buffer.from([0x21, 0xfe, SVG_TEXT.length]), SVG_TEXT, Buffer.from([0])]);
  return Buffer.concat([gif.subarray(0, afterColourTable), comment, gif.subarray(afterColourTable)]);
}

test("Given rasters whose metadata embeds SVG text When their palette is read Then pixels decode as they do without the metadata", async () => {
  const canvas = redCanvas();
  const png = canvas.toBuffer("image/png");
  const jpeg = canvas.toBuffer("image/jpeg");
  const webp = canvas.toBuffer("image/webp");
  const cases = [
    { clean: png, tagged: Buffer.concat([png.subarray(0, 33), pngChunk("caBX", SVG_TEXT), pngChunk("iTXt", Buffer.concat([Buffer.from("XML:com.adobe.xmp\0\0\0\0\0", "latin1"), SVG_TEXT])), png.subarray(33)]) },
    { clean: jpeg, tagged: Buffer.concat([jpeg.subarray(0, 2), jpegSegment(0xe1, SVG_TEXT), jpegSegment(0xeb, SVG_TEXT), jpegSegment(0xfe, SVG_TEXT), jpeg.subarray(2)]) },
    { clean: webp, tagged: webpWithXmp(webp) },
    { clean: ANIMATED_GIF, tagged: gifWithComment(ANIMATED_GIF) },
  ];
  for (const { clean, tagged } of cases) {
    expect(rasterForDecoding(tagged).includes("<svg")).toBe(false);
    expect(await imagePalette(tagged)).toEqual(await imagePalette(clean));
  }
  expect(await imagePalette(ANIMATED_GIF)).toEqual(["#ff0000"]);
});

test("Given rasters without metadata or with truncated structure When prepared for decoding Then the original bytes are returned unchanged", () => {
  const png = redCanvas().toBuffer("image/png");
  const truncated = png.subarray(0, 40);
  const notAnImage = Buffer.from("plain text");
  for (const bytes of [png, truncated, notAnImage]) expect(rasterForDecoding(bytes)).toBe(bytes);
});
