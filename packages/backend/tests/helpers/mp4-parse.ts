/**
 * An MP4 reader for tests, written from ISO/IEC 14496-12 independently of `mp4-writer.ts`: it walks the
 * box tree (every size must tile its parent exactly), reads the one video track's sample table, and
 * returns each sample's bytes by following stsc and stco the general way.
 */
export type Mp4Box = { readonly type: string; readonly start: number; readonly size: number; readonly children: readonly Mp4Box[] };

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "dinf", "stbl"]);

function u16(bytes: Uint8Array, at: number): number { return (bytes[at]! << 8) | bytes[at + 1]!; }
function u32(bytes: Uint8Array, at: number): number { return ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!; }
function type(bytes: Uint8Array, at: number): string { return String.fromCharCode(...bytes.subarray(at, at + 4)); }

function readBoxes(bytes: Uint8Array, start: number, end: number): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let at = start;
  while (at < end) {
    if (end - at < 8) throw new Error(`truncated box header at ${at}`);
    const size = u32(bytes, at);
    if (size < 8 || at + size > end) throw new Error(`bad box size ${size} at ${at}`);
    const name = type(bytes, at + 4);
    boxes.push({ type: name, start: at, size, children: CONTAINERS.has(name) ? readBoxes(bytes, at + 8, at + size) : [] });
    at += size;
  }
  return boxes;
}

export type ParsedMp4 = {
  readonly top: readonly string[];
  readonly majorBrand: string;
  readonly brands: readonly string[];
  readonly movie: { readonly timescale: number; readonly duration: number };
  readonly track: { readonly id: number; readonly enabled: boolean; readonly duration: number; readonly width: number; readonly height: number };
  readonly media: { readonly timescale: number; readonly duration: number; readonly handler: string };
  readonly entry: { readonly type: string; readonly width: number; readonly height: number; readonly avcC: Uint8Array };
  readonly stts: readonly (readonly [number, number])[];
  readonly durations: readonly number[];
  readonly keySamples: readonly number[] | null;
  readonly samples: readonly Uint8Array[];
};

export function parseMp4(bytes: Uint8Array): ParsedMp4 {
  const top = readBoxes(bytes, 0, bytes.length);
  const find = (boxes: readonly Mp4Box[], ...path: string[]): Mp4Box => {
    let current: Mp4Box | undefined;
    let level = boxes;
    for (const name of path) {
      current = level.find((box) => box.type === name);
      if (current === undefined) throw new Error(`missing box ${path.join("/")}`);
      level = current.children;
    }
    return current!;
  };
  const body = (box: Mp4Box, full = true): number => box.start + 8 + (full ? 4 : 0);
  const ftyp = find(top, "ftyp");
  const brands: string[] = [];
  for (let at = ftyp.start + 16; at < ftyp.start + ftyp.size; at += 4) brands.push(type(bytes, at));
  const mvhd = find(top, "moov", "mvhd");
  const tkhd = find(top, "moov", "trak", "tkhd");
  const mdhd = find(top, "moov", "trak", "mdia", "mdhd");
  const hdlr = find(top, "moov", "trak", "mdia", "hdlr");
  const stbl = find(top, "moov", "trak", "mdia", "minf", "stbl");
  for (const box of [mvhd, tkhd, mdhd]) if (bytes[box.start + 8] !== 0) throw new Error(`${box.type} is not version 0`);
  const stsd = find(stbl.children, "stsd");
  const entryAt = body(stsd) + 4;
  const entrySize = u32(bytes, entryAt);
  const avcCAt = entryAt + 8 + 78;
  if (type(bytes, avcCAt + 4) !== "avcC") throw new Error("avc1 entry has no avcC");
  const avcCSize = u32(bytes, avcCAt);
  if (avcCAt + avcCSize > entryAt + entrySize) throw new Error("avcC overruns its sample entry");
  const table = (name: string): { readonly at: number; readonly count: number } | null => {
    const box = stbl.children.find((child) => child.type === name);
    return box === undefined ? null : { at: body(box) + 4, count: u32(bytes, body(box)) };
  };
  const sttsTable = table("stts")!;
  const stts = Array.from({ length: sttsTable.count }, (_, index) => [u32(bytes, sttsTable.at + index * 8), u32(bytes, sttsTable.at + index * 8 + 4)] as const);
  const durations = stts.flatMap(([count, delta]) => Array.from({ length: count }, () => delta));
  const stss = table("stss");
  const stsz = find(stbl.children, "stsz");
  const fixedSize = u32(bytes, body(stsz));
  const sampleCount = u32(bytes, body(stsz) + 4);
  const sizes = Array.from({ length: sampleCount }, (_, index) => fixedSize !== 0 ? fixedSize : u32(bytes, body(stsz) + 8 + index * 4));
  const stco = table("stco")!;
  const offsets = Array.from({ length: stco.count }, (_, index) => u32(bytes, stco.at + index * 4));
  const stsc = table("stsc")!;
  const runs = Array.from({ length: stsc.count }, (_, index) => ({ first: u32(bytes, stsc.at + index * 12), perChunk: u32(bytes, stsc.at + index * 12 + 4) }));
  const mdat = find(top, "mdat");
  const samples: Uint8Array[] = [];
  let sample = 0;
  for (let chunk = 1; chunk <= offsets.length; chunk += 1) {
    const run = runs.filter((entry) => entry.first <= chunk).at(-1);
    if (run === undefined) throw new Error(`chunk ${chunk} has no stsc run`);
    let at = offsets[chunk - 1]!;
    for (let index = 0; index < run.perChunk && sample < sampleCount; index += 1, sample += 1) {
      const size = sizes[sample]!;
      if (at < mdat.start + 8 || at + size > mdat.start + mdat.size) throw new Error(`sample ${sample + 1} lies outside mdat`);
      samples.push(bytes.slice(at, at + size));
      at += size;
    }
  }
  if (sample !== sampleCount || durations.length !== sampleCount) throw new Error(`sample tables disagree: ${sample} read, ${sampleCount} sized, ${durations.length} timed`);
  const tkhdEnd = tkhd.start + tkhd.size;
  return {
    top: top.map((box) => box.type),
    majorBrand: type(bytes, ftyp.start + 8),
    brands,
    movie: { timescale: u32(bytes, body(mvhd) + 8), duration: u32(bytes, body(mvhd) + 12) },
    track: { id: u32(bytes, body(tkhd) + 8), enabled: (bytes[tkhd.start + 11]! & 1) === 1, duration: u32(bytes, body(tkhd) + 16), width: u32(bytes, tkhdEnd - 8) / 0x10000, height: u32(bytes, tkhdEnd - 4) / 0x10000 },
    media: { timescale: u32(bytes, body(mdhd) + 8), duration: u32(bytes, body(mdhd) + 12), handler: type(bytes, body(hdlr) + 4) },
    entry: { type: type(bytes, entryAt + 4), width: u16(bytes, entryAt + 8 + 24), height: u16(bytes, entryAt + 8 + 26), avcC: bytes.slice(avcCAt + 8, avcCAt + avcCSize) },
    stts,
    durations,
    keySamples: stss === null ? null : Array.from({ length: stss.count }, (_, index) => u32(bytes, stss.at + index * 4)),
    samples,
  };
}
