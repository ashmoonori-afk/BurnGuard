import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { isChromiumLaunchable } from "../src/services/chromium-capability";
import { activeExportBrowserCount } from "../src/services/export-browser-registry";
import { capturePageFromSession } from "../src/services/export-frame-capture";
import { parsePng } from "../src/services/export-png-validation";
import { renderPngZipWithPage } from "../src/services/export-png-zip";
import { openRenderSession } from "../src/services/export-render-session";

const artboard = (index: number, color: string): string =>
  `<section data-graphic-artboard id="frame-${index}-message" style="width:320px;height:200px;background:${color};color:#101820;font-family:sans-serif"><h1 style="margin:24px">Frame ${index}</h1></section>`;

const document = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Frames</title><style>html,body{margin:0;background:#ffffff}</style></head><body>${artboard(1, "#f2c14e")}${artboard(2, "#7cc6fe")}${artboard(3, "#c1f7c1")}</body></html>`;

let root = "";
let usable = false;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "bg-png-zip-chromium-"));
  await writeFile(path.join(root, "index.html"), document);
  usable = await isChromiumLaunchable(undefined, { waitForResult: true, signal: new AbortController().signal });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("frame batch export against real Chromium", () => {
  test("Given three artboards in one document When exported through the capture adapter Then three validated PNGs are archived", async () => {
    // Given
    if (!usable) {
      expect(usable).toBe(false);
      return;
    }
    const stagedDir = root;
    const outputPath = path.join(path.dirname(root), `${path.basename(root)}-frames.zip`);
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
