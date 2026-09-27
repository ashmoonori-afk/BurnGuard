export class ImageContainerError extends Error {
  readonly code = "invalid_image_container";
  constructor() { super("invalid_image_container"); }
}

type RiffChunk = { readonly type: string; readonly start: number; readonly size: number };

/**
 * Structural check of a WebP container before any native decoder sees it: layouts outside the
 * container grammar are refused up front instead of being handed to native code. Non-WebP input is
 * left to the format's own decoder.
 */
export function assertDecodableImageContainer(bytes: Uint8Array): void {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.length < 12 || view.toString("latin1", 0, 4) !== "RIFF" || view.toString("latin1", 8, 12) !== "WEBP") return;
  if (view.readUInt32LE(4) + 8 !== view.length) throw new ImageContainerError();
  const chunks = riffChunks(view, 12, view.length);
  const first = chunks[0];
  if (first === undefined) throw new ImageContainerError();
  if (first.type === "VP8 " || first.type === "VP8L") {
    if (chunks.length !== 1) throw new ImageContainerError();
    return;
  }
  if (first.type !== "VP8X" || first.size !== 10) throw new ImageContainerError();
  const rest = chunks.slice(1);
  const count = (type: string): number => rest.filter((chunk) => chunk.type === type).length;
  if (count("VP8X") !== 0 || count("ICCP") > 1 || count("EXIF") > 1 || count("XMP ") > 1) throw new ImageContainerError();
  const animated = (view.readUInt8(first.start + 8) & 0x02) !== 0;
  if (animated) {
    if (count("ANIM") !== 1 || count("ANMF") < 1 || count("VP8 ") + count("VP8L") + count("ALPH") !== 0) throw new ImageContainerError();
    for (const frame of rest.filter((chunk) => chunk.type === "ANMF")) {
      if (frame.size < 16) throw new ImageContainerError();
      assertSingleBitstream(riffChunks(view, frame.start + 8 + 16, frame.start + 8 + frame.size));
    }
    return;
  }
  if (count("ANIM") + count("ANMF") !== 0) throw new ImageContainerError();
  assertSingleBitstream(rest);
}

function assertSingleBitstream(chunks: readonly RiffChunk[]): void {
  const bitstreams = chunks.filter((chunk) => chunk.type === "VP8 " || chunk.type === "VP8L");
  const alpha = chunks.filter((chunk) => chunk.type === "ALPH");
  const [bitstream] = bitstreams;
  if (bitstream === undefined || bitstreams.length !== 1 || alpha.length > 1) throw new ImageContainerError();
  const [alphaChunk] = alpha;
  if (alphaChunk !== undefined && (bitstream.type !== "VP8 " || alphaChunk.start > bitstream.start)) throw new ImageContainerError();
}

/** Every chunk header and padded payload must lie inside [start, end) and tile it exactly. */
function riffChunks(view: Buffer, start: number, end: number): RiffChunk[] {
  const chunks: RiffChunk[] = [];
  let offset = start;
  while (offset < end) {
    if (offset + 8 > end) throw new ImageContainerError();
    const size = view.readUInt32LE(offset + 4);
    const next = offset + 8 + size + (size & 1);
    if (next > end) throw new ImageContainerError();
    chunks.push({ type: view.toString("latin1", offset, offset + 4), start: offset, size });
    offset = next;
  }
  return chunks;
}
