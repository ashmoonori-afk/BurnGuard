import { expect, test } from "bun:test";
import { type Browser, chromium } from "../../backend/node_modules/playwright-core";

declare global { var canvasCssTest: {
  bootstrapApiAuthority(): Promise<void>;
  embedCanvasImages(html: string, url: string, signal: AbortSignal): Promise<string>;
  buildSandboxedArtifactSrcDoc(html: string, url: string): string;
}; var cssImportAbort: AbortController }

test("imported project styles render nested CSS inside the real opaque canvas sandbox", async () => {
  const root = "/api/projects/css-import/fs/";
  // Same encoded nested stylesheet and border sentinel as full-project-imports.mjs.
  const files = new Map<string, { body: BodyInit; type: string }>([
    ["css/site style.css", { type: "text/css", body: '@import url("nested/theme%20tokens.css"); body{background-image:url("../images/brand%20mark.svg")} #import-heading{color:rgb(18,52,86)}' }],
    ["css/nested/theme tokens.css", { type: "text/css", body: "#import-heading{border-top:3px solid rgb(18,52,86)}" }],
    ["images/brand mark.svg", { type: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="#abcdef"/></svg>' }],
  ]);
  for (const [name, body] of Object.entries({
    "css/conditions.css": `@layer first, second;
      @import "nested/first.css" layer(first) supports(display: grid) screen;
      @import "nested/second.css" layer(second);
      @import "nested/shared.css" layer(first);
      @import "nested/shared.css" layer(second);
      @import "nested/print.css" print;
      @import "nested/anonymous.css" layer;
      @import "nested/unsupported.css" supports(not (display: grid));
      @import "nested/selector.css" supports(selector(h1));
      @import "nested/compound.css" supports((display: grid) and (color: red));
      @import "nested/cycle.css";
      @import "nested/unicode\\20 name.css";
      @import "https://external.invalid/private.css";
      @import "/api/settings";
      @import "../../../../two/fs/private.css";
      @import "nested%2fprivate.css";
      @import "/api/projects/css-import/preview/other/fs/private.css";
      /* @import "comment.css"; */
      #probe{font-family:"Import Font"}
      #probe::before{content:'@import "string.css";'}
      #probe::after{content:"</style><script>window.injected=1</script>"}`,
    "css/nested/first.css": '#probe{color:rgb(1,2,3)!important;--cascade:first}',
    "css/nested/second.css": '#probe{color:rgb(4,5,6)!important;--cascade:second}',
    "css/nested/shared.css": '@font-face{font-family:"Import Font";src:url("../../fonts/Figtree.woff2")}#probe{background-image:url("../../images/brand%20mark.svg");--shared:loaded}',
    "css/nested/print.css": "#probe{border-left:11px solid}",
    "css/nested/anonymous.css": "#probe{border-right:5px solid}",
    "css/nested/unsupported.css": "#probe{outline:19px solid}",
    "css/nested/selector.css": "#probe{padding-top:7px}",
    "css/nested/compound.css": "#probe{padding-bottom:8px}",
    "css/nested/cycle.css": '@import "../conditions.css#cycle";#probe{border-bottom:9px solid}',
    "css/nested/unicode name.css": "#probe{padding-left:6px}",
    "css/nested/inline.css": "#probe{margin-left:13px}",
    "css/linked-print.css": "#probe{margin-right:17px}",
    "css/cancel.css": '@import "pending.css";',
    "css/limit.css": '@import "nested/shared.css";'.repeat(65),
    "css/preview.css": '@import "missing.css";#probe{border-top:4px solid}',
    "css/mime.css": '@import "not-css.txt";#probe{border-top:4px solid}',
  })) files.set(name, { body, type: "text/css" });
  files.set("css/not-css.txt", { body: "#probe{color:red}", type: "text/plain" });
  files.set("fonts/Figtree.woff2", { body: Bun.file(`${import.meta.dir}/../../../assets/fonts/Figtree.woff2`), type: "font/woff2" });
  const previewRoot = "/api/projects/css-import/preview/draft/fs/";
  const requests: { path: string; capability: string | null }[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/") return new Response("<!doctype html><html><body></body></html>", { headers: { "content-type": "text/html" } });
    if (pathname === "/api/bootstrap") return Response.json({ data: { capability: "css-import-test" } });
    requests.push({ path: pathname, capability: request.headers.get("x-burnguard-capability") });
    const prefix = [root, previewRoot].find(prefix => pathname.startsWith(prefix));
    const relative = prefix ? decodeURIComponent(pathname.slice(prefix.length)) : undefined;
    if (relative === "css/pending.css") return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("/* pending */")); } }), { headers: { "content-type": "text/css" } });
    const asset = relative ? files.get(relative) : undefined;
    if (!asset || request.headers.get("x-burnguard-capability") !== "css-import-test") return new Response("not found", { status: 404 });
    return new Response(asset.body, { headers: { "content-type": asset.type } });
  } });
  const origin = server.url.origin;
  let browser: Browser | undefined;
  try {
    // Bun 1.3.14 can reuse an invalid file descriptor across in-process builds.
    // Isolate compilation, not the browser assertions or application modules.
    const compiler = Bun.spawn([
      process.execPath, "build", `${import.meta.dir}/fixtures/canvas-css-browser.ts`,
      "--target=browser", "--format=iife",
    ], {
      stdout: "pipe", stderr: "pipe",
    });
    const [exitCode, script, errors] = await Promise.all([
      compiler.exited,
      new Response(compiler.stdout).text(),
      new Response(compiler.stderr).text(),
    ]);
    if (exitCode !== 0) throw new Error(`Browser test bundle failed (${exitCode}): ${errors}`);
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage();
    const external: string[] = [];
    await page.route("**/*", route => {
      if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    await page.goto(origin, { waitUntil: "load" });
    await page.addScriptTag({ content: script });
    await page.evaluate(() => globalThis.canvasCssTest.bootstrapApiAuthority());
    const mount = async (input: string, documentRoot = root) => {
      const embedded = await page.evaluate(async ({ input, url }) => {
        const api = globalThis.canvasCssTest;
        const html = await api.embedCanvasImages(input, url, new AbortController().signal);
        document.querySelector("iframe")?.remove();
        await new Promise<void>((resolve, reject) => {
          const frame = document.createElement("iframe");
          frame.setAttribute("sandbox", "allow-scripts allow-popups");
          const timeout = setTimeout(() => reject(new Error("Canvas load timed out")), 10_000);
          frame.addEventListener("load", () => { clearTimeout(timeout); resolve(); }, { once: true });
          frame.srcdoc = api.buildSandboxedArtifactSrcDoc(html, url);
          document.body.append(frame);
        });
        return html;
      }, { input, url: `${origin}${documentRoot}index.html` });
      const frame = page.frames().find(frame => frame.parentFrame() !== null);
      if (!frame) throw new Error("Loaded canvas frame missing");
      return { embedded, frame };
    };
    const { embedded, frame } = await mount('<!doctype html><html><head><link rel="stylesheet" href="css/site%20style.css"></head><body><h1 id="import-heading">BG_IMPORT_HEADING_SENTINEL</h1></body></html>');
    const rendered = await frame.locator("#import-heading").evaluate(heading => ({
      border: getComputedStyle(heading).borderTopWidth, color: getComputedStyle(heading).color,
      background: getComputedStyle(document.body).backgroundImage,
    }));
    console.log(JSON.stringify({ rendered, requests }));
    expect(rendered.border).toBe("3px");
    expect(rendered.color).toBe("rgb(18, 52, 86)");
    expect(requests.map(request => request.path)).toContain(`${root}css/nested/theme%20tokens.css`);
    expect(embedded).toContain("data:image/svg+xml;base64,");
    const backgroundUrl: unknown = JSON.parse(rendered.background.slice(4, -1));
    if (typeof backgroundUrl !== "string") throw new Error("Background URL missing");
    expect(atob(backgroundUrl.split(",")[1] ?? "")).toBe(files.get("images/brand mark.svg")?.body);

    requests.length = 0;
    const conditional = await mount('<html><head><link rel="stylesheet" href="css/conditions.css"><link rel="stylesheet" href="css/linked-print.css" media="print"><style>@import "css/nested/inline.css" screen;</style></head><body><h1 id="probe">Imported font</h1></body></html>');
    const state = await conditional.frame.locator("#probe").evaluate(async probe => {
      const fonts = await document.fonts.load('16px "Import Font"');
      const css = getComputedStyle(probe);
      return { color: css.color, cascade: css.getPropertyValue("--cascade").trim(), shared: css.getPropertyValue("--shared").trim(),
        borders: [css.borderLeftWidth, css.borderRightWidth, css.borderBottomWidth], outline: css.outlineStyle,
        padding: [css.paddingTop, css.paddingBottom, css.paddingLeft], margins: [css.marginLeft, css.marginRight],
        fonts: fonts.map(font => font.status), before: getComputedStyle(probe, "::before").content,
        after: getComputedStyle(probe, "::after").content, injected: "injected" in window,
      };
    });
    expect(state).toMatchObject({ color: "rgb(1, 2, 3)", cascade: "second", shared: "loaded", borders: ["0px", "5px", "9px"], outline: "none", padding: ["7px", "8px", "6px"], margins: ["13px", "0px"], injected: false });
    expect(state.fonts.length).toBeGreaterThan(0);
    expect(state.fonts.every(status => status === "loaded")).toBe(true);
    expect(state.before).toContain("@import");
    expect(state.after).toContain("</style><script>");
    expect(requests.filter(request => request.path === `${root}css/nested/shared.css`)).toHaveLength(1);
    expect(requests.filter(request => request.path === `${root}css/conditions.css`)).toHaveLength(1);
    expect(requests.some(request => /private|settings|comment\.css|string\.css/.test(request.path))).toBe(false);
    expect(requests.map(request => request.path)).toContain(`${root}fonts/Figtree.woff2`);
    await page.emulateMedia({ media: "print" });
    expect(await conditional.frame.locator("#probe").evaluate(probe => ({ border: getComputedStyle(probe).borderLeftWidth, margin: getComputedStyle(probe).marginRight }))).toEqual({ border: "11px", margin: "17px" });
    await page.emulateMedia({ media: "screen" });

    for (const [file, documentRoot] of [["preview", previewRoot], ["mime", root]]) {
      const result = await mount(`<html><head><link rel="stylesheet" href="css/${file}.css"></head><body><h1 id="probe">Fallback</h1></body></html>`, documentRoot);
      expect(await result.frame.locator("#probe").evaluate(probe => getComputedStyle(probe).borderTopWidth)).toBe("4px");
    }
    const failure = (file: string) => page.evaluate(async ({ file, url }) => {
      try { await globalThis.canvasCssTest.embedCanvasImages(`<link rel="stylesheet" href="css/${file}.css">`, url, new AbortController().signal); return "resolved"; }
      catch (error) { if (!(error instanceof Error)) throw error; return error.message; }
    }, { file, url: `${origin}${root}index.html` });
    expect(await failure("preview")).toBe("artifact_image_load_failed");
    expect(await failure("limit")).toBe("artifact_image_limit");

    const pendingResponse = page.waitForResponse(response => response.url() === `${origin}${root}css/pending.css`, { timeout: 10_000 });
    const cancelled = page.evaluate(async url => {
      const test = globalThis;
      test.cssImportAbort = new AbortController();
      try { await test.canvasCssTest.embedCanvasImages('<link rel="stylesheet" href="css/cancel.css">', url, test.cssImportAbort.signal); return "resolved"; }
      catch (error) { if (!(error instanceof Error)) throw error; return error.name; }
    }, `${origin}${root}index.html`);
    await pendingResponse;
    await page.evaluate(() => globalThis.cssImportAbort.abort());
    expect(await cancelled).toBe("AbortError");
    expect(requests.every(request => request.capability === "css-import-test")).toBe(true);
    expect(external).toEqual([]);
  } finally {
    await browser?.close();
    await server.stop(true);
  }
}, 30_000);
