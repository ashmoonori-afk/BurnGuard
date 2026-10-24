import { expect, test } from "bun:test";
import { setImmediate } from "node:timers";
import { crc32 } from "node:zlib";
import { createCanvas, loadImage } from "../src/services/export-native-modules";
import { decodeLogoPng, traceLogoPng } from "../src/services/logo-trace-finalize";
import { LogoTraceError, traceLogoPixels } from "../src/services/logo-tracer";
import { logoSvgSource, validateLogoSvg } from "../src/services/logo-svg-validation";
import { isRuntimeSource } from "../../../scripts/package-runtime";

const source = "explorations/round-1/candidate-2.png";

function pixels(width: number, height: number, at: (x: number, y: number) => readonly number[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(at(x, y), (y * width + x) * 4);
  return data;
}

async function raster(svg: string, width: number, height: number): Promise<Uint8ClampedArray> {
  const canvas = createCanvas(width, height), context = canvas.getContext("2d");
  context.drawImage(await loadImage(Buffer.from(svg)), 0, 0);
  return context.getImageData(0, 0, width, height).data;
}

test("Given pixels on either side of the binary threshold When traced Then equality stays background", async () => {
  const data = pixels(16, 16, (x) => x < 8 ? [127, 127, 127, 255] : [128, 128, 128, 255]);
  const svg = await traceLogoPixels(data, 16, 16, { source, mode: "binary", threshold: 128, speckle: 0, tolerance: 0 });
  const actual = await raster(svg, 16, 16);
  expect([actual[4 * 3 + 3], actual[4 * 12 + 3]]).toEqual([255, 0]);
});

test.each(["hole", "diagonal", "thin-cross"] as const)("Given a %s When polygon traced Then native-size pixels are preserved", async kind => {
  const data = pixels(16, 16, (x, y) => {
    const on = kind === "hole" ? x >= 2 && x < 14 && y >= 2 && y < 14 && !(x >= 6 && x < 10 && y >= 6 && y < 10)
      : kind === "diagonal" ? (x < 8 && y < 8) || (x >= 8 && y >= 8)
        : (x >= 7 && x < 9) || (y >= 7 && y < 9);
    return on ? [0, 0, 0, 255] : [255, 255, 255, 255];
  });
  const svg = await traceLogoPixels(data, 16, 16, { source, tolerance: 0, speckle: 0 });
  expect(await raster(svg, 16, 16)).toEqual(data);
  expect(logoSvgSource(svg)).toBe(source);
  expect(() => validateLogoSvg(svg)).not.toThrow();
});

test("Given far-offset stair-step edges When compactly encoded Then relative segments preserve native pixels", async () => {
  const data = pixels(128, 128, (x, y) => x >= 80 && y >= 80 && x + y < 216 ? [10, 20, 30, 255] : [255, 255, 255, 255]);
  const svg = await traceLogoPixels(data, 128, 128, { source, tolerance: 0, speckle: 0 });
  expect(await raster(svg, 128, 128)).toEqual(data);
  expect(Buffer.byteLength(svg)).toBeLessThan(800);
});

test.each([0, 2])("Given an opaque image with a tiny color contour When tolerance is %i Then reduction reveals a painted background", async tolerance => {
  const data = pixels(128, 128, (x, y) => x >= 60 && x < 62 && y >= 60 && y < 62 ? [255, 0, 0, 255] : [255, 255, 255, 255]);
  const svg = await traceLogoPixels(data, 128, 128, { source, tolerance, speckle: 0 });
  expect(await raster(svg, 128, 128)).toEqual(tolerance === 0 ? data : pixels(128, 128, () => [255, 255, 255, 255]));
});

test("Given more than eight colors When traced Then deterministic output uses at most eight compound paths", async () => {
  const data = pixels(32, 32, (x, y) => [x * 8, y * 8, (x + y) * 4, 255]);
  const options = { source, speckle: 0 };
  const svg = await traceLogoPixels(data, 32, 32, options);
  expect((svg.match(/<path /g) ?? []).length).toBeLessThanOrEqual(8);
  expect(await traceLogoPixels(data, 32, 32, options)).toBe(svg);
});

test("Given nearly identical fitted colors When traced Then one paint replaces redundant boundaries", async () => {
  const data = pixels(32, 32, x => x < 16 ? [16, 16, 16, 255] : [28, 28, 28, 255]);
  const svg = await traceLogoPixels(data, 32, 32, { source, tolerance: 0, speckle: 0 });
  const actual = await raster(svg, 32, 32);
  expect((svg.match(/<path /g) ?? []).length).toBe(1);
  expect([...actual.slice(0, 4)]).toEqual([...actual.slice(31 * 4, 32 * 4)]);
  expect(actual[3]).toBe(255);
});

test("Given a one-pixel speckle When filtered Then it merges into its adjacent region", async () => {
  const data = pixels(16, 16, (x, y) => x === 8 && y === 8 ? [255, 0, 0, 255] : [255, 255, 255, 255]);
  const svg = await traceLogoPixels(data, 16, 16, { source, speckle: 4, tolerance: 0 });
  expect(await raster(svg, 16, 16)).toEqual(pixels(16, 16, () => [255, 255, 255, 255]));
});

test.each([0, 4])("Given a long one-pixel region When speckle is %i Then a thin mark above the area threshold is preserved", async speckle => {
  const data = pixels(32, 32, x => x === 16 ? [255, 0, 0, 255] : [255, 255, 255, 255]);
  const svg = await traceLogoPixels(data, 32, 32, { source, speckle, tolerance: 0 });
  expect(await raster(svg, 32, 32)).toEqual(data);
});

test("Given transparent pixels with hidden RGB When traced Then they do not become paint", async () => {
  const data = pixels(16, 16, (x, y) => x >= 4 && x < 12 && y >= 4 && y < 12 ? [20, 50, 100, 255] : [255, 0, 0, 0]);
  const svg = await traceLogoPixels(data, 16, 16, { source, tolerance: 0 });
  const actual = await raster(svg, 16, 16);
  expect([...actual.slice(0, 4)]).toEqual([0, 0, 0, 0]);
  expect([...actual.slice((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4)]).toEqual([20, 50, 100, 255]);
});

test("Given spline mode When traced Then quadratic paths still pass the SVG contract", async () => {
  const data = pixels(16, 16, (x, y) => x > 2 && x < 13 && y > 2 && y < 13 ? [10, 20, 30, 255] : [255, 255, 255, 255]);
  const svg = await traceLogoPixels(data, 16, 16, { source, curve: "spline" });
  expect(svg).toMatch(/d="M[0-9 .]+Q/);
  expect(() => validateLogoSvg(svg)).not.toThrow();
  expect((await raster(svg, 16, 16))[(8 * 16 + 8) * 4 + 3]).toBe(255);
});

test("Given cancellation during tracing When the next batch yields Then the abort reason propagates", async () => {
  const controller = new AbortController(), reason = new Error("fixture cancellation");
  const pending = traceLogoPixels(pixels(256, 256, () => [0, 0, 0, 255]), 256, 256, { source, signal: controller.signal });
  const abort = setImmediate(() => controller.abort(reason));
  try { await expect(pending).rejects.toBe(reason); }
  finally { clearImmediate(abort); }
});

test("Given invalid geometry or options When traced Then input is refused", async () => {
  await expect(traceLogoPixels(new Uint8ClampedArray(4), 2, 2, { source })).rejects.toMatchObject({ code: "input" });
  await expect(traceLogoPixels(new Uint8ClampedArray(4), 1, 1, { source: "../candidate.png" })).rejects.toMatchObject({ code: "input" });
  await expect(traceLogoPixels(new Uint8ClampedArray(4), 1, 1, { source, colors: 9 })).rejects.toBeInstanceOf(LogoTraceError);
  await expect(traceLogoPixels(new Uint8ClampedArray(4), 1, 1, { source, tolerance: NaN })).rejects.toMatchObject({ code: "input" });
  await expect(traceLogoPixels(new Uint8ClampedArray(4), 1, 1, { source })).rejects.toMatchObject({ code: "empty" });
});

test("Given excessive geometry or contour complexity When traced Then work is bounded", async () => {
  await expect(traceLogoPixels(new Uint8ClampedArray(2049 * 2049 * 4), 2049, 2049, { source })).rejects.toMatchObject({ code: "budget" });
  const data = pixels(400, 400, (x, y) => (x + y) % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
  await expect(traceLogoPixels(data, 400, 400, { source, speckle: 0 })).rejects.toMatchObject({ code: "budget" });
});

test.each(["tEXt", "caBX"])("Given PNG %s metadata containing SVG When decoded Then only PNG pixels are traced", async type => {
  const canvas = createCanvas(16, 16), context = canvas.getContext("2d");
  context.fillStyle = "#123456"; context.fillRect(0, 0, 16, 16);
  const png = canvas.toBuffer("image/png"), text = Buffer.from("comment\0<svg invalid");
  const typed = Buffer.concat([Buffer.from(type), text]), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(text.length); crc.writeUInt32BE(crc32(typed) >>> 0);
  const withText = Buffer.concat([png.subarray(0, 33), length, typed, crc, png.subarray(33)]);
  const svg = await traceLogoPng(withText, { source });
  expect(await raster(svg, 16, 16)).toEqual((await decodeLogoPng(png)).data);
  await expect(decodeLogoPng(Buffer.alloc(0))).rejects.toMatchObject({ code: "input" });
  expect(isRuntimeSource("THIRD_PARTY_NOTICES.md")).toBe(true);
});
