import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import type { Browser } from "playwright-core";
import { bundledFontStylesheet } from "../src/data/bundled-fonts";
import { assemblePrintPreflight, measurePrintPage } from "../src/services/print-preflight-service";
import { launchTestChromium } from "./helpers/chromium";

// A4 at 96 dpi is 793.7 x 1122.5 CSS px; two artboards, one holding a 600px-wide image and one a 3000px-wide image.
const A4_WIDTH = 794;
const A4_HEIGHT = 1123;
const ENTRYPOINT = "index.html";
const artboard = (name: string, image: string, text = "") =>
  `<section data-graphic-artboard data-name="${name}" style="position:relative;width:${A4_WIDTH}px;height:${A4_HEIGHT}px;overflow:hidden"><img id="${image}" src="img/${image}.png" style="width:${A4_WIDTH}px;height:${A4_HEIGHT}px;object-fit:cover;display:block">${text}</section>`;
const page = (head: string, body: string) => `<!doctype html><html><head><style>body{margin:0}${head}</style></head><body>${body}</body></html>`;
const MISSING_FACE = `@font-face{font-family:"Missing Face";src:url("fonts/Missing.woff2") format("woff2")}`;
const IMAGE_PAGE = page(MISSING_FACE, `${artboard("Cover", "low", '<p style="position:absolute;top:0;font-family:\'Missing Face\',serif">Title</p>')}${artboard("Story", "high")}`);

let browser: Browser;
let base: string;
let counter = 0;
beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "bg-preflight-"));
  browser = await launchTestChromium(60_000);
}, 90_000);
afterAll(async () => { await browser.close(); await rm(base, { recursive: true, force: true }); });

/** Writes a fresh synthetic project and measures it in a real page. */
async function preflight(html: string, files: Readonly<Record<string, string>> = {}, withImages = true) {
  const root = path.join(base, `project-${counter += 1}`);
  await mkdir(path.join(root, "img"), { recursive: true });
  if (withImages) {
    for (const [name, width] of [["low", 600], ["high", 3000]] as const) {
      const canvas = createCanvas(width, Math.round(width * 1.4));
      const context = canvas.getContext("2d");
      context.fillStyle = "#888";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await writeFile(path.join(root, "img", `${name}.png`), canvas.toBuffer("image/png"));
    }
  }
  await writeFile(path.join(root, ENTRYPOINT), html);
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(root, name), content);
  const open = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await open.goto(pathToFileURL(path.join(root, ENTRYPOINT)).href, { waitUntil: "load" });
    return await assemblePrintPreflight(root, ENTRYPOINT, await measurePrintPage(open, new AbortController().signal), "usable");
  } finally { await open.close(); }
}

describe("print preflight measured in a real page", () => {
  test("Given two A4 artboards, When measured, Then both pages report millimetres and pixels", async () => {
    const report = await preflight(IMAGE_PAGE);
    expect(report.pages.map((entry) => entry.name)).toEqual(["Cover", "Story"]);
    expect(report.pages[0]?.width_px).toBe(A4_WIDTH);
    expect(report.pages[0]?.width_mm).toBeCloseTo(210, 0);
    expect(report.pages[0]?.height_mm).toBeCloseTo(297, 0);
  }, 60_000);

  test("Given a 600px image spanning an A4 artboard, When measured, Then it is a strong warning naming that artboard and locator", async () => {
    const low = (await preflight(IMAGE_PAGE)).images.find((image) => image.locator === "img#low");
    expect(low).toMatchObject({ page: 1, page_name: "Cover", intrinsic_width_px: 600, severity: "strong_warn" });
    expect(low?.effective_ppi).toBeLessThan(150);
  }, 60_000);

  test("Given a 3000px image spanning an A4 artboard, When measured, Then it carries no warning", async () => {
    const high = (await preflight(IMAGE_PAGE)).images.find((image) => image.locator === "img#high");
    expect(high).toMatchObject({ page: 2, page_name: "Story", severity: "ok" });
  }, 60_000);
});

describe("print preflight fonts", () => {
  test("Given text set in a family whose local file is absent and not bundled, When measured, Then it is listed missing by relative path", async () => {
    const report = await preflight(IMAGE_PAGE);
    expect(report.fonts).toContainEqual({ family: "Missing Face", status: "missing", path: "fonts/Missing.woff2", license_present: false });
  }, 60_000);

  test("Given a declared family that no text uses, When measured, Then it is not listed", async () => {
    const report = await preflight(page(MISSING_FACE, "<p>Plain text</p>"), {}, false);
    expect(report.fonts).toEqual([]);
  }, 60_000);

  test("Given a fonts.css that declares the whole bundled catalog and text in one bundled family, When measured, Then no font is missing", async () => {
    const catalog = await bundledFontStylesheet();
    const families = [...catalog.matchAll(/font-family\s*:\s*(['"]?)([^'";}]+)\1/giu)].map((match) => match[2]?.trim() ?? "");
    expect(new Set(families).size).toBeGreaterThan(20);
    const used = families[0] ?? "";
    const report = await preflight(
      `<!doctype html><html><head><link rel="stylesheet" href="fonts.css"></head><body><p style="font-family:'${used}',sans-serif">Hello</p></body></html>`,
      { "fonts.css": catalog },
      false,
    );
    expect(report.fonts.filter((font) => font.status === "missing")).toEqual([]);
    expect(report.fonts).toContainEqual({ family: used, status: "resolved", path: null, license_present: true });
  }, 60_000);
});
