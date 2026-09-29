import { describe, expect, test } from "bun:test";
import { createCanvas } from "@napi-rs/canvas";
import { MEASURED_VIEWPORTS, type MeasuredViewportLayout } from "@bg/shared";
import { compareVisualViewport, cropSectionJpeg, decodeGrayImage, sectionOverlap, ssimBand, visualRepairTargets, type GrayImage } from "../src/services/design-system-visual-diff";

const gray = (width: number, height: number, fill: (x: number, y: number) => number): GrayImage => {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data[y * width + x] = fill(x, y);
  return { width, height, data };
};
const layout = (sections: MeasuredViewportLayout["sections"], blocks: MeasuredViewportLayout["blocks"] = {}): MeasuredViewportLayout => ({
  viewport: { ...MEASURED_VIEWPORTS.desktop }, page_height: 1000, container: null, gutter: null, section_gap: null, type_scale: {}, blocks, sections,
});
const section = (top: number, height: number) => ({ heading: `S${top}`, top, height, columns: 1, align: "left" as const });

async function pngOf(image: GrayImage): Promise<Uint8Array> {
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  const pixels = context.createImageData(image.width, image.height);
  for (let index = 0; index < image.data.length; index += 1) pixels.data.set([image.data[index]!, image.data[index]!, image.data[index]!, 255], index * 4);
  context.putImageData(pixels, 0, 0);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

describe("Design-system visual diff", () => {
  test("Given identical bands, then SSIM is 1; given inverted or blank bands it is far lower", () => {
    const stripes = gray(1440, 400, (x) => (Math.floor(x / 40) % 2 === 0 ? 30 : 220));
    expect(ssimBand(stripes, stripes, 0, 400)).toBeCloseTo(1, 5);
    expect(ssimBand(stripes, gray(1440, 400, (x) => (Math.floor(x / 40) % 2 === 0 ? 220 : 30)), 0, 400)).toBeLessThan(0.3);
    expect(ssimBand(stripes, gray(1440, 400, () => 128), 0, 400)).toBeLessThan(0.3);
  });

  test("Given a band past either image, then it is clamped to the shared height and an empty band scores null", () => {
    const short = gray(1440, 100, () => 90);
    expect(ssimBand(short, short, 0, 900)).toBeCloseTo(1, 5);
    expect(ssimBand(short, short, 500, 900)).toBeNull();
  });

  test("Given sections and hero blocks, then overlap is the mean IoU of the band and its blocks, and a missing section scores 0", () => {
    const expected = layout([section(0, 400), section(400, 400)], { hero_heading: { x: 100, y: 100, width: 400, height: 100, align: "left" } });
    const same = sectionOverlap(expected, expected);
    expect(same.map((entry) => entry.overlap)).toEqual([1, 1]);
    const shifted = sectionOverlap(expected, layout([section(200, 400)], { hero_heading: { x: 100, y: 300, width: 400, height: 100, align: "left" } }));
    expect(shifted[0]!.overlap).toBeGreaterThan(0);
    expect(shifted[0]!.overlap).toBeLessThan(0.6);
    expect(shifted[1]!.overlap).toBe(0);
  });

  test("Given decoded images, then a PNG round-trips to grayscale and compareVisualViewport ranks the differing section lowest", async () => {
    const reference = gray(1440, 800, (x, y) => (y < 400 ? 200 : Math.floor(x / 40) % 2 === 0 ? 30 : 220));
    const generated = gray(1440, 800, (x, y) => (y < 400 ? 200 : 128));
    expect((await decodeGrayImage(await pngOf(reference))).data[0]).toBe(200);
    const expected = layout([section(0, 400), section(400, 400)]);
    const report = await compareVisualViewport({ viewport: "desktop", reference: await pngOf(reference), generated: await pngOf(generated), expected, actual: expected });
    expect(report.sections.map((entry) => entry.section)).toEqual([0, 1]);
    expect(report.sections[0]!.score).toBeGreaterThan(report.sections[1]!.score);
    expect(report.sections[0]!.score).toBeGreaterThan(0.9);
    expect(visualRepairTargets([report], 1).map((target) => [target.viewport, target.section])).toEqual([["desktop", 1]]);
  });

  test("Given a page image, then a section crop covers exactly its rows, is clamped to the image and to the crop cap, and an out-of-range or undecodable input gives null", async () => {
    const image = await pngOf(gray(400, 3000, (_x, y) => (y < 1000 ? 40 : y < 2000 ? 140 : 220)));
    const middle = await decodeGrayImage((await cropSectionJpeg(image, 1000, 500))!);
    expect([middle.width, middle.height]).toEqual([400, 500]);
    expect(Math.abs(middle.data[0]! - 140)).toBeLessThan(6);
    const clamped = await decodeGrayImage((await cropSectionJpeg(image, 2800, 900))!);
    expect(clamped.height).toBe(200);
    const capped = await decodeGrayImage((await cropSectionJpeg(image, 0, 3000))!);
    expect(capped.height).toBe(1600);
    expect(await cropSectionJpeg(image, 3000, 100)).toBeNull();
    expect(await cropSectionJpeg(new Uint8Array([1, 2, 3]), 0, 100)).toBeNull();
  });

  test("Given undecodable bytes, then the viewport is reported as unavailable instead of throwing", async () => {
    const expected = layout([section(0, 400)]);
    const report = await compareVisualViewport({ viewport: "mobile", reference: new Uint8Array([1, 2, 3]), generated: new Uint8Array([4]), expected, actual: expected });
    expect(report.sections).toEqual([]);
    expect(report.unavailable).toBe(true);
  });
});
