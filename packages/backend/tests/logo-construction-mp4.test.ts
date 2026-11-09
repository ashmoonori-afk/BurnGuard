import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LOGO_GEOMETRY_FILE } from "@bg/shared";
import { activeExportBrowserCount } from "../src/services/export-browser-registry";
import { forEachConstructionFrame, LOGO_CONSTRUCTION_GIF, readConstructionRecord } from "../src/services/export-construction-gif";
import { renderLogoConstructionMp4 } from "../src/services/export-construction-mp4";
import { parseExportValidation } from "../src/services/export-receipt-validation";
import { launchTestChromium } from "./helpers/chromium";
import { parseMp4 } from "./helpers/mp4-parse";

const browserSmoke = process.env.BG_BROWSER_SMOKE === "1";

// The ring of logo-construction-gif.test.ts: a circle minus a smaller one, centred on the 64-unit grid.
const RING_RECORD = {
  schema_version: 1,
  grid: 64,
  radii: [{ id: "outer", value: 20 }, { id: "inner", value: 12 }],
  primitives: [{ kind: "circle", id: "o", cx: 32, cy: 32, r: "outer" }, { kind: "circle", id: "i", cx: 32, cy: 32, r: "inner" }],
  tree: { op: "subtract", args: [{ ref: "o" }, { ref: "i" }] },
};

async function staged(record: string | null): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "bg-logo-construction-mp4-"));
  await mkdir(path.join(root, "render"), { recursive: true });
  if (record !== null) await writeFile(path.join(root, "render", LOGO_GEOMETRY_FILE), record);
  return root;
}

/** Decodes every sample with WebCodecs in a real Chromium and returns the luma of the first and last pictures. */
async function decodeFirstAndLast(avcC: Uint8Array, samples: readonly Uint8Array[], durations: readonly number[], size: number): Promise<{ readonly decoded: number; readonly first: Uint8Array; readonly last: Uint8Array }> {
  const browser = await launchTestChromium(60_000);
  try {
    const context = await browser.newContext();
    await context.route("https://decoder.burnguard.invalid/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>decoder</title>" }));
    const page = await context.newPage();
    await page.goto("https://decoder.burnguard.invalid/");
    const result = await page.evaluate(async (input) => {
      const bytes = (text: string): Uint8Array => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
      const lumas: string[] = [];
      let decoded = 0;
      const canvas = new OffscreenCanvas(input.size, input.size);
      const context = canvas.getContext("2d")!;
      const luma = (): string => {
        const { data } = context.getImageData(0, 0, input.size, input.size);
        const out = new Uint8Array(input.size * input.size);
        for (let pixel = 0; pixel < out.length; pixel += 1) out[pixel] = Math.round(0.299 * data[pixel * 4]! + 0.587 * data[pixel * 4 + 1]! + 0.114 * data[pixel * 4 + 2]!);
        let text = "";
        for (let index = 0; index < out.length; index += 0x8000) text += String.fromCharCode(...out.subarray(index, index + 0x8000));
        return btoa(text);
      };
      let failure: string | null = null;
      const decoder = new VideoDecoder({
        output: (frame) => {
          decoded += 1;
          if (decoded === 1 || decoded === input.samples.length) { context.drawImage(frame, 0, 0); lumas.push(luma()); }
          frame.close();
        },
        error: (error) => { failure = String(error); },
      });
      decoder.configure({ codec: "avc1.42001e", codedWidth: input.size, codedHeight: input.size, description: bytes(input.avcC) });
      let timestamp = 0;
      for (const [index, data] of input.samples.entries()) {
        decoder.decode(new EncodedVideoChunk({ type: index === 0 ? "key" : "delta", timestamp, duration: input.durations[index]! * 1000, data: bytes(data) }));
        timestamp += input.durations[index]! * 1000;
      }
      await decoder.flush();
      decoder.close();
      return { decoded, lumas, failure };
    }, { avcC: Buffer.from(avcC).toString("base64"), samples: samples.map((sample) => Buffer.from(sample).toString("base64")), durations: [...durations], size });
    if (result.failure !== null) throw new Error(`decode failed: ${result.failure}`);
    const [first, last] = result.lumas.map((text) => new Uint8Array(Buffer.from(text, "base64")));
    return { decoded: result.decoded, first: first!, last: last! };
  } finally { await browser.close(); }
}

