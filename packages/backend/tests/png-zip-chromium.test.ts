import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import type { ExportOptions } from "@bg/shared";
import { isChromiumLaunchable } from "../src/services/chromium-capability";
import { activeExportBrowserCount } from "../src/services/export-browser-registry";
import { capturePageFromSession } from "../src/services/export-frame-capture";
import { createCanvas, loadImage } from "../src/services/export-native-modules";
import { parsePng } from "../src/services/export-png-validation";
import { renderPngZipWithPage } from "../src/services/export-png-zip";
import { openRenderSession } from "../src/services/export-render-session";

const artboard = (index: number, color: string): string =>
  `<section data-graphic-artboard id="frame-${index}-message" style="width:320px;height:200px;background:${color};color:#101820;font-family:sans-serif"><h1 style="margin:24px">Frame ${index}</h1></section>`;

const document = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Frames</title><style>html,body{margin:0;background:#ffffff}</style></head><body>${artboard(1, "#f2c14e")}${artboard(2, "#7cc6fe")}${artboard(3, "#c1f7c1")}</body></html>`;

let root = "";
let stagedDir = "";
let usable = false;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "bg-png-zip-chromium-"));
  stagedDir = path.join(root, "project");
  await mkdir(stagedDir);
  await writeFile(path.join(stagedDir, "index.html"), document);
  usable = await isChromiumLaunchable(undefined, { waitForResult: true, signal: new AbortController().signal });
}, 60_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const sliceCases: readonly ExportOptions[] = [
  { slice_height: 3000, slice_format: "png" },
  { slice_height: 5000, slice_format: "png" },
  { slice_height: 5000, slice_format: "jpeg", jpeg_quality: 60 },
  { slice_height: 3000, slice_format: "jpeg", jpeg_quality: 95 },
];

