import { afterAll, beforeAll, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser, Frame, Page } from "playwright-core";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir } from "../src/lib/paths";
import { createApp } from "../src/server";
import { analyzeLocalTree } from "../src/services/extraction-local-tree";
import { persistCanonicalExtraction, upsertDesignSystemColorToken, uploadDesignSystemFont } from "../src/services/design-system-extract";
import { reserveExtractionBundle, validateExtractionBundle } from "../src/services/extraction-publication";
import { launchChromium } from "../src/services/export-render-session";

const id = `canonical-preview-render-${process.pid}`;
const root = path.join(systemsDir, id);
let browser: Browser;
let server: ReturnType<typeof Bun.serve>;
let origin: string;
let page: Page;
let version = 0;
const failures: string[] = [];
const responses = new Map<string, { status: number; type: string }>();

beforeAll(async () => {
  const source = await mkdtemp(path.join(tmpdir(), "bg-preview-source-"));
  try {
    const analysis = await analyzeLocalTree(source, "Preview fixture", new AbortController().signal);
    await persistCanonicalExtraction({ requestedId: id, brandName: "Preview fixture", sourceType: "upload", sourceReference: "fixture.pdf", lineage: null, analysis, signal: new AbortController().signal });
  } finally { await rm(source, { recursive: true, force: true }); }
  await writeFile(path.join(root, "preview", "custom.html"), '<!doctype html><style>body{margin:7px;font-family:serif;color:rgb(11,22,33)}</style><p id="authored">Custom</p>');
  let app: ReturnType<typeof createApp>;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => {
    if (new URL(request.url).pathname === "/preview-test") return new Response('<!doctype html><html><body></body></html>', { headers: { "Content-Type": "text/html" } });
    return app.fetch(request);
  } });
  origin = `http://127.0.0.1:${server.port}`;
  app = createApp({ capability: "canonical-preview-test", appAuthority: new URL(origin).host });
  browser = await launchChromium(AbortSignal.timeout(60_000));
  page = await browser.newPage();
  page.on("requestfailed", request => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("console", message => { if (message.type() === "error") failures.push(message.text()); });
  page.on("response", response => responses.set(new URL(response.url()).pathname, { status: response.status(), type: response.headers()["content-type"] ?? "" }));
  await page.goto(`${origin}/preview-test`, { waitUntil: "load" });
  expect(await page.evaluate(async () => (await fetch("/api/bootstrap")).status)).toBe(200);
}, 60_000);

afterAll(async () => {
  try { await browser?.close(); }
  finally {
    await server?.stop(true);
    getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(id);
    await rm(root, { recursive: true, force: true });
  }
});

async function preview(file: string, systemId = id): Promise<Frame> {
  // Match PreviewIframe's sandbox, URL and fixed height; subscribe before navigation.
  const url = `${origin}/api/design-systems/${systemId}/files/preview/${file}.html?v=${++version}`;
  await page.evaluate(url => new Promise<void>((resolve, reject) => {
    document.querySelector("iframe")?.remove();
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.style.cssText = "height:320px;width:400px";
    frame.referrerPolicy = "no-referrer";
    const timer = setTimeout(() => reject(new Error("Preview load deadline exceeded")), 10_000);
    frame.addEventListener("load", () => { clearTimeout(timer); resolve(); }, { once: true });
    frame.src = url;
    document.body.append(frame);
  }), url);
  const frame = page.frames().find(candidate => candidate.url() === url);
  if (!frame) throw new Error("Loaded preview frame missing");
  return frame;
}