function lumaOf(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let pixel = 0; pixel < out.length; pixel += 1) out[pixel] = Math.round(0.299 * rgba[pixel * 4]! + 0.587 * rgba[pixel * 4 + 1]! + 0.114 * rgba[pixel * 4 + 2]!);
  return out;
}

function meanDifference(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) sum += Math.abs(a[index]! - b[index]!);
  return sum / a.length;
}

describe("renderLogoConstructionMp4", () => {
  test.skipIf(!browserSmoke)("Given a ring record When exported Then the MP4 holds the GIF's frames in H.264 and decodes back to the same drawing", async () => {
    // Given
    const root = await staged(JSON.stringify(RING_RECORD));
    try {
      const outputPath = path.join(root, "artifact.mp4");
      const source: { luma: Uint8Array; durationMs: number }[] = [];
      await forEachConstructionFrame(await readConstructionRecord(path.join(root, "render"), "."), "Northstar", ({ data, delayCs }) => { source.push({ luma: lumaOf(data), durationMs: delayCs * 10 }); });

      // When
      const validation = await renderLogoConstructionMp4({ stagedDir: path.join(root, "render"), entrypointDir: ".", outputPath, label: "Northstar", signal: AbortSignal.timeout(60_000) });
      const bytes = new Uint8Array(await readFile(outputPath));
      const mp4 = parseMp4(bytes);

      // Then
      const size = LOGO_CONSTRUCTION_GIF.size;
      expect(validation).toEqual({ frames: source.length, width: size, height: size, bytes: bytes.byteLength });
      expect(parseExportValidation("construction_mp4", {}, validation)).toEqual(validation);
      expect(mp4.entry).toMatchObject({ type: "avc1", width: size, height: size });
      expect([...mp4.entry.avcC.subarray(0, 2)]).toEqual([1, 0x42]);
      expect(mp4.durations).toEqual(source.map((frame) => frame.durationMs));
      expect(mp4.durations.at(-1)).toBe(LOGO_CONSTRUCTION_GIF.holdMs);
      expect(mp4.movie.duration).toBe(source.reduce((sum, frame) => sum + frame.durationMs, 0));
      expect(mp4.keySamples?.[0]).toBe(1);
      expect(activeExportBrowserCount()).toBe(0);
      const decoded = await decodeFirstAndLast(mp4.entry.avcC, mp4.samples, mp4.durations, size);
      expect(decoded.decoded).toBe(source.length);
      // Lossy, so close rather than equal; the empty artboard and the finished ring are far apart.
      expect(meanDifference(decoded.first, source[0]!.luma)).toBeLessThan(4);
      expect(meanDifference(decoded.last, source.at(-1)!.luma)).toBeLessThan(4);
      expect(meanDifference(source[0]!.luma, source.at(-1)!.luma)).toBeGreaterThan(20);
      const at = (luma: Uint8Array, x: number, y: number): number => luma[Math.round(y * size / 64) * size + Math.round(x * size / 64)]!;
      expect(at(decoded.last, 43.3, 43.3)).toBeLessThan(64);
      expect(at(decoded.last, 28, 30)).toBeGreaterThan(192);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 90_000);

  test.skipIf(!browserSmoke)("Given a Chromium without the requested encoder When exported Then it fails as unsupported, writes nothing and closes the browser", async () => {
    // Given
    const root = await staged(JSON.stringify(RING_RECORD));
    try {
      const outputPath = path.join(root, "artifact.mp4");

      // When / Then
      await expect(renderLogoConstructionMp4({ stagedDir: path.join(root, "render"), entrypointDir: ".", outputPath, label: "Northstar", signal: AbortSignal.timeout(60_000), codec: "avc1.ff0000" })).rejects.toMatchObject({ code: "construction_mp4_unsupported" });
      expect(await Bun.file(outputPath).exists()).toBe(false);
      expect(activeExportBrowserCount()).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 90_000);

  test("Given no geometry record When exported Then it fails as missing before any browser starts", async () => {
    // Given
    const root = await staged(null);
    try {
      const outputPath = path.join(root, "artifact.mp4");

      // When / Then
      await expect(renderLogoConstructionMp4({ stagedDir: path.join(root, "render"), entrypointDir: ".", outputPath, label: "Northstar", signal: AbortSignal.timeout(60_000) })).rejects.toMatchObject({ code: "construction_missing" });
      expect(await Bun.file(outputPath).exists()).toBe(false);
      expect(activeExportBrowserCount()).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
