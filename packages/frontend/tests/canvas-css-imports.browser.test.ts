import { expect, test } from "bun:test";
import type { Browser, Page } from "../../backend/node_modules/playwright-core";
import { launchChromiumViaNode } from "../../backend/src/services/chromium-node-launch";

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
  const sharedFont = `/runtime/fonts/${"a".repeat(64)}/Figtree.woff2`;
  const requests: { path: string; capability: string | null }[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/") return new Response("<!doctype html><html><body></body></html>", { headers: { "content-type": "text/html" } });
    if (pathname === "/api/bootstrap") return Response.json({ data: { capability: "css-import-test" } });
    requests.push({ path: pathname, capability: request.headers.get("x-burnguard-capability") });
    if (pathname === sharedFont) return new Response(Bun.file(`${import.meta.dir}/../../../assets/fonts/Figtree.woff2`), { headers: { "content-type": "font/woff2" } });
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
    browser = await launchChromiumViaNode({ channel: "chrome" }, AbortSignal.timeout(30_000));
    const page = await browser.newPage();
    const external: string[] = [];
    await page.route("**/*", route => {
      if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    await page.goto(origin, { waitUntil: "load" });
    await page.addScriptTag({ content: script });
    await page.evaluate(() => globalThis.canvasCssTest.bootstrapApiAuthority());
    const sharedLoads = await page.evaluate(async ({ origin, sharedFont }) => {
      const html = `<style>@font-face{font-family:Shared;src:url('${sharedFont}')}</style>`;
      const render = (project: string) => globalThis.canvasCssTest.embedCanvasImages(html, `${origin}/api/projects/${project}/fs/index.html`, new AbortController().signal);
      const concurrent = await Promise.all([render("one"), render("two")]);
      const later = await render("three");
      return [...concurrent, later].every(result => result.includes("data:font/woff2;base64,"));
    }, { origin, sharedFont });
    expect(sharedLoads).toBe(true);
    expect(requests.filter(request => request.path === sharedFont)).toEqual([{ path: sharedFont, capability: null }]);
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
    expect(requests.filter(request => request.path !== sharedFont).every(request => request.capability === "css-import-test")).toBe(true);
    expect(external).toEqual([]);
  } finally {
    await browser?.close();
    await server.stop(true);
  }
}, 30_000);

/**
 * Serve one page of the Playwright-matched browser with the canvas bundle and an authorized API.
 * Launch through the Node bridge: an in-process launch under Bun stalls a later server's large bodies.
 */
async function withCanvasPage<T>(serve: (pathname: string) => Response | undefined, action: (page: Page, origin: string) => Promise<T>): Promise<T> {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/") return new Response("<!doctype html><html><body></body></html>", { headers: { "content-type": "text/html" } });
    if (pathname === "/api/bootstrap") return Response.json({ data: { capability: "css-import-test" } });
    return serve(pathname) ?? new Response("not found", { status: 404 });
  } });
  let browser: Browser | undefined;
  try {
    const compiler = Bun.spawn([process.execPath, "build", `${import.meta.dir}/fixtures/canvas-css-browser.ts`, "--target=browser", "--format=iife"], { stdout: "pipe", stderr: "pipe" });
    const [exitCode, script, errors] = await Promise.all([compiler.exited, new Response(compiler.stdout).text(), new Response(compiler.stderr).text()]);
    if (exitCode !== 0) throw new Error(`Browser test bundle failed (${exitCode}): ${errors}`);
    browser = await launchChromiumViaNode({}, AbortSignal.timeout(30_000));
    const page = await browser.newPage();
    await page.goto(server.url.origin, { waitUntil: "load" });
    await page.addScriptTag({ content: script });
    await page.evaluate(() => globalThis.canvasCssTest.bootstrapApiAuthority());
    return await action(page, server.url.origin);
  } finally {
    await browser?.close();
    await server.stop(true);
  }
}

