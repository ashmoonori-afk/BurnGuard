/**
 * @napi-rs/canvas treats any buffer containing `<svg` as an SVG document, so a raster whose metadata
 * embeds SVG text (C2PA manifests, XMP packets, comments) fails with "Invalid SVG image". These helpers
 * return a copy without metadata for native decoding only: decoded pixels are unchanged and the original
 * bytes are never modified. Irregular input is returned as is so the decoder reports its own error.
 */

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** Ancillary PNG chunks that change decoded pixels or colour; every other ancillary chunk is metadata. */
const PNG_DECODE_CHUNKS = new Set(["tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "cICP", "sBIT"]);
/** WebP chunks a decoder reads; EXIF, XMP, C2PA and unknown chunks are metadata. */
const WEBP_DECODE_CHUNKS = new Set(["VP8X", "ICCP", "ANIM", "ANMF", "ALPH", "VP8 ", "VP8L"]);

export function rasterForDecoding(bytes: Buffer): Buffer {
  const stripped = withoutMetadata(bytes);
  return stripped.length === bytes.length ? bytes : stripped;
}

function withoutMetadata(bytes: Buffer): Buffer {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return pngForDecoding(bytes);
  if (bytes.length >= 2 && bytes.readUInt8(0) === 0xff && bytes.readUInt8(1) === 0xd8) return jpegForDecoding(bytes);
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return webpForDecoding(bytes);
  if (bytes.length >= 13 && /^GIF8[79]a$/.test(bytes.toString("latin1", 0, 6))) return gifForDecoding(bytes);
  return bytes;
}

function pngForDecoding(bytes: Buffer): Buffer {
  const kept = [bytes.subarray(0, 8)];
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) return bytes;
    const end = offset + 12 + bytes.readUInt32BE(offset);
    if (end > bytes.length) return bytes;
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    // Bit 5 of the first type byte marks an ancillary chunk; critical chunks are always kept.
    if ((bytes.readUInt8(offset + 4) & 0x20) === 0 || PNG_DECODE_CHUNKS.has(type)) kept.push(bytes.subarray(offset, end));
    if (type === "IEND") return Buffer.concat(kept);
    offset = end;
  }
  return bytes;
}

function jpegForDecoding(bytes: Buffer): Buffer {
  const kept = [bytes.subarray(0, 2)];
  for (let offset = 2; offset + 4 <= bytes.length;) {
    if (bytes.readUInt8(offset) !== 0xff) return bytes;
    const marker = bytes.readUInt8(offset + 1);
    if (marker === 0xff) { offset++; continue; }
    if (marker === 0xda) { kept.push(bytes.subarray(offset)); return Buffer.concat(kept); }
    const length = bytes.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) return bytes;
    // APP0 (JFIF), APP2 (ICC profile) and APP14 (Adobe colour transform) affect decoding; other APPn and COM are metadata.
    const metadata = marker === 0xfe || (marker >= 0xe1 && marker <= 0xef && marker !== 0xe2 && marker !== 0xee);
    if (!metadata) kept.push(bytes.subarray(offset, end));
    offset = end;
  }
  return bytes;
}

function webpForDecoding(bytes: Buffer): Buffer {
  const kept: Buffer[] = [];
  let extended: Buffer | null = null;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) return bytes;
    const size = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + size > bytes.length) return bytes;
    const end = Math.min(offset + 8 + size + (size & 1), bytes.length);
    const type = bytes.toString("latin1", offset, offset + 4);
    if (WEBP_DECODE_CHUNKS.has(type)) {
      const chunk = Buffer.from(bytes.subarray(offset, end));
      if (type === "VP8X") extended = chunk;
      kept.push(chunk);
    }
    offset = end;
  }
  // The dropped chunks' EXIF (0x08) and XMP (0x04) flags must not be advertised.
  if (extended !== null && extended.length > 8) extended.writeUInt8(extended.readUInt8(8) & ~0x0c, 8);
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), ...kept]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function gifForDecoding(bytes: Buffer): Buffer {
  const screen = bytes.readUInt8(10);
  let offset = 13 + (screen & 0x80 ? 3 * 2 ** ((screen & 7) + 1) : 0);
  if (offset > bytes.length) return bytes;
  const kept = [bytes.subarray(0, offset)];
  while (offset < bytes.length) {
    const introducer = bytes.readUInt8(offset);
    if (introducer === 0x3b) { kept.push(bytes.subarray(offset, offset + 1)); return Buffer.concat(kept); }
    let end: number;
    if (introducer === 0x21 && offset + 2 <= bytes.length) end = skipGifSubBlocks(bytes, offset + 2);
    else if (introducer === 0x2c && offset + 10 <= bytes.length) {
      const local = bytes.readUInt8(offset + 9);
      // Descriptor, optional local colour table, then the LZW minimum code size byte before the data sub-blocks.
      end = skipGifSubBlocks(bytes, offset + 10 + (local & 0x80 ? 3 * 2 ** ((local & 7) + 1) : 0) + 1);
    } else return bytes;
    if (end < 0) return bytes;
    // Frames and their graphic control extensions decode pixels; comment, plain-text and application extensions are metadata.
    if (introducer === 0x2c || bytes.readUInt8(offset + 1) === 0xf9) kept.push(bytes.subarray(offset, end));
    offset = end;
  }
  return bytes;
}

function skipGifSubBlocks(bytes: Buffer, offset: number): number {
  while (offset < bytes.length) {
    const size = bytes.readUInt8(offset);
    offset += 1 + size;
    if (size === 0) return offset <= bytes.length ? offset : -1;
  }
  return -1;
}
