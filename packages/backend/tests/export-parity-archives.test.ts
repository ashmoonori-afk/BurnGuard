import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { openParityArchive, pptxParityImages, preflightParityArchive, zipParityImages } from "../src/services/export-parity-archives";
import { decodeParityImage } from "../src/services/export-parity-images";
import { compareParityPages } from "../src/services/export-parity";
import { createCanvas } from "../src/services/export-native-modules";
import { writePptx } from "../src/services/export-pptx";

describe("export parity archive evidence", () => {
  test("Given a real PPTX package When parity images are resolved Then slide relationships locate every embedded PNG", async () => {
    // Given
    const root = await mkdtemp(path.join(tmpdir(), "bg-parity-pptx-"));
    const outputPath = path.join(root, "deck.pptx");
    const first = createCanvas(32, 18);
    first.getContext("2d").fillStyle = "#ff0000";
    first.getContext("2d").fillRect(0, 0, 32, 18);
    const firstPng = new Uint8Array(first.toBuffer("image/png"));
    const second = createCanvas(32, 18);
    second.getContext("2d").fillStyle = "#0000ff";
    second.getContext("2d").fillRect(0, 0, 32, 18);
    const secondPng = new Uint8Array(second.toBuffer("image/png"));
    try {
      await writePptx(
        [
          { width: 32, height: 18, png: firstPng, notes: "one" },
          { width: 32, height: 18, png: secondPng, notes: "two" },
        ],
        outputPath,
      );

      // When
      const pages = await pptxParityImages(
        new Uint8Array(await readFile(outputPath)),
        2,
        new AbortController().signal,
      );

      // Then
      const source = await Promise.all([
        decodeParityImage(firstPng),
        decodeParityImage(secondPng),
      ]);
      const summary = compareParityPages({ source, output: pages });
      expect(pages.map((page) => [page.width, page.height])).toEqual([
        [960, 540],
        [960, 540],
      ]);
      expect(summary.pages.map((page) => page.similarity_score)).toEqual([
        100,
        100,
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Given a PPTX image moved off-slide When parity is computed Then embedded-media identity cannot produce a pass", async () => {
    // Given
    const root = await mkdtemp(path.join(tmpdir(), "bg-parity-pptx-offslide-"));
    const outputPath = path.join(root, "deck.pptx");
    const image = createCanvas(32, 18);
    image.getContext("2d").fillStyle = "#ff0000";
    image.getContext("2d").fillRect(0, 0, 32, 18);
    const png = new Uint8Array(image.toBuffer("image/png"));
    try {
      await writePptx([{ width: 32, height: 18, png, notes: "one" }], outputPath);
      const zip = await JSZip.loadAsync(await readFile(outputPath));
      const slide = await zip.file("ppt/slides/slide1.xml")?.async("string");
      if (slide === undefined) throw new TypeError("expected PPTX slide");
      zip.file(
        "ppt/slides/slide1.xml",
        slide.replace(/<p:pic>[\s\S]*?<\/p:pic>/u, (picture) =>
          picture
            .replace(/<a:off x="\d+" y="\d+"\/>/u, '<a:off x="999999999" y="999999999"/>')
            .replace(/<a:ext cx="\d+" cy="\d+"\/>/u, '<a:ext cx="1" cy="1"/>'),
        ),
      );
      const mutated = await zip.generateAsync({ type: "uint8array" });

      // When
      const output = await pptxParityImages(mutated, 1, new AbortController().signal);
      const summary = compareParityPages({
        source: [await decodeParityImage(png)],
        output,
      });

      // Then
      expect(summary.status).toBe("warn");
      expect(summary.pages[0]?.similarity_score).toBeLessThan(
        summary.threshold,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("export parity archive bounds", () => {
  test("Given an aborted export When PNG ZIP parity is computed Then work stops before decoding", async () => {
    const zip = new JSZip();
    zip.file("01.png", new Uint8Array([1, 2, 3]));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const controller = new AbortController();
    controller.abort();

    await expect(zipParityImages(bytes, ["01.png"], controller.signal)).rejects.toThrow();
  });
});

test("Given an archive entry declaring more than the parity budget When parity is prepared Then it is rejected before any inflation", async () => {
  const zip = new JSZip();
  zip.file("01.png", new Uint8Array([1, 2, 3]));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 46 < bytes.byteLength; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) view.setUint32(offset + 24, 0x7fffffff, true);
  }

  expect(() => preflightParityArchive(bytes)).toThrow("byte budget");
  await expect(zipParityImages(bytes, ["01.png"], new AbortController().signal)).rejects.toThrow("byte budget");
});

test("Given an entry that under-declares its inflated size When read for parity Then inflation stops at the declared size", async () => {
  const zip = new JSZip();
  zip.file("01.png", new Uint8Array(1_000_000));
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 46 < bytes.byteLength; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) view.setUint32(offset + 24, 16, true);
  }

  expect(() => openParityArchive(bytes).read("01.png", new AbortController().signal)).toThrow();
});

test("Given a directory whose record count under-reports its entries When opened for parity Then it is rejected", async () => {
  const zip = new JSZip();
  zip.file("01.png", new Uint8Array([1]));
  zip.file("02.png", new Uint8Array([2]));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      view.setUint16(offset + 8, 1, true);
      view.setUint16(offset + 10, 1, true);
      break;
    }
  }

  expect(() => openParityArchive(bytes)).toThrow("inconsistent");
});

test("Given a local header that disagrees with the central directory When read for parity Then the split view is rejected", async () => {
  const zip = new JSZip();
  zip.file("aa.png", new Uint8Array([1, 2, 3]));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const localNameAt = 30;
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  bytes[localNameAt] = "b".charCodeAt(0);

  expect(() => openParityArchive(bytes).read("aa.png", new AbortController().signal)).toThrow("inconsistent");
});

test("Given repeated reads of one entry When the aggregate read budget is exceeded Then further reads are rejected", async () => {
  const zip = new JSZip();
  zip.file("01.png", new Uint8Array(1_000));
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const archive = openParityArchive(bytes, { totalReadBytes: 2_500 });
  const signal = new AbortController().signal;

  archive.read("01.png", signal);
  archive.read("01.png", signal);
  expect(() => archive.read("01.png", signal)).toThrow("byte budget");
});
