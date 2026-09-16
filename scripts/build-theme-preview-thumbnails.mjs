#!/usr/bin/env node
// After `bun run previews`, run `node scripts/build-theme-preview-thumbnails.mjs`.
// Node is required: Chromium must never run on Bun's event loop on Windows.
// These committed thumbnails are direct browser captures, not resized hero images.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundledDesignSystems } from "../packages/backend/src/data/bundled-design-systems.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previews = path.join(root, "design system themes/previews");
const output = path.join(previews, "thumbnails");
const slides = process.argv.includes("--slides");
const evidence = path.join(root, ".omo/evidence", slides ? "bundled-slide-previews" : "bundled-website-previews");
const viewport = slides ? { width: 1280, height: 720 } : { width: 1440, height: 960 };
const quality = 70;
const relative = (file) => path.relative(root, file).replaceAll(path.sep, "/");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = async (file) => ({ path: relative(file), sha256: digest(await readFile(file)) });
const { chromium } = await import(pathToFileURL(path.join(root, "packages/backend/node_modules/playwright-core/index.mjs")).href);

async function bounded(work, label) {
  let timer;
  try {
    return await Promise.race([
      work(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: readiness deadline exceeded`)), 45_000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const fontsRoot = path.join(root, "assets/fonts");
const fonts = await Promise.all((await readdir(fontsRoot)).filter((name) => /\.(?:css|woff2?)$/.test(name)).sort().map((name) => source(path.join(fontsRoot, name))));
const browser = await chromium.launch({ channel: process.env.BG_BROWSER_CHANNEL ?? "chrome", headless: true, timeout: 30_000 });
const captures = [];
try {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce", serviceWorkers: "block" });
  const external = [];
  await context.route(/^https?:\/\//, async (route) => {
    external.push(route.request().url());
    await route.abort("blockedbyclient");
  });
  for (const { slug } of bundledDesignSystems) {
    await bounded(async () => {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", () => errors.push("pageerror"));
      page.on("console", (message) => { if (message.type() === "error") errors.push("console error"); });
      page.on("requestfailed", () => errors.push("request failed"));
      try {
        const html = path.join(previews, slides ? "slides" : "", `${slug}.html`);
        await page.goto(pathToFileURL(html).href, { waitUntil: "load", timeout: 30_000 });
        if (slides) await page.addStyleTag({ content: ".intro,.rules,.sheet:not(:has(.cover)){display:none!important}.sheet{margin:0!important}" });
        const ready = await page.evaluate(async () => {
          // Decode every image, including images whose lazy loading starts below the viewport.
          await Promise.all([...document.images].map(async (image) => { image.loading = "eager"; await image.decode(); }));
          await document.fonts.ready;
          return {
            fonts: [...document.fonts].filter((font) => font.status === "loaded").map((font) => font.family),
            fontErrors: [...document.fonts].filter((font) => font.status === "error").length,
            images: [...document.images].map((image) => ({ url: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight })),
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        assert.ok(ready.fonts.length > 0, `${slug}: local fonts not loaded`);
        assert.equal(ready.fontErrors, 0, `${slug}: font load failed`);
        assert.ok((slides || ready.images.length > 0) && ready.images.every((image) => image.width > 0 && image.height > 0), `${slug}: image missing`);
        assert.equal(ready.overflow, false, `${slug}: horizontal overflow`);
        assert.equal(errors.length, 0, `${slug}: ${errors.join(", ")}`);
        assert.equal(external.length, 0, `${slug}: external resource requested`);
        const images = await Promise.all(ready.images.map(async ({ url, width, height }) => {
          const file = fileURLToPath(url);
          const within = path.relative(path.join(previews, "media"), file);
          assert.ok(within && !within.startsWith("..") && !path.isAbsolute(within), `${slug}: image outside preview media`);
          return { ...await source(file), width, height };
        }));
        const session = await context.newCDPSession(page);
        const screenshot = await session.send("Page.captureScreenshot", { format: "webp", quality, captureBeyondViewport: false });
        await session.detach();
        const dimensions = await page.evaluate(async (data) => {
          const image = new Image();
          image.src = `data:image/webp;base64,${data}`;
          await image.decode();
          return { width: image.naturalWidth, height: image.naturalHeight };
        }, screenshot.data);
        assert.deepEqual(dimensions, viewport, `${slug}: unexpected screenshot dimensions`);
        const bytes = Buffer.from(screenshot.data, "base64");
        captures.push({ slug, bytes, receipt: { slug, ...dimensions, bytes: bytes.length, sha256: digest(bytes), html: await source(html), images, loadedFonts: [...new Set(ready.fonts)].sort(), errors: 0 } });
      } finally {
        await page.close();
      }
    }, slug);
  }
  assert.equal(captures.length, bundledDesignSystems.length);
  await mkdir(output, { recursive: true });
  await mkdir(evidence, { recursive: true });
  await Promise.all(captures.map(({ slug, bytes }) => writeFile(path.join(output, `${slides ? "slides-" : ""}${slug}.webp`), bytes)));
  await writeFile(path.join(evidence, "thumbnail-captures.json"), JSON.stringify({ schema: 1, browser: browser.version(), viewport, quality, externalRequests: external.length, fonts, captures: captures.map(({ receipt }) => receipt) }, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ captured: captures.length, bytes: captures.reduce((total, capture) => total + capture.bytes.length, 0), viewport, externalRequests: external.length }) + "\n");
} finally {
  await browser.close();
}
