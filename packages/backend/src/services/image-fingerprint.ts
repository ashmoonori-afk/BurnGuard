import { createCanvas, loadImage } from "./export-native-modules";
import { assertDecodableImageContainer } from "./image-container";
import { rasterForDecoding } from "./image-decode-input";
import { assertSafeSvgSketch, isSvgSketch } from "./image-fingerprint-process";

const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;
const MAX_PIXELS = 20_000_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function rasterDimensions(bytes: Buffer): { readonly width: number; readonly height: number } {
  let width = 0;
  let height = 0;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE) && bytes.toString("latin1", 12, 16) === "IHDR") {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (bytes.length >= 30 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
    const kind = bytes.toString("latin1", 12, 16);
    if (kind === "VP8X") { width = 1 + bytes.readUIntLE(24, 3); height = 1 + bytes.readUIntLE(27, 3); }
    else if (kind === "VP8 " && bytes.subarray(23, 26).equals(Buffer.from([157, 1, 42]))) { width = bytes.readUInt16LE(26) & 16383; height = bytes.readUInt16LE(28) & 16383; }
    else if (kind === "VP8L" && bytes[20] === 47) { const bits = bytes.readUInt32LE(21); width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1; }
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1]!;
      if (marker === 255) { offset++; continue; }
      if (marker === 0xda || marker === 0xd9) break;
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ((marker === 0xc0 || marker === 0xc2) && length >= 8) { height = bytes.readUInt16BE(offset + 5); width = bytes.readUInt16BE(offset + 7); break; }
      offset += 2 + length;
    }
  }
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) throw new Error("unsupported_image_dimensions");
  return { width, height };
}

function luma(red: number, green: number, blue: number): number {
  return (red * 299 + green * 587 + blue * 114) / 1000;
}

/**
 * 9x8 grayscale horizontal dHash as 16 lowercase hex characters (64 bits, MSB first). The mark is
 * composited on white so transparent inputs hash deterministically; each bit is set when a sample
 * pixel is brighter than the next one to its right.
 */
export async function imageFingerprint(bytes: Buffer): Promise<string> {
  assertDecodableImageContainer(bytes);
  const svg = isSvgSketch(bytes);
  if (svg) {
    assertSafeSvgSketch(bytes);
  } else {
    rasterDimensions(bytes);
  }
  const image = await loadImage(svg ? bytes : rasterForDecoding(bytes));
  if (image.width * image.height > MAX_PIXELS) throw new Error("unsupported_image_dimensions");
  const canvas = createCanvas(HASH_WIDTH, HASH_HEIGHT);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, HASH_WIDTH, HASH_HEIGHT);
  context.drawImage(image, 0, 0, HASH_WIDTH, HASH_HEIGHT);
  const data = context.getImageData(0, 0, HASH_WIDTH, HASH_HEIGHT).data;
  const gray = new Array<number>(HASH_WIDTH * HASH_HEIGHT);
  for (let index = 0; index < gray.length; index++) {
    gray[index] = luma(data[index * 4]!, data[index * 4 + 1]!, data[index * 4 + 2]!);
  }
  let hash = 0n;
  for (let row = 0; row < HASH_HEIGHT; row++) {
    for (let column = 0; column < HASH_WIDTH - 1; column++) {
      hash = (hash << 1n) | (gray[row * HASH_WIDTH + column]! > gray[row * HASH_WIDTH + column + 1]! ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(16, "0");
}
