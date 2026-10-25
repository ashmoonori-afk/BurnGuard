import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserContext } from "../../backend/node_modules/playwright-core";
import { launchChromiumViaNode } from "../../backend/src/services/chromium-node-launch";
import { messages } from "../src/i18n/messages";
import type {} from "./fixtures/workspace-controls-browser";

const frontend = path.resolve(import.meta.dir, "..");
const builtAssets = path.join(frontend, "dist/assets");
const sourceFont = path.resolve(import.meta.dir, "../../../assets/fonts/PretendardVariable.woff2");
const assets = new Map<string, Uint8Array>();
let browser: Browser | undefined;
let script = "";
let css = "";
let fontDigest = "";
const lifetime = new AbortController();

beforeAll(async () => {
  const compiler = Bun.spawn([process.execPath, "build", path.join(import.meta.dir, "fixtures/workspace-controls-browser.tsx"), "--target=browser", "--format=iife"], {
    cwd: frontend, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => compiler.kill(), 30_000);
  const [code, output, errors] = await Promise.all([
    compiler.exited, new Response(compiler.stdout).text(), new Response(compiler.stderr).text(),
  ]).finally(() => clearTimeout(timer));
  if (code !== 0) throw new Error(`app_font_fixture_compile_failed: ${errors}`);
  script = output;
  for (const name of await readdir(builtAssets)) {
    const bytes = await readFile(path.join(builtAssets, name));
    assets.set(`/assets/${name}`, bytes);
    if (name.endsWith(".css")) css += new TextDecoder().decode(bytes);
  }
  fontDigest = createHash("sha256").update(await readFile(sourceFont)).digest("hex");
  browser = await launchChromiumViaNode({}, lifetime.signal);
}, 60_000);

afterAll(async () => {
  try { await browser?.close(); }
  finally { lifetime.abort(); }
});

for (const width of [390, 1440]) {
  for (const locale of ["en", "ko"] as const) {
    test(`Given the built app stylesheet at ${width}px in ${locale} When controls render offline Then their variable font loads from the shipped local bytes`, async () => {
      if (!browser) throw new Error("app_font_browser_missing");
      const external: string[] = [];
      const server = Bun.serve({
        hostname: "127.0.0.1", port: 0,
        fetch(request) {
          const pathname = new URL(request.url).pathname;
          if (pathname === "/") return new Response('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>', { headers: { "content-type": "text/html; charset=utf-8" } });
          if (pathname === "/app.css") return new Response(css, { headers: { "content-type": "text/css" } });
          if (pathname === "/fixture.js") return new Response(script, { headers: { "content-type": "text/javascript; charset=utf-8" } });
          const bytes = assets.get(pathname);
          if (bytes) return new Response(new Uint8Array(bytes).buffer, { headers: { "content-type": pathname.endsWith(".woff2") ? "font/woff2" : "application/octet-stream" } });
          if (pathname === "/api/bootstrap") return Response.json({ data: { capability: "app-font-fixture" } });
          if (pathname === "/api/projects/workspace-controls/exports") return Response.json({ data: [] });
          if (pathname === "/api/projects/workspace-controls/instructions") return Response.json({ data: { text: null } });
          return new Response(null, { status: 404 });
        },
      });
      let context: BrowserContext | undefined;
      try {
        context = await browser.newContext({ viewport: { width, height: 900 } });
        await context.route("**/*", async route => {
          if (new URL(route.request().url()).origin === server.url.origin) await route.continue();
          else { external.push(route.request().url()); await route.abort(); }
        });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        const fontResponse = page.waitForResponse(response => response.request().resourceType() === "font");
        fontResponse.catch(() => undefined);
        await page.goto(server.url.href);
        await page.evaluate(async locale => {
          document.documentElement.lang = locale;
          await globalThis.workspaceControlsTest.mount(locale);
        }, locale);
        const loaded = await page.evaluate(async () => (await document.fonts.load('16px "Pretendard Variable"', "\uD55C\uAE00 Export")).map(face => ({
          family: face.family.replaceAll('"', "").replaceAll("'", ""),
          status: face.status, style: face.style, weight: face.weight, display: face.display,
        })));
        expect(loaded).toEqual([{ family: "Pretendard Variable", status: "loaded", style: "normal", weight: "45 930", display: "swap" }]);
        const response = await fontResponse;
        expect(response.ok()).toBe(true);
        expect(new URL(response.url()).origin).toBe(server.url.origin);
        expect(createHash("sha256").update(await response.body()).digest("hex")).toBe(fontDigest);
        expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily.split(",")[0]?.replaceAll('"', "").trim())).toBe("Pretendard Variable");
        expect(external).toEqual([]);
        const label = await page.evaluate(() => globalThis.workspaceControlsTest.labels().export);
        expect(label).toBe(messages["export.title"][locale]);
        const bounds = await page.getByRole("button", { name: label, exact: true }).boundingBox();
        if (bounds === null) throw new Error("app_font_export_bounds_missing");
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      } finally {
        try { await context?.close(); }
        finally { await server.stop(true); }
      }
    }, 30_000);
  }
}
