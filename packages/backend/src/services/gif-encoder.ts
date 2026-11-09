/**
 * A small GIF89a encoder for the construction draw-in export (doc/36-logo-construction-gif-2026-11-09.md).
 *
 * Every frame shares one 256-colour global table, so a frame is only its palette indices. The
 * image data is LZW-compressed with the variable code size GIF decoders expect: 8-bit minimum
 * code size, codes grow from 9 to 12 bits, and the table restarts with a clear code when full.
 * The encoder is deterministic, so the same frames always give the same bytes.
 */

export interface GifFrame {
  /** One palette index per pixel, row by row; `width * height` entries. */
  readonly indices: Uint8Array;
  /** How long the frame shows, in hundredths of a second. */
  readonly delayCs: number;
}

export interface GifInput {
  readonly width: number;
  readonly height: number;
  /** 256 RGB triples. */
  readonly palette: Uint8Array;
  readonly frames: readonly GifFrame[];
}

const MIN_CODE_SIZE = 8;
const MAX_CODE = 4096;

class ByteSink {
  private chunks: Uint8Array[] = [];
  private current = new Uint8Array(64 * 1024);
  private length = 0;

  byte(value: number): void {
    if (this.length === this.current.length) {
      this.chunks.push(this.current);
      this.current = new Uint8Array(this.current.length);
      this.length = 0;
    }
    this.current[this.length++] = value & 0xff;
  }

  bytes(values: ArrayLike<number>): void {
    for (let index = 0; index < values.length; index += 1) this.byte(values[index]);
  }

  short(value: number): void {
    this.byte(value);
    this.byte(value >> 8);
  }

  ascii(text: string): void {
    for (const character of text) this.byte(character.charCodeAt(0));
  }

  finish(): Uint8Array {
    const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0) + this.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    out.set(this.current.subarray(0, this.length), offset);
    return out;
  }
}

export function encodeGif(input: GifInput): Uint8Array {
  const { width, height, palette, frames } = input;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 0xffff || height > 0xffff) throw new RangeError("gif size");
  if (palette.length !== 256 * 3) throw new RangeError("gif palette");
  if (frames.length === 0) throw new RangeError("gif frames");
  const sink = new ByteSink();
  sink.ascii("GIF89a");
  sink.short(width);
  sink.short(height);
  // Global colour table present, 8-bit colour resolution, 256 entries.
  sink.byte(0xf7);
  sink.byte(0);
  sink.byte(0);
  sink.bytes(palette);
  // NETSCAPE2.0 application extension: loop forever.
  sink.bytes([0x21, 0xff, 0x0b]);
  sink.ascii("NETSCAPE2.0");
  sink.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);
  for (const frame of frames) {
    if (frame.indices.length !== width * height) throw new RangeError("gif frame size");
    if (!Number.isInteger(frame.delayCs) || frame.delayCs < 0 || frame.delayCs > 0xffff) throw new RangeError("gif delay");
    // Graphic control extension: leave the frame in place, no transparency.
    sink.bytes([0x21, 0xf9, 0x04, 0x04]);
    sink.short(frame.delayCs);
    sink.bytes([0x00, 0x00]);
    // Image descriptor: the whole screen, no local colour table, not interlaced.
    sink.byte(0x2c);
    sink.short(0);
    sink.short(0);
    sink.short(width);
    sink.short(height);
    sink.byte(0);
    sink.byte(MIN_CODE_SIZE);
    writeSubBlocks(sink, lzw(frame.indices));
  }
  sink.byte(0x3b);
  return sink.finish();
}

/** LZW with GIF's variable code size, packed least significant bit first. */
function lzw(indices: Uint8Array): Uint8Array {
  const clearCode = 1 << MIN_CODE_SIZE;
  const endCode = clearCode + 1;
  const out = new ByteSink();
  let codeSize = MIN_CODE_SIZE + 1;
  let nextCode = endCode + 1;
  let table = new Map<number, number>();
  let buffer = 0;
  let bits = 0;
  const emit = (code: number): void => {
    buffer |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.byte(buffer & 0xff);
      buffer >>>= 8;
      bits -= 8;
    }
  };
  emit(clearCode);
  let prefix = indices[0];
  for (let index = 1; index < indices.length; index += 1) {
    const symbol = indices[index];
    const key = (prefix << 8) | symbol;
    const known = table.get(key);
    if (known !== undefined) {
      prefix = known;
      continue;
    }
    emit(prefix);
    if (nextCode === MAX_CODE) {
      emit(clearCode);
      nextCode = endCode + 1;
      codeSize = MIN_CODE_SIZE + 1;
      table = new Map();
    } else {
      if (nextCode >= 1 << codeSize) codeSize += 1;
      table.set(key, nextCode);
      nextCode += 1;
    }
    prefix = symbol;
  }
  emit(prefix);
  emit(endCode);
  if (bits > 0) out.byte(buffer & 0xff);
  return out.finish();
}

function writeSubBlocks(sink: ByteSink, data: Uint8Array): void {
  for (let offset = 0; offset < data.length; offset += 255) {
    const block = data.subarray(offset, Math.min(offset + 255, data.length));
    sink.byte(block.length);
    sink.bytes(block);
  }
  sink.byte(0);
}