test("saved custom and canonical colors render after refresh without changing preview content or sizing", async () => {
  const original = await readFile(path.join(root, "preview", "colors-brand.html"), "utf8");
  const before = await preview("colors-brand");
  const geometry = await before.locator(".frame").evaluate(element => ({ padding: getComputedStyle(document.body).padding, minHeight: getComputedStyle(element).minHeight }));
  for (const value of ["#123abc", "#654321"]) {
    await upsertDesignSystemColorToken(id, { name: "catalog-accent", value });
    await upsertDesignSystemColorToken(id, { name: "primary-blue", value });
    const frame = await preview("colors-brand");
    const state = await frame.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.backgroundColor = "var(--catalog-accent)";
      document.body.append(probe);
      const swatch = document.querySelector(".swatch");
      const container = document.querySelector(".frame");
      if (!swatch || !container) throw new Error("Canonical preview structure missing");
      return { token: getComputedStyle(document.documentElement).getPropertyValue("--catalog-accent").trim(), customColor: getComputedStyle(probe).backgroundColor, swatch: getComputedStyle(swatch).backgroundColor, padding: getComputedStyle(document.body).padding, minHeight: getComputedStyle(container).minHeight };
    });
    expect(state.token).toBe(value);
    expect(state.customColor).toBe(value === "#123abc" ? "rgb(18, 58, 188)" : "rgb(101, 67, 33)");
    expect(state.swatch).toBe(state.customColor);
    expect({ padding: state.padding, minHeight: state.minHeight }).toEqual(geometry);
  }
  expect(await readFile(path.join(root, "preview", "colors-brand.html"), "utf8")).toBe(original);
  expect(responses.get(`/api/design-systems/${id}/files/colors_and_type.css`)).toEqual({ status: 200, type: "text/css; charset=utf-8" });
  expect(failures).toEqual([]);
});

test("corrupt fonts cannot overwrite an existing font, stylesheet or role token", async () => {
  const bytes = await readFile(path.resolve(import.meta.dir, "../../../assets/fonts/Figtree.woff2"));
  await uploadDesignSystemFont({ systemId: id, file: new File([bytes], "existing-check.woff2"), family: "Existing font", role: "sans" });
  const paths = [path.join(root, "fonts", "existing-check.woff2"), path.join(root, "fonts", "fonts.css"), path.join(root, "colors_and_type.css")];
  const before = await Promise.all(paths.map((file) => readFile(file)));
  const corruptHeader = Buffer.alloc(64);
  corruptHeader.write("wOF2");
  for (const corrupt of [Buffer.from("invalid fixture bytes"), corruptHeader]) {
    await expect(uploadDesignSystemFont({
      systemId: id, file: new File([corrupt], "existing-check.woff2"), family: "Corrupt font", role: "sans",
    })).rejects.toMatchObject({ code: "invalid_font_upload" });
    expect(await Promise.all(paths.map((file) => readFile(file)))).toEqual(before);
  }
});

test("all uploaded font roles resolve through authenticated relative CSS and real font bytes", async () => {
  const fonts = { sans: "Figtree", display: "PlayfairDisplay", serif: "Newsreader", mono: "GeistMono" } as const;
  for (const role of ["sans", "display", "serif", "mono"] as const) {
    const bytes = await readFile(path.resolve(import.meta.dir, `../../../assets/fonts/${fonts[role]}.woff2`));
    await uploadDesignSystemFont({ systemId: id, file: new File([bytes], `${fonts[role]}.woff2`), family: `Catalog ${role}`, role });
  }
  const frame = await preview("type-body");
  const state = await frame.evaluate(async () => {
    const roles = [];
    for (const role of ["sans", "display", "serif", "mono"]) {
      const probe = document.createElement("span");
      probe.textContent = "Font probe";
      probe.style.fontFamily = `var(--font-${role})`;
      document.body.append(probe);
      const faces = await document.fonts.load(`16px "Catalog ${role}"`);
      roles.push({ role, token: getComputedStyle(document.documentElement).getPropertyValue(`--font-${role}`).trim(), family: getComputedStyle(probe).fontFamily, statuses: faces.map(face => face.status) });
    }
    await document.fonts.ready;
    return { roles, body: getComputedStyle(document.body).fontFamily };
  });
  for (const result of state.roles) {
    expect(result.token).toContain(`"Catalog ${result.role}"`);
    expect(result.family).toContain(`"Catalog ${result.role}"`);
    expect(result.statuses).toEqual(["loaded"]);
  }
  expect(state.body).toContain('"Catalog sans"');
  const display = await preview("type-display");
  expect(await display.locator(".title").evaluate(element => getComputedStyle(element).fontFamily)).toContain('"Catalog display"');
  for (const font of Object.values(fonts)) expect(responses.get(`/api/design-systems/${id}/files/fonts/${font}.woff2`)).toEqual({ status: 200, type: "font/woff2" });
  expect(failures).toEqual([]);
}, 30_000);

