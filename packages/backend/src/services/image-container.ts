export class ImageContainerError extends Error {
  readonly code = "invalid_image_container";
  constructor() { super("invalid_image_container"); }
}

type RiffChunk = { readonly type: string; readonly start: number; readonly size: number };

const VP8X_RESERVED_FLAGS = 0xc1;
const FLAG_ICC = 0x20;
const FLAG_ALPHA = 0x10;
const FLAG_EXIF = 0x08;
const FLAG_XMP = 0x04;
const FLAG_ANIMATION = 0x02;
const ANMF_RESERVED_FLAGS = 0xfc;

/**
 * Structural check of a WebP container (RFC 9649, section 2) before any native decoder sees it:
 * layouts outside the container grammar are refused up front instead of being handed to native
 * code. Non-WebP input is left to the format's own decoder.
 */
export function assertDecodableImageContainer(bytes: Uint8Array): void {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.length < 12 || view.toString("latin1", 0, 4) !== "RIFF" || view.toString("latin1", 8, 12) !== "WEBP") return;
  if (view.readUInt32LE(4) + 8 !== view.length) throw new ImageContainerError();
  const chunks = riffChunks(view, 12, view.length);
  const [first, ...rest] = chunks;
  if (first === undefined) throw new ImageContainerError();
  if (first.type === "VP8 " || first.type === "VP8L") {
    if (rest.length !== 0) throw new ImageContainerError();
    return;
  }
  if (first.type !== "VP8X" || first.size !== 10) throw new ImageContainerError();
  const flags = view.readUInt8(first.start + 8);
  if ((flags & VP8X_RESERVED_FLAGS) !== 0 || view.readUIntLE(first.start + 9, 3) !== 0) throw new ImageContainerError();
  const canvasWidth = 1 + view.readUIntLE(first.start + 12, 3);
  const canvasHeight = 1 + view.readUIntLE(first.start + 15, 3);
  if (canvasWidth * canvasHeight > 0xffffffff) throw new ImageContainerError();

  let index = 0;
  const next = (type: string): RiffChunk | undefined => rest[index]?.type === type ? rest[index++] : undefined;
  if (Boolean(next("ICCP")) !== Boolean(flags & FLAG_ICC)) throw new ImageContainerError();
  if (flags & FLAG_ANIMATION) {
    const animation = next("ANIM");
    if (animation === undefined || animation.size !== 6) throw new ImageContainerError();
    let frames = 0;
    let carriesAlpha = false;
    for (let frame = next("ANMF"); frame !== undefined; frame = next("ANMF")) {
      carriesAlpha = assertAnimationFrame(view, frame, canvasWidth, canvasHeight, flags) || carriesAlpha;
      frames++;
    }
    // An animation flagged with alpha needs at least one frame that can carry it.
    if (frames === 0 || (flags & FLAG_ALPHA && !carriesAlpha)) throw new ImageContainerError();
  } else {
    const alpha = next("ALPH");
    const bitstream = next("VP8 ") ?? next("VP8L");
    if (bitstream === undefined) throw new ImageContainerError();
    if (bitstream.type === "VP8 " && flags & FLAG_ALPHA && alpha === undefined) throw new ImageContainerError();
    assertAlphaPairing(view, alpha, bitstream, flags, canvasWidth * canvasHeight);
  }
  // After the image data: EXIF and XMP at most once each, in either order, among unknown chunks.
  const tail = rest.slice(index);
  const metadata = (type: string): number => tail.filter((chunk) => chunk.type === type).length;
  if (tail.some((chunk) => KNOWN_CHUNKS.has(chunk.type) && chunk.type !== "EXIF" && chunk.type !== "XMP ")) throw new ImageContainerError();
  if (metadata("EXIF") !== (flags & FLAG_EXIF ? 1 : 0) || metadata("XMP ") !== (flags & FLAG_XMP ? 1 : 0)) throw new ImageContainerError();
}

const KNOWN_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF", "ICCP", "EXIF", "XMP "]);

/**
 * ALPH belongs only in front of a lossy VP8 bitstream of an image flagged with alpha, and must hold a
 * valid header byte (reserved bits zero, known pre-processing and compression) plus data; raw
 * (uncompressed) alpha holds exactly one byte per pixel of the image it describes.
 */
function assertAlphaPairing(view: Buffer, alpha: RiffChunk | undefined, bitstream: RiffChunk, flags: number, pixels: number): void {
  if (alpha === undefined) return;
  if (bitstream.type !== "VP8 " || !(flags & FLAG_ALPHA) || alpha.size < 2) throw new ImageContainerError();
  const header = view.readUInt8(alpha.start + 8);
  const compression = header & 0x03;
  if ((header & 0xc0) !== 0 || ((header >> 4) & 0x03) > 1 || compression > 1) throw new ImageContainerError();
  if (compression === 0 && alpha.size - 1 !== pixels) throw new ImageContainerError();
}

/** Validates one ANMF frame and reports whether it can carry alpha (an ALPH chunk or a lossless bitstream). */
function assertAnimationFrame(view: Buffer, frame: RiffChunk, canvasWidth: number, canvasHeight: number, flags: number): boolean {
  if (frame.size < 16) throw new ImageContainerError();
  const header = frame.start + 8;
  const x = 2 * view.readUIntLE(header, 3);
  const y = 2 * view.readUIntLE(header + 3, 3);
  const width = 1 + view.readUIntLE(header + 6, 3);
  const height = 1 + view.readUIntLE(header + 9, 3);
  if ((view.readUInt8(header + 15) & ANMF_RESERVED_FLAGS) !== 0 || x + width > canvasWidth || y + height > canvasHeight) throw new ImageContainerError();
  const data = riffChunks(view, header + 16, header + frame.size);
  const alpha = data[0]?.type === "ALPH" ? data[0] : undefined;
  const [bitstream, ...extra] = alpha === undefined ? data : data.slice(1);
  if (bitstream === undefined || (bitstream.type !== "VP8 " && bitstream.type !== "VP8L")) throw new ImageContainerError();
  // Unknown chunks may follow a frame's bitstream; known ones may not.
  if (extra.some((chunk) => KNOWN_CHUNKS.has(chunk.type))) throw new ImageContainerError();
  assertAlphaPairing(view, alpha, bitstream, flags, width * height);
  return alpha !== undefined || bitstream.type === "VP8L";
}

/** Every chunk header and zero-padded payload must lie inside [start, end) and tile it exactly. */
function riffChunks(view: Buffer, start: number, end: number): RiffChunk[] {
  const chunks: RiffChunk[] = [];
  let offset = start;
  while (offset < end) {
    if (offset + 8 > end) throw new ImageContainerError();
    const size = view.readUInt32LE(offset + 4);
    const payloadEnd = offset + 8 + size;
    const next = payloadEnd + (size & 1);
    if (next > end || (size & 1 && view.readUInt8(payloadEnd) !== 0)) throw new ImageContainerError();
    chunks.push({ type: view.toString("latin1", offset, offset + 4), start: offset, size });
    offset = next;
  }
  return chunks;
}
