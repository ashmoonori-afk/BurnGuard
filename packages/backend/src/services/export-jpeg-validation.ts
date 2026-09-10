/** Minimal JPEG frame-header reader used to validate exported slice dimensions (doc/14 T50). */
const MAX_PIXELS = 16_000_000;
const STANDALONE_MARKERS = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8]);

export type JpegHeader = { readonly width: number; readonly height: number };

export class JpegValidationError extends Error {
  readonly name = "JpegValidationError";
  constructor(readonly code: "invalid_jpeg" | "dimension_mismatch" | "pixel_limit") { super(code); }
}

/** Walks the marker segments up to the first Start-Of-Frame and returns its declared size. */
export function parseJpeg(bytes: Uint8Array): JpegHeader {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail("invalid_jpeg");
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) fail("invalid_jpeg");
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) { offset += 1; continue; }
    if (STANDALONE_MARKERS.has(marker)) { offset += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) fail("invalid_jpeg");
    const length = u16(bytes, offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) fail("invalid_jpeg");
    if (isStartOfFrame(marker)) {
      if (length < 8) fail("invalid_jpeg");
      const height = u16(bytes, offset + 5);
      const width = u16(bytes, offset + 7);
      if (width === 0 || height === 0) fail("invalid_jpeg");
      if (width * height > MAX_PIXELS) fail("pixel_limit");
      return { width, height };
    }
    offset += 2 + length;
  }
  return fail("invalid_jpeg");
}

export function validateJpeg(bytes: Uint8Array, expected: JpegHeader): JpegHeader {
  const header = parseJpeg(bytes);
  if (header.width !== expected.width || header.height !== expected.height) fail("dimension_mismatch");
  return header;
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function u16(bytes: Uint8Array, offset: number): number {
  if (offset + 1 >= bytes.length) fail("invalid_jpeg");
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function fail(code: JpegValidationError["code"]): never {
  throw new JpegValidationError(code);
}