test("token updates leave user-authored preview bytes and styles intact and raw routes remain authorized", async () => {
  const original = await readFile(path.join(root, "preview", "custom.html"), "utf8");
  await upsertDesignSystemColorToken(id, { name: "fg-1", value: "#abcdef" });
  const frame = await preview("custom");
  expect(await frame.evaluate(() => ({ color: getComputedStyle(document.body).color, margin: getComputedStyle(document.body).margin, family: getComputedStyle(document.body).fontFamily }))).toEqual({ color: "rgb(11, 22, 33)", margin: "7px", family: "serif" });
  expect(await readFile(path.join(root, "preview", "custom.html"), "utf8")).toBe(original);
  const base = `${origin}/api/design-systems/${id}/files/`;
  for (const file of ["preview/type-body.html", "colors_and_type.css", "fonts/fonts.css", "fonts/Figtree.woff2"]) expect((await fetch(`${base}${file}`)).status).toBe(403);
  expect(failures).toEqual([]);
});

test("source-derived swatches retain their original colors and render saved alias edits", async () => {
  const source = await mkdtemp(path.join(tmpdir(), "bg-preview-colors-"));
  const sourceId = `${id}-source`;
  try {
    await writeFile(path.join(source, "tokens.css"), ".swatch{color:#2468ac}");
    const analysis = await analyzeLocalTree(source, "Source colors", new AbortController().signal);
    await persistCanonicalExtraction({ requestedId: sourceId, brandName: "Source colors", sourceType: "upload", sourceReference: "fixture.pdf", lineage: null, analysis, signal: new AbortController().signal });
    const initial = await preview("colors-brand", sourceId);
    expect(await initial.locator(".swatch").first().evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(36, 104, 172)");
    await upsertDesignSystemColorToken(sourceId, { name: "src-color-1", value: "#654321" });
    const updated = await preview("colors-brand", sourceId);
    expect(await updated.locator(".swatch").first().evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(101, 67, 33)");
    expect(failures).toEqual([]);
  } finally {
    getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(sourceId);
    await rm(path.join(systemsDir, sourceId), { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});

test("publication allows only the exact local preview token link and retains source markup protections", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bg-preview-publication-"));
  try {
    const reservation = await reserveExtractionBundle(directory, "preview-links");
    await cp(root, reservation.stagingDir, { recursive: true });
    await rm(path.join(reservation.stagingDir, "preview", "custom.html"));
    await validateExtractionBundle(reservation);
    for (const [file, link] of [
      ["preview/probe.html", '<link rel="stylesheet" href="https://evil.test/style.css">'],
      ["preview/probe.html", '<link rel="stylesheet" href="//evil.test/style.css">'],
      ["preview/probe.html", '<link rel="stylesheet" href="../../colors_and_type.css">'],
      ["preview/probe.html", '<link rel="stylesheet" href="../colors_and_type.css" onload="alert(1)">'],
      ["preview/probe.html", '<link rel="stylesheet" href="../colors_and_type.css"><script>alert(1)</script>'],
      ["ui_kits/website/probe.html", '<link rel="stylesheet" href="../colors_and_type.css">'],
    ] as const) {
      const target = path.join(reservation.stagingDir, file);
      await writeFile(target, `<html><head>${link}</head><body></body></html>`);
      await expect(validateExtractionBundle(reservation)).rejects.toMatchObject({ code: "unsafe_source_content" });
      await rm(target);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
