import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import type { Browser } from "playwright-core";
import { launchChromium } from "../src/services/export-render-session";
import { assemblePrintPreflight, measurePrintPage } from "../src/services/print-preflight-service";

// A4 at 96 dpi is 793.7 x 1122.5 CSS px; two artboards, one holding a 600px-wide image and one a 3000px-wide image.
const A4_WIDTH = 794;
const A4_HEIGHT = 1123;
const ENTRYPOINT = "index.html";
const artboard = (name: string, image: string) =>
  `<section data-graphic-artboard data-name="${name}" style="position:relative;width:${A4_WIDTH}px;height:${A4_HEIGHT}px;overflow:hidden"><img id="${image}" src="img/${image}.png" style="width:${A4_WIDTH}px;height:${A4_HEIGHT}px;object-fit:cover;display:block"></section>`;
const HTML = `<!doctype html><html><head><style>@font-face{font-family:"Missing Face";src:url("fonts/Missing.woff2") format("woff2")}body{margin:0}</style></head><body>${artboard("Cover", "low")}${artboard("Story", "high")}</body></html>`;

let browser: Browser;
let root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "bg-preflight-"));
  await mkdir(path.join(root, "img"));
  for (const [name, width] of [["low", 600], ["high", 3000]] as const) {
    const canvas = createCanvas(width, Math.round(width * 1.4));
    const context = canvas.getContext("2d");
    context.fillStyle = "#888";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await writeFile(path.join(root, "img", `${name}.png`), canvas.toBuffer("image/png"));
  }
  await writeFile(path.join(root, ENTRYPOINT), HTML);
  browser = await launchChromium(AbortSignal.timeout(45_000));
}, 60_000);
afterAll(async () => { await browser.close(); await rm(root, { recursive: true, force: true }); });

async function preflight() {
  const open = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await open.goto(pathToFileURL(path.join(root, ENTRYPOINT)).href, { waitUntil: "load" });
    return await assemblePrintPreflight(root, ENTRYPOINT, await measurePrintPage(open, new AbortController().signal), "usable");
  } finally { await open.close(); }
}

describe("print preflight measured in a real page", () => {
  test("Given two A4 artboards, When measured, Then both pages report millimetres and pixels", async () => {
    const report = await preflight();
    expect(report.pages.map((page) => page.name)).toEqual(["Cover", "Story"]);
    expect(report.pages[0]?.width_px).toBe(A4_WIDTH);
    expect(report.pages[0]?.width_mm).toBeCloseTo(210, 0);
    expect(report.pages[0]?.height_mm).toBeCloseTo(297, 0);
  }, 60_000);

  test("Given a 600px image spanning an A4 artboard, When measured, Then it is a strong warning naming that artboard and locator", async () => {
    const low = (await preflight()).images.find((image) => image.locator === "img#low");
    expect(low).toMatchObject({ page: 1, page_name: "Cover", intrinsic_width_px: 600, severity: "strong_warn" });
    expect(low?.effective_ppi).toBeLessThan(150);
  }, 60_000);

  test("Given a 3000px image spanning an A4 artboard, When measured, Then it carries no warning", async () => {
    const high = (await preflight()).images.find((image) => image.locator === "img#high");
    expect(high).toMatchObject({ page: 2, page_name: "Story", severity: "ok" });
  }, 60_000);

  test("Given a @font-face pointing at a file that is not in the project, When measured, Then the font is listed missing by relative path", async () => {
    const report = await preflight();
    expect(report.fonts).toContainEqual({ family: "Missing Face", status: "missing", path: "fonts/Missing.woff2", license_present: false });
  }, 60_000);
});
