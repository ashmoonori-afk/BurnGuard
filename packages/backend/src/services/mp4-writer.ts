/**
 * A minimal MP4 (ISO BMFF) writer for one H.264 video track (doc/38-logo-construction-mp4-2026-11-09.md).
 *
 * Layout: `ftyp`, then `moov` with one track whose sample table holds every sample in one chunk, then
 * `mdat`. Samples are length-prefixed access units, as WebCodecs emits them with `avc: { format: "avc" }`,
 * and the decoder configuration record goes into `avcC` unchanged. The output is deterministic: no
 * creation times, no edit list, no fragments.
 */

export type Mp4Sample = { readonly data: Uint8Array; readonly duration: number; readonly key: boolean };

const MATRIX = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];

function u8(...values: number[]): Uint8Array { return Uint8Array.from(values); }
function u16(value: number): Uint8Array { return u8((value >>> 8) & 0xff, value & 0xff); }
function u32(value: number): Uint8Array { return u8((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff); }
function ascii(text: string): Uint8Array { return Uint8Array.from(text, (char) => char.charCodeAt(0)); }
function zeros(length: number): Uint8Array { return new Uint8Array(length); }

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.byteLength; }
  return out;
}

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(payload);
  return concat([u32(8 + body.byteLength), ascii(type), body]);
}

function fullBox(type: string, version: number, flags: number, ...payload: Uint8Array[]): Uint8Array {
  return box(type, u8(version, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff), ...payload);
}

/** Consecutive equal durations as (count, delta) runs, the `stts` encoding. */
function durationRuns(samples: readonly Mp4Sample[]): [number, number][] {
  const runs: [number, number][] = [];
  for (const sample of samples) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last[1] === sample.duration) last[0] += 1;
    else runs.push([1, sample.duration]);
  }
  return runs;
}

function sampleTable(input: { readonly width: number; readonly height: number; readonly avcC: Uint8Array; readonly samples: readonly Mp4Sample[] }, chunkOffset: number): Uint8Array {
  const { samples } = input;
  const avc1 = box("avc1",
    zeros(6), u16(1), // reserved, data_reference_index
    zeros(16), u16(input.width), u16(input.height),
    u32(0x00480000), u32(0x00480000), zeros(4), u16(1), // 72 dpi, reserved, one frame per sample
    zeros(32), u16(0x0018), u16(0xffff), // no compressor name, 24-bit colour, pre_defined -1
    box("avcC", input.avcC));
  const runs = durationRuns(samples);
  const keys = samples.flatMap((sample, index) => sample.key ? [index + 1] : []);
  return box("stbl",
    fullBox("stsd", 0, 0, u32(1), avc1),
    fullBox("stts", 0, 0, u32(runs.length), ...runs.flatMap(([count, delta]) => [u32(count), u32(delta)])),
    fullBox("stss", 0, 0, u32(keys.length), ...keys.map(u32)),
    fullBox("stsc", 0, 0, u32(1), u32(1), u32(samples.length), u32(1)),
    fullBox("stsz", 0, 0, u32(0), u32(samples.length), ...samples.map((sample) => u32(sample.data.byteLength))),
    fullBox("stco", 0, 0, u32(1), u32(chunkOffset)));
}

/** The whole file. `timescale` is in units per second; sample durations are in those units. */
export function writeMp4(input: { readonly width: number; readonly height: number; readonly timescale: number; readonly avcC: Uint8Array; readonly samples: readonly Mp4Sample[] }): Uint8Array {
  if (input.samples.length === 0) throw new RangeError("mp4_no_samples");
  if (!input.samples[0]!.key) throw new RangeError("mp4_first_sample_not_key");
  const duration = input.samples.reduce((sum, sample) => sum + sample.duration, 0);
  const ftyp = box("ftyp", ascii("isom"), u32(0x200), ascii("isom"), ascii("iso2"), ascii("avc1"), ascii("mp41"));
  const moov = (chunkOffset: number): Uint8Array => box("moov",
    fullBox("mvhd", 0, 0, zeros(8), u32(input.timescale), u32(duration), u32(0x00010000), u16(0x0100), zeros(10), ...MATRIX.map(u32), zeros(24), u32(2)),
    box("trak",
      fullBox("tkhd", 0, 3, zeros(8), u32(1), zeros(4), u32(duration), zeros(8), zeros(8), ...MATRIX.map(u32), u32(input.width * 0x10000), u32(input.height * 0x10000)),
      box("mdia",
        fullBox("mdhd", 0, 0, zeros(8), u32(input.timescale), u32(duration), u16(0x55c4), u16(0)), // language "und"
        fullBox("hdlr", 0, 0, zeros(4), ascii("vide"), zeros(12), ascii("VideoHandler\0")),
        box("minf",
          fullBox("vmhd", 0, 1, zeros(8)),
          box("dinf", fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1))),
          sampleTable(input, chunkOffset)))));
  // The chunk offset is a fixed-width field, so the moov size does not depend on its value.
  const chunkOffset = ftyp.byteLength + moov(0).byteLength + 8;
  const media = concat(input.samples.map((sample) => sample.data));
  return concat([ftyp, moov(chunkOffset), u32(8 + media.byteLength), ascii("mdat"), media]);
}
