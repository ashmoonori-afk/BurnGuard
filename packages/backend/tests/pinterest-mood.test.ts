import { expect, test } from "bun:test";
import { createCanvas } from "@napi-rs/canvas";
import { collectPinterestMood, imagePalette, parsePinterestMoodRequest } from "../src/services/pinterest-mood";
import { buildExtractionProvenance } from "../src/services/extraction-provenance";

test("Given public pin input, when parsing, then canonicalize duplicates and reject unsafe URLs and limits", () => {
  expect(parsePinterestMoodRequest({ pin_urls: ["https://pinterest.com/pin/123", "https://www.pinterest.com/pin/123/"] }).pin_urls).toEqual(["https://www.pinterest.com/pin/123/"]);
  for (const url of ["http://127.0.0.1/pin/1", "https://www.pinterest.com@127.0.0.1/pin/1", "https://www.pinterest.com/board/", "https://www.pinterest.com/pin/1/?token=x"]) expect(() => parsePinterestMoodRequest({ pin_urls: [url] })).toThrow();
  expect(() => parsePinterestMoodRequest({ pin_urls: Array(13).fill("https://pinterest.com/pin/1/") })).toThrow();
});

test("Given pin image pixels and an unavailable pin, when collecting, then retain observed colors and honest partial provenance", async () => {
  const canvas = createCanvas(2, 2); const context = canvas.getContext("2d"); context.fillStyle = "#ff0000"; context.fillRect(0, 0, 2, 2);
  const bytes = canvas.toBuffer("image/png");
  expect(await imagePalette(bytes)).toEqual(["#ff0000"]);
  const oversized = Buffer.from(bytes); oversized.writeUInt32BE(30_000_000, 16);
  await expect(imagePalette(oversized)).rejects.toThrow("unsupported_image_dimensions");
  const result = await collectPinterestMood({ pin_urls: ["https://pinterest.com/pin/1/", "https://pinterest.com/pin/2/"] }, new AbortController().signal, async (url, options) => {
    if (url.pathname === "/pin/2/") throw new Error("private");
    options.noteBytes(bytes.length);
    return { finalUrl: url, text: '<meta property="og:image" content="https://i.pinimg.com/a.png">', buffer: bytes };
  });
  expect(result.pins.map((pin) => pin.status)).toEqual(["analyzed", "unavailable"]);
  expect(result.analysis.artifactCopies).toEqual([]);
  const provenance = buildExtractionProvenance(result.analysis.discoveries!, 1, null);
  expect(provenance.content.entries.find((entry) => entry.key === "sample-ff0000")?.source_locators).toEqual(["https://www.pinterest.com/pin/1/"]);
  expect(result.analysis.fontFamilies).toEqual([]);
});

test("Given an unsafe OG image or exhausted budget, when collecting, then never fetch it or publish a fake success", async () => {
  let calls = 0;
  await expect(collectPinterestMood({ pin_urls: ["https://pinterest.com/pin/1/"] }, new AbortController().signal, async (url) => {
    calls++; return { finalUrl: url, text: '<meta property="og:image" content="https://127.0.0.1/private">', buffer: Buffer.alloc(0) };
  })).rejects.toThrow("No public pin images");
  expect(calls).toBe(1);
  await expect(collectPinterestMood({ pin_urls: ["https://pinterest.com/pin/1/"] }, new AbortController().signal, async (url, options) => {
    options.noteBytes(24_000_001); return { finalUrl: url, text: "", buffer: Buffer.alloc(0) };
  })).rejects.toThrow("download limit");
});
