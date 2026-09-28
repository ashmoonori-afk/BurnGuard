import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { pptxParityImages } from "../src/services/export-parity-archives";
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
      const output = await pptxParityImages(mutated, 1);
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