test("Given a project document linking the real shared fonts.css When embedCanvasImages runs Then it resolves and every face is an embedded woff2", async () => {
  const fonts = `${import.meta.dir}/../../../assets/fonts`;
  // The same content-addressed rewrite every new project receives in fonts/fonts.css.
  const stylesheet = (await Bun.file(`${fonts}/fonts.css`).text()).replace(/url\('\.\/([^']+\.woff2)'\)/g, (_, name: string) => `url('/runtime/fonts/${"b".repeat(64)}/${name}')`);
  const faces = stylesheet.match(/url\(/g)?.length ?? 0;
  const result = await withCanvasPage(pathname => {
    if (pathname === "/api/projects/fonts/fs/fonts/fonts.css") return new Response(stylesheet, { headers: { "content-type": "text/css" } });
    const font = /^\/runtime\/fonts\/b{64}\/([A-Za-z0-9_.-]+\.woff2)$/.exec(pathname)?.[1];
    return font === undefined ? undefined : new Response(Bun.file(`${fonts}/${font}`), { headers: { "content-type": "font/woff2" } });
  }, (page, origin) => page.evaluate(async url => {
    try {
      const html = await globalThis.canvasCssTest.embedCanvasImages('<link rel="stylesheet" href="fonts/fonts.css">', url, new AbortController().signal);
      return { embedded: Array.from(html.matchAll(/url\("?([^"')]*)/g), match => match[1]!.startsWith("data:font/woff2;base64,")) };
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, `${origin}/api/projects/fonts/fs/index.html`));
  expect(faces).toBeGreaterThan(0);
  expect(result).toEqual({ embedded: Array.from({ length: faces }, () => true) });
}, 30_000);

test("Given images beyond the per-document byte budget When embedCanvasImages runs Then the document resolves with those images unembedded while stylesheet overruns stay fatal", async () => {
  const MiB = 1024 * 1024;
  const frames = Array.from({ length: 11 }, (_, index) => `assets/frame-${index}.png`);
  const sizes = new Map<string, number>([["assets/huge.png", 33 * MiB], ["assets/small.png", 1024], ["css/huge.css", 33 * MiB], ...frames.map(frame => [frame, 3 * MiB] as const)]);
  const result = await withCanvasPage(pathname => {
    const size = sizes.get(pathname.replace(/^\/api\/projects\/g\/fs\//, ""));
    return size === undefined ? undefined : new Response(new Uint8Array(size), { headers: { "content-type": pathname.endsWith(".css") ? "text/css" : "image/png" } });
  }, (page, origin) => page.evaluate(async ({ url, frames }) => {
    // Each image becomes its embedded byte length, or its original src when left unembedded.
    const embed = async (html: string) => {
      try {
        const embedded = new DOMParser().parseFromString(await globalThis.canvasCssTest.embedCanvasImages(html, url, new AbortController().signal), "text/html");
        return Array.from(embedded.images, image => {
          const src = image.getAttribute("src") ?? "";
          return src.startsWith("data:image/png;base64,") ? atob(src.slice("data:image/png;base64,".length)).length : src;
        });
      } catch (error) { return error instanceof Error ? error.message : String(error); }
    };
    return {
      single: await embed('<img src="assets/huge.png"><img src="assets/small.png">'),
      frames: await embed(frames.map(src => `<img src="${src}">`).join("")),
      stylesheet: await embed('<link rel="stylesheet" href="css/huge.css">'),
    };
  }, { url: `${origin}/api/projects/g/fs/index.html`, frames }));
  expect(result.single).toEqual(["assets/huge.png", 1024]);
  if (!Array.isArray(result.frames)) throw new Error(`Frame document rejected: ${result.frames}`);
  const outcomes = result.frames;
  const embedded = outcomes.filter(outcome => outcome === 3 * MiB).length;
  expect(outcomes.every((outcome, index) => outcome === 3 * MiB || outcome === frames[index])).toBe(true);
  expect(embedded).toBeLessThan(frames.length);
  expect(embedded * 3 * MiB).toBeLessThanOrEqual(32 * MiB);
  expect(result.stylesheet).toBe("artifact_image_limit");
}, 30_000);
