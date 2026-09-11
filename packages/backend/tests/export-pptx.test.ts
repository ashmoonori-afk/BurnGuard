import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { createCanvas } from "@napi-rs/canvas";
import { PptxExportError, pptxLayoutForSize, writePptx } from "../src/services/export-pptx";
import { validatePptxPackage } from "../src/services/export-package-validation";
import { parseExportValidation } from "../src/services/export-receipt-validation";

const png = new Uint8Array(createCanvas(2, 2).toBuffer("image/png"));
test("Given rendered slides When saved as PPTX Then original image bytes and notes survive with contained geometry in both ratios", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "burnguard-pptx-"));
  try {
    for (const size of ["16x9", "4x3"] as const) {
      const output = path.join(root, size + ".pptx");
      await writePptx([{ width: 1280, height: 720, png, notes: "원문 <제목> & notes" }, { width: 960, height: 720, png, notes: "Second slide" }], output, size);
      const bytes = await readFile(output), zip = await JSZip.loadAsync(bytes);
      const result = await validatePptxPackage(bytes, 2);
      expect(result).toEqual({ slides: 2, editable_text_nodes: 0, raster_slides: 2 });
      expect(parseExportValidation("pptx", { pptx_size: size }, result)).toEqual(result);
      const media = Object.keys(zip.files).filter(name => /^ppt\/media\/.*\.png$/.test(name));
      for (const name of media) expect(await zip.file(name)!.async("uint8array")).toEqual(png);
      const notes = await zip.file("ppt/notesSlides/notesSlide1.xml")!.async("string");
      expect(notes).toContain("원문"); expect(notes).toContain("&amp;");
      const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
      expect(xml).toContain("<p:pic>");
      expect(xml).not.toContain("<a:t>");
      // A 16:9 image fits unchanged in a 4:3 slide; it gets vertical space, never stretched height.
      expect(xml).toContain('cy="5143500"');
      if (size === "4x3") expect(xml).toContain('y="857250"');
      expect(pptxLayoutForSize(size).width).toBe(10);
    }
    await expect(writePptx([], path.join(root, "empty.pptx"))).rejects.toBeInstanceOf(PptxExportError);
    await expect(writePptx([{ width: NaN, height: 1, png, notes: "" }], path.join(root, "invalid.pptx"))).rejects.toThrow();
    expect(() => parseExportValidation("pptx", { pptx_size: "16x9" }, { slides: 2, editable_text_nodes: 0, raster_slides: 1 })).toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