describe("product detail slicing against real Chromium", () => {
  test.each(sliceCases)("captures every document row at cap $slice_height as $slice_format quality $jpeg_quality", async (options) => {
    expect(usable).toBe(true);
    // The 5000px cases also exercise document coordinates after scrolling, not just origin-zero clips.
    const origin = options.slice_height === 5000 ? { x: 37, y: 91 } : { x: 0, y: 0 };
    const colors = [[224, 48, 64], [32, 160, 96], [48, 80, 224]];
    const heights = [2000, 3500, 1000];
    await writeFile(path.join(stagedDir, "detail.html"), `<!doctype html><html><head><style>
      html,body{margin:0;background:#ff00ff}main{position:relative;width:640px;height:6500px;margin-left:${origin.x}px;margin-top:${origin.y}px}
      canvas{position:absolute;left:0;top:0}
      </style></head><body><main data-graphic-artboard>${heights.map((height, i) => `<section data-bg-node-id="section-${i}" style="height:${height}px;background:rgb(${colors[i]?.join(",")})"></section>`).join("")}
      <canvas width="16" height="6500"></canvas></main><script>
      const ctx=document.querySelector('canvas').getContext('2d');
      for(let y=0;y<6500;y++){ctx.fillStyle='rgb('+(y%256)+','+Math.floor(y/256)+',127)';ctx.fillRect(0,y,16,1)}
      </script></body></html>`);
    const outputPath = path.join(root, "slices.zip");
    const signal = new AbortController().signal;
    const session = await openRenderSession({ stagedDir, entrypoint: "detail.html", viewport: { width: 1280, height: 720, dpr: 1 }, deck: false, signal });
    try {
      if (origin.y > 0) await session.page.evaluate(() => { window.scrollTo(0, 300); });
      const page = capturePageFromSession(session.page);
      expect(await page.measureSections("[data-graphic-artboard]")).toEqual({ pageWidth: 640, pageHeight: 6500, originX: origin.x, originY: origin.y, sectionBottoms: [2000, 5500, 6500] });
      const { validation, findings } = await renderPngZipWithPage({
        page, stagedDir, outputPath, deck: false,
        graphic_set: { schema_version: 1, kind: "product_detail", frame_count: 1 },
        options, receiptWriter: async () => undefined, signal,
      });
      const regions = options.slice_height === 3000
        ? [{ top: 0, bottom: 2000 }, { top: 2000, bottom: 5000 }, { top: 5000, bottom: 6500 }]
        : [{ top: 0, bottom: 2000 }, { top: 2000, bottom: 6500 }];
      expect(validation.outputs.map((output) => output.source_region)).toEqual(regions);
      expect(findings).toEqual(options.slice_height === 3000 ? [{ code: "cut_through_content", slice: 2 }] : []);
      const archive = await JSZip.loadAsync(await readFile(outputPath));
      const extension = options.slice_format === "jpeg" ? "jpg" : "png";
      expect(Object.keys(archive.files).sort()).toEqual(regions.map((_, i) => `${String(i + 1).padStart(2, "0")}.${extension}`));
      let nextRow = 0;
      for (const output of validation.outputs) {
        const entry = archive.file(output.rel_path);
        if (entry === null || output.source_region === undefined) throw new Error("Missing slice or source region");
        const bytes = await entry.async("nodebuffer");
        const image = await loadImage(bytes);
        const { top, bottom } = output.source_region;
        expect(top).toBe(nextRow);
        expect([image.width, image.height]).toEqual([640, bottom - top]);
        expect([output.width, output.height]).toEqual([image.width, image.height]);
        const canvas = createCanvas(image.width, image.height);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        for (let row = 0; row < image.height; row++) {
          const y = top + row;
          const expected = colors[y < 2000 ? 0 : y < 5500 ? 1 : 2];
          if (expected === undefined) throw new Error("Missing section color");
          // Every row, including both sides of each seam, must contain the source section, not viewport padding or editor chrome.
          for (const x of [32, 320, 639]) {
            const pixel = (row * image.width + x) * 4;
            for (const [channel, value] of expected.entries()) {
              // JPEG chroma interpolation blends boundary rows (up to 40 levels here); the section colors differ by at least 128.
              expect(Math.abs((pixels[pixel + channel] ?? -255) - value)).toBeLessThanOrEqual(options.slice_format === "jpeg" ? 48 : 0);
            }
            expect(pixels[pixel + 3]).toBe(255);
          }
          if (options.slice_format === "png") {
            const pixel = (row * image.width + 8) * 4;
            // A unique row code proves there are no duplicated or omitted rows inside a solid-color section.
            expect(Array.from(pixels.subarray(pixel, pixel + 4))).toEqual([y % 256, Math.floor(y / 256), 127, 255]);
          }
        }
        if (options.slice_format === "jpeg" && top === 0) {
          // Compare real encoded bytes to Chromium at the requested quality; do not mock the adapter.
          const direct = await session.page.screenshot({ type: "jpeg", quality: options.jpeg_quality, fullPage: true, clip: { x: origin.x, y: origin.y, width: 640, height: bottom }, animations: "disabled" });
          expect(bytes.equals(direct)).toBe(true);
          const otherQuality = await session.page.screenshot({ type: "jpeg", quality: options.jpeg_quality === 60 ? 95 : 60, fullPage: true, clip: { x: origin.x, y: origin.y, width: 640, height: bottom }, animations: "disabled" });
          expect(bytes.equals(otherQuality)).toBe(false);
        }
        nextRow = bottom;
      }
      expect(nextRow).toBe(6500);
      expect(session.page.viewportSize()).toEqual({ width: 1280, height: 720 });
      expect(await session.page.evaluate(() => window.scrollY)).toBe(origin.y > 0 ? 300 : 0);
    } finally {
      await session.close();
      await rm(outputPath, { force: true });
    }
    expect(activeExportBrowserCount()).toBe(0);
  }, 120_000);
});

describe("frame batch export against real Chromium", () => {
  test("Given three artboards in one document When exported through the capture adapter Then three validated PNGs are archived", async () => {
    // Given
    expect(usable).toBe(true);
    const outputPath = path.join(root, "frames.zip");
    const controller = new AbortController();
    const session = await openRenderSession({ stagedDir, entrypoint: "index.html", viewport: { width: 1280, height: 720, dpr: 1 }, deck: false, signal: controller.signal });

    // When
    try {
      const { validation } = await renderPngZipWithPage({
        page: capturePageFromSession(session.page),
        stagedDir,
        outputPath,
        deck: false,
        graphic_set: { schema_version: 1, kind: "card_news", frame_count: 3 },
        options: { slice_height: 5000, slice_format: "png" },
        receiptWriter: async () => undefined,
        signal: controller.signal,
      });

      // Then
      const archive = await JSZip.loadAsync(await readFile(outputPath));
      expect(Object.keys(archive.files).sort()).toEqual(["01.png", "02.png", "03.png"]);
      expect(validation.outputs.map((output) => [output.width, output.height])).toEqual([[320, 200], [320, 200], [320, 200]]);
      for (const name of ["01.png", "02.png", "03.png"]) {
        const entry = archive.file(name);
        if (entry === null) throw new TypeError(`missing ${name}`);
        expect(parsePng(await entry.async("uint8array"))).toEqual({ width: 320, height: 200 });
      }
    } finally {
      await session.close();
      await rm(outputPath, { force: true });
    }
    expect(activeExportBrowserCount()).toBe(0);
  }, 120_000);
});
