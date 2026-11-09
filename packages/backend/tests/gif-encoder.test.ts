import { describe, expect, test } from "bun:test";
import { encodeGif, type GifInput } from "../src/services/gif-encoder";
import { createCanvas, loadImage } from "../src/services/export-native-modules";
import { decodeGif } from "./helpers/gif-decode";

function rampPalette(): Uint8Array {
  const palette = new Uint8Array(256 * 3);
  for (let index = 0; index < 256; index += 1) palette.set([index, 255 - index, (index * 7) & 255], index * 3);
  return palette;
}

/** A fixed-seed generator whose high bits are close to uniform, so the LZW table really fills up. */
function noise(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed;
  for (let index = 0; index < length; index += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    out[index] = (state >> 16) & 255;
  }
  return out;
}

describe("encodeGif", () => {
  test("Given flat, patterned and noisy frames When encoded and read back by an independent decoder Then every index, delay and the loop survive", () => {
    // Given
    const width = 300;
    const height = 200;
    const flat = new Uint8Array(width * height);
    const pattern = Uint8Array.from({ length: width * height }, (_, index) => (index % 17) * 3);
    const input: GifInput = {
      width,
      height,
      palette: rampPalette(),
      frames: [{ indices: flat, delayCs: 10 }, { indices: pattern, delayCs: 20 }, { indices: noise(width * height, 7), delayCs: 200 }],
    };

    // When
    const decoded = decodeGif(encodeGif(input));

    // Then
    expect(decoded).toMatchObject({ width, height, loops: true });
    expect(decoded.palette).toEqual(input.palette);
    expect(decoded.frames.map((frame) => frame.delayCs)).toEqual([10, 20, 200]);
    decoded.frames.forEach((frame, index) => expect(Buffer.from(frame.indices).equals(Buffer.from(input.frames[index].indices))).toBe(true));
  });

  test("Given a one-pixel image When encoded Then it reads back", () => {
    // Given
    const input: GifInput = { width: 1, height: 1, palette: rampPalette(), frames: [{ indices: Uint8Array.of(200), delayCs: 0 }] };

    // When
    const decoded = decodeGif(encodeGif(input));

    // Then
    expect(Array.from(decoded.frames[0].indices)).toEqual([200]);
  });

  test("Given the same frames twice When encoded Then the bytes are identical", () => {
    // Given
    const input: GifInput = { width: 64, height: 64, palette: rampPalette(), frames: [{ indices: noise(64 * 64, 3), delayCs: 10 }] };

    // When / Then
    expect(Buffer.from(encodeGif(input)).equals(Buffer.from(encodeGif(input)))).toBe(true);
  });

  test("Given a two-colour frame When the bundled image decoder reads the file Then each pixel shows its palette colour", async () => {
    // Given
    const palette = new Uint8Array(256 * 3);
    palette.set([255, 255, 255], 0);
    palette.set([217, 72, 15], 3);
    const indices = Uint8Array.from({ length: 8 * 8 }, (_, index) => (index % 8 < 4 ? 0 : 1));

    // When
    const image = await loadImage(Buffer.from(encodeGif({ width: 8, height: 8, palette, frames: [{ indices, delayCs: 10 }] })));
    const canvas = createCanvas(8, 8);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, 8, 8);

    // Then
    expect(Array.from(data.subarray(0, 3))).toEqual([255, 255, 255]);
    expect(Array.from(data.subarray(7 * 4, 7 * 4 + 3))).toEqual([217, 72, 15]);
  });

  test.each([
    ["a short palette", { width: 2, height: 2, palette: new Uint8Array(3), frames: [{ indices: new Uint8Array(4), delayCs: 1 }] }],
    ["no frames", { width: 2, height: 2, palette: new Uint8Array(768), frames: [] }],
    ["a frame of the wrong size", { width: 2, height: 2, palette: new Uint8Array(768), frames: [{ indices: new Uint8Array(3), delayCs: 1 }] }],
    ["a zero width", { width: 0, height: 2, palette: new Uint8Array(768), frames: [{ indices: new Uint8Array(0), delayCs: 1 }] }],
    ["a negative delay", { width: 1, height: 1, palette: new Uint8Array(768), frames: [{ indices: new Uint8Array(1), delayCs: -1 }] }],
  ])("Given %s When encoded Then it is refused", (_name, input) => {
    // When / Then
    expect(() => encodeGif(input as GifInput)).toThrow(RangeError);
  });
});
