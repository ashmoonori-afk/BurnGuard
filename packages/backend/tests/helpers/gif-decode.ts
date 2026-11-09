/**
 * A test-only GIF89a reader: the global table, each frame's delay and its decoded palette indices.
 * It is written from the format, independently of the encoder, so a round trip proves the encoder
 * speaks GIF rather than agreeing with itself.
 */
export interface DecodedGif {
  readonly width: number;
  readonly height: number;
  readonly palette: Uint8Array;
  readonly loops: boolean;
  readonly frames: readonly { readonly delayCs: number; readonly indices: Uint8Array }[];
}

export function decodeGif(bytes: Uint8Array): DecodedGif {
  let at = 0;
  const u8 = (): number => {
    if (at >= bytes.length) throw new RangeError("gif truncated");
    return bytes[at++];
  };
  const u16 = (): number => u8() | (u8() << 8);
  const text = (length: number): string => String.fromCharCode(...bytes.subarray(at, (at += length)));
  const blocks = (): Uint8Array => {
    const parts: number[] = [];
    for (let size = u8(); size !== 0; size = u8()) for (let i = 0; i < size; i += 1) parts.push(u8());
    return Uint8Array.from(parts);
  };
  if (text(6) !== "GIF89a") throw new TypeError("gif header");
  const width = u16();
  const height = u16();
  const packed = u8();
  u8();
  u8();
  if ((packed & 0x80) === 0) throw new TypeError("gif needs a global table");
  const palette = bytes.slice(at, (at += 3 * (1 << ((packed & 7) + 1))));
  let loops = false;
  let delayCs = 0;
  const frames: { delayCs: number; indices: Uint8Array }[] = [];
  for (;;) {
    const introducer = u8();
    if (introducer === 0x3b) break;
    if (introducer === 0x21) {
      const label = u8();
      const data = blocks();
      if (label === 0xf9) delayCs = data[1] | (data[2] << 8);
      if (label === 0xff && String.fromCharCode(...data.subarray(0, 11)) === "NETSCAPE2.0") loops = true;
      continue;
    }
    if (introducer !== 0x2c) throw new TypeError(`gif block ${introducer}`);
    const left = u16();
    const top = u16();
    const w = u16();
    const h = u16();
    if (left !== 0 || top !== 0 || w !== width || h !== height || u8() !== 0) throw new TypeError("gif frame layout");
    const minCodeSize = u8();
    frames.push({ delayCs, indices: lzwDecode(minCodeSize, blocks(), w * h) });
  }
  return { width, height, palette, loops, frames };
}

function lzwDecode(minCodeSize: number, data: Uint8Array, count: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const out = new Uint8Array(count);
  let written = 0;
  let codeSize = minCodeSize + 1;
  let table: number[][] = [];
  const reset = (): void => {
    table = Array.from({ length: end + 1 }, (_, i) => (i < clear ? [i] : []));
    codeSize = minCodeSize + 1;
  };
  reset();
  let previous: number[] | null = null;
  let bitPos = 0;
  const totalBits = data.length * 8;
  while (bitPos + codeSize <= totalBits) {
    let code = 0;
    for (let i = 0; i < codeSize; i += 1, bitPos += 1) code |= ((data[bitPos >> 3] >> (bitPos & 7)) & 1) << i;
    if (code === clear) {
      reset();
      previous = null;
      continue;
    }
    if (code === end) break;
    let entry: number[];
    if (code < table.length) entry = table[code];
    else if (code === table.length && previous !== null) entry = [...previous, previous[0]];
    else throw new TypeError("gif lzw code out of range");
    for (const value of entry) {
      if (written >= count) throw new RangeError("gif frame overflows");
      out[written++] = value;
    }
    if (previous !== null && table.length < 4096) {
      table.push([...previous, entry[0]]);
      if (table.length === 1 << codeSize && codeSize < 12) codeSize += 1;
    }
    previous = entry;
  }
  if (written !== count) throw new RangeError(`gif frame has ${written} of ${count} pixels`);
  return out;
}
