import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createCanvas } from "@napi-rs/canvas";
import type { Browser } from "playwright-core";
import { measurePrintPage } from "../src/services/print-preflight-service";
import { summarizeImages } from "../src/services/print-preflight";
import { launchTestChromium } from "./helpers/chromium";

let browser: Browser;
const lowCanvas = createCanvas(600, 840);
const low = lowCanvas.toDataURL("image/png");
const high = createCanvas(3000, 4200).toDataURL("image/png");
beforeAll(async () => { browser = await launchTestChromium(60_000); }, 90_000);
afterAll(async () => { await browser?.close(); });

async function measure(body: string, css = "") {
  const page = await browser.newPage();
  try {
    await page.route("https://fixture.test/style.css", route => route.fulfill({ contentType: "text/css", body: css }));
    await page.route("https://fixture.test/photo.png", route => route.fulfill({ contentType: "image/png", body: lowCanvas.toBuffer("image/png") }));
    await page.setContent(`<link rel="stylesheet" href="https://fixture.test/style.css"><section data-graphic-artboard data-name="Cover" style="width:794px;height:1123px">${body}</section>`, { waitUntil: "load" });
    const measured = await measurePrintPage(page, new AbortController().signal);
    return summarizeImages(measured.pages, measured.images);
  } finally { await page.close(); }
}

describe("rendered print backgrounds", () => {
  test("Given an inline background, When measured, Then its element box determines the warning", async () => {
    const images = await measure(`<div id="photo" style="width:794px;height:1123px;background-image:url('${low}')"></div>`);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ page_name: "Cover", intrinsic_width_px: 600, severity: "strong_warn" });
    expect(images[0]?.locator).toContain("#photo");
  });

  test("Given stylesheet shorthand and layered backgrounds, When measured, Then each rendered URL is checked", async () => {
    const images = await measure('<div id="photo"></div>', `#photo{width:794px;height:1123px;background:linear-gradient(transparent,black),url("${low}"),url("${high}")}`);
    expect(images.map(image => image.severity)).toEqual(["strong_warn", "ok"]);
    expect(images.map(image => image.intrinsic_width_px)).toEqual([600, 3000]);
  });

  test("Given hidden backgrounds and an artboard background, When measured, Then only the rendered artboard is included", async () => {
    const images = await measure(`<div style="display:none;width:794px;height:1123px;background:url('${low}')"></div>`, `[data-graphic-artboard]{background-image:url("${high}")}`);
    expect(images).toHaveLength(1);
    expect(images[0]?.intrinsic_width_px).toBe(3000);
  });

  test("Given a stylesheet-relative background URL, When measured, Then the browser-resolved image pixels are used", async () => {
    const images = await measure('<div id="photo"></div>', '#photo{width:794px;height:1123px;background-image:url("photo.png")}');
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ intrinsic_width_px: 600, severity: "strong_warn" });
  });

  test("Given a print-only background, When measured, Then print media rather than screen styles is used", async () => {
    const images = await measure('<div id="photo"></div>', `#photo{width:794px;height:1123px}@media print{#photo{background-image:url("${low}")}}`);
    expect(images).toHaveLength(1);
    expect(images[0]?.severity).toBe("strong_warn");
  });
});
