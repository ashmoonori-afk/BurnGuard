import { describe, expect, test } from "bun:test";
import { writeMp4, type Mp4Sample } from "../src/services/mp4-writer";
import { parseMp4 } from "./helpers/mp4-parse";

const AVCC = Uint8Array.from([1, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0xc0, 0x1e, 1, 0, 2, 0x68, 0xce]);
const sample = (fill: number, length: number, duration: number, key = false): Mp4Sample => ({ data: new Uint8Array(length).fill(fill), duration, key });

describe("writeMp4", () => {
  test("Given three samples When written Then an independent reader finds one video track with the same samples, times and key frame", () => {
    // Given
    const samples = [sample(1, 300, 100, true), sample(2, 40, 100), sample(3, 7, 2000)];

    // When
    const mp4 = parseMp4(writeMp4({ width: 480, height: 360, timescale: 1000, avcC: AVCC, samples }));

    // Then
    expect(mp4.top).toEqual(["ftyp", "moov", "mdat"]);
    expect(mp4.majorBrand).toBe("isom");
    expect(mp4.brands).toEqual(expect.arrayContaining(["isom", "avc1"]));
    expect(mp4.movie).toEqual({ timescale: 1000, duration: 2200 });
    expect(mp4.track).toEqual({ id: 1, enabled: true, duration: 2200, width: 480, height: 360 });
    expect(mp4.media).toEqual({ timescale: 1000, duration: 2200, handler: "vide" });
    expect(mp4.entry).toEqual({ type: "avc1", width: 480, height: 360, avcC: AVCC });
    expect(mp4.durations).toEqual([100, 100, 2000]);
    expect(mp4.keySamples).toEqual([1]);
    expect(mp4.samples).toEqual(samples.map((entry) => entry.data));
  });

  test("Given runs of equal durations When written Then the time table stores each run once", () => {
    // Given
    const samples = [sample(1, 5, 100, true), sample(2, 5, 100), sample(3, 5, 100), sample(4, 5, 2000), sample(5, 5, 100, true)];

    // When
    const mp4 = parseMp4(writeMp4({ width: 16, height: 16, timescale: 1000, avcC: AVCC, samples }));

    // Then
    expect(mp4.stts).toEqual([[3, 100], [1, 2000], [1, 100]]);
    expect(mp4.keySamples).toEqual([1, 5]);
  });

  test("Given the same input twice When written Then the bytes are identical", () => {
    // Given
    const input = { width: 32, height: 32, timescale: 1000, avcC: AVCC, samples: [sample(9, 64, 100, true), sample(8, 32, 2000)] };

    // When / Then
    expect(writeMp4(input)).toEqual(writeMp4(input));
  });

  test.each([
    ["no samples", [] as Mp4Sample[], "mp4_no_samples"],
    ["a first sample that is not a key frame", [sample(1, 4, 100)], "mp4_first_sample_not_key"],
  ])("Given %s When written Then the writer refuses", (_name, samples, code) => {
    // When / Then
    expect(() => writeMp4({ width: 16, height: 16, timescale: 1000, avcC: AVCC, samples })).toThrow(code);
  });
});
