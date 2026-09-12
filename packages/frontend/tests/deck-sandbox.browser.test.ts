import { expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "../../backend/node_modules/playwright-core";
import { Hono } from "../../backend/node_modules/hono";
import { createRequestAuthority } from "../../backend/src/security/request-authority";
import { DECK_STAGE_JS } from "../../backend/src/runtime/deck-stage";

declare global { var deckTest: {
  bootstrapApiAuthority(): Promise<void>;
  canvas(html: string, url: string): Promise<string>;
  present(src: string): Promise<void>;
  embedCanvasImages(html: string, url: string, signal: AbortSignal): Promise<string>;
}; var scriptAbort: AbortController }
const root = "/api/projects/deck-test/fs/";
const html = `<!doctype html><html><head>
<script>window.order=[];window.blobs=[];window.revoked=[];
const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=b=>{const u=create(b);blobs.push(u);return u};
URL.revokeObjectURL=u=>{revoked.push(u);revoke(u)};</script>
<script src="runtime/first.js" data-authored="retained"></script>
<script>order.push('inline:'+window.first);</script>
<script defer src="runtime/deferred.js"></script>
<script defer src="runtime/deck-stage.js"></script>
<style>[data-slide]{display:none}[data-slide][data-active]{display:block}.deck-notes{display:none}body[data-presenter] .deck-notes{display:block}</style>
</head><body><section data-slide><h1>ONE</h1><aside class="deck-notes">NOTES</aside></section><section data-slide><h1>TWO</h1></section>
<input id="input"><textarea></textarea><select><option>A</option></select><div contenteditable><span id="editable">edit</span></div>
<script>order.push('body');window.addEventListener('keydown',e=>{if(e.key==='Escape' && window.cancelEscape)e.preventDefault()});</script>
</body></html>`;

async function withBrowser(action: (page: Page, base: string, requests: { path: string; capability: string | null; status: number }[]) => Promise<void>) {
  const requests: { path: string; capability: string | null; status: number }[] = [];
  const app = new Hono();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => app.fetch(request) });
  const base = server.url.origin;
  app.use("/api/*", createRequestAuthority({ capability: "deck-private-test", appAuthority: server.url.host }));
  app.get("/", c => c.html("<!doctype html><html><body></body></html>"));
  app.get(`${root}deck.html`, c => c.html(html));
  app.get(`${root}runtime/:name`, c => {
    const name = c.req.param("name");
    if (name === "pending.js") return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("/* pending */")); } }), { headers: { "content-type": "application/javascript" } });
    if (name === "redirect.js") return c.redirect("/api/projects/other/fs/private.js");
    const scripts: Record<string, string> = {
      "first.js": "window.first=17;order.push('first:'+document.currentScript.dataset.authored);window.resource=new URL('../image.png',document.baseURI).href;window.literal='</script>';",
      "deferred.js": "order.push('defer:'+Boolean(document.querySelector('h1')));",
      "deck-stage.js": DECK_STAGE_JS,
      "not-js.txt": "window.unexpected=true",
    };
    const body = scripts[name];
    return body === undefined ? c.notFound() : new Response(body, { headers: { "content-type": name.endsWith(".txt") ? "text/plain" : "application/javascript" } });
  });
  server.reload({ fetch: async request => { const response = await app.fetch(request); if (new URL(request.url).pathname !== "/api/bootstrap") requests.push({ path: new URL(request.url).pathname, capability: request.headers.get("x-burnguard-capability"), status: response.status }); return response; } });
  let browser: Browser | undefined;
  try {
    const compiler = Bun.spawn([process.execPath, "build", `${import.meta.dir}/fixtures/deck-browser.tsx`, "--target=browser", "--format=iife", "--minify"], { stdout: "pipe", stderr: "pipe" });
    const [code, script, errors] = await Promise.all([compiler.exited, new Response(compiler.stdout).text(), new Response(compiler.stderr).text()]);
    if (code !== 0) throw new Error(errors);
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const browserErrors: string[] = [];
    page.on("pageerror", error => browserErrors.push(String(error)));
    await page.goto(base);
    await page.addScriptTag({ content: script });
    await page.evaluate(() => globalThis.deckTest.bootstrapApiAuthority());
    await action(page, base, requests);
    expect(browserErrors).toEqual([]);
  } finally { await browser?.close(); await server.stop(true); }
}

test("local authored scripts run in the opaque sandbox in parser/defer order, without authority leakage", async () => {
  await withBrowser(async (page, base, requests) => {
    const url = `${base}${root}deck.html`;
    const embedded = await page.evaluate(({ html, url }) => globalThis.deckTest.canvas(html, url), { html, url });
    const frame = page.frames().find(frame => frame.parentFrame());
    if (!frame) throw new Error("missing_frame");
    const result = await frame.evaluate(() => ({ ready: document.body.hasAttribute("data-deck-ready"), order: Reflect.get(window, "order"), blobs: Reflect.get(window, "blobs"), revoked: Reflect.get(window, "revoked"), resource: Reflect.get(window, "resource"), literal: Reflect.get(window, "literal"), origin: self.origin, runtime: Reflect.get(window, "__BURNGUARD_DECK_RUNTIME__"), parentAccess: (() => { try { return Boolean(parent.document); } catch { return false; } })() }));
    expect(result.ready).toBe(true);
    expect(result.order).toEqual(["first:retained", "inline:17", "body", "defer:true"]);
    expect(result.blobs).toHaveLength(3);
    expect(result.revoked.toSorted()).toEqual(result.blobs.toSorted());
    expect(result).toMatchObject({ origin: "null", parentAccess: false, literal: "</script>", resource: `${base}/api/projects/deck-test/image.png`, runtime: { version: 1, slideCount: 2 } });
    expect(embedded).not.toContain("deck-private-test");
    expect(requests.filter(request => request.path.includes("runtime/"))).toHaveLength(3);
    expect(requests.filter(request => request.path.includes("runtime/")).every(request => request.capability === "deck-private-test" && request.status === 200)).toBe(true);
    await frame.locator("[data-active] h1").click();
    await frame.locator("body").press("ArrowRight");
    expect(await frame.locator("[data-slide][data-active] h1").textContent()).toBe("TWO");
    await frame.getByRole("button", { name: "Previous slide" }).click();
    expect(await frame.locator("[data-slide][data-active] h1").textContent()).toBe("ONE");

    requests.length = 0;
    const boundary = await page.evaluate(async url => {
      const sources = ["../../other/fs/private.js", "/api/settings", "runtime%2fprivate.js", "https://external.invalid/private.js", "/api/projects/deck-test/preview/other/fs/private.js"];
      return globalThis.deckTest.embedCanvasImages(sources.map(src => `<script src="${src}"></script>`).join(""), url, new AbortController().signal);
    }, url);
    expect(boundary).toContain("private.js");
    expect(requests).toHaveLength(0);
    for (const name of ["missing.js", "redirect.js", "not-js.txt"]) {
      expect(await page.evaluate(async ({ url, name }) => {
        try { await globalThis.deckTest.embedCanvasImages(`<script src="runtime/${name}"></script>`, url, new AbortController().signal); return "resolved"; }
        catch { return "rejected"; }
      }, { url, name })).toBe("rejected");
    }
    expect(requests.some(request => request.path.includes("other/fs"))).toBe(false);
    const pending = page.waitForResponse(response => response.url().endsWith("pending.js"), { timeout: 10000 });
    const cancelled = page.evaluate(async url => {
      const global = globalThis; global.scriptAbort = new AbortController();
      try { await global.deckTest.embedCanvasImages('<script src="runtime/pending.js"></script>', url, global.scriptAbort.signal); return "resolved"; }
      catch (error) { if (!(error instanceof Error)) throw error; return error.name; }
    }, url);
    await pending;
    await page.evaluate(() => globalThis.scriptAbort.abort());
    expect(await cancelled).toBe("AbortError");
  });
}, 30000);

test("presentation loads runtime and notes, forwards focused page Escape but preserves authored input and composition", async () => {
  await withBrowser(async (page, base) => {
    await page.evaluate(src => globalThis.deckTest.present(src), `${base}${root}deck.html`);
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const frame = page.frameLocator("main iframe");
    await frame.locator("[data-slide] h1").first().waitFor();
    // Subscribe before dismissal: fullscreen exit is asynchronous and belongs to
    // this overlay, not the subsequent mount. This is page input, not OS Escape.
    const exited = page.evaluate(() => new Promise<void>((resolve, reject) => {
      if (!document.fullscreenElement) { resolve(); return; }
      const changed = () => {
        if (document.fullscreenElement) return;
        clearTimeout(timer); document.removeEventListener("fullscreenchange", changed); resolve();
      };
      const timer = setTimeout(() => { document.removeEventListener("fullscreenchange", changed); reject(new Error("fullscreen_exit_timeout")); }, 5000);
      document.addEventListener("fullscreenchange", changed);
    }));
    exited.catch(() => {});
    await frame.locator("body").press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 3000 });
    await exited;
    await page.evaluate(src => globalThis.deckTest.present(src), `${base}${root}deck.html`);
    await frame.locator("body[data-deck-ready][data-presenter]").waitFor();
    expect(await frame.locator(".deck-notes").isVisible()).toBe(true);
    for (const selector of ["input", "textarea", "select", "#editable"]) {
      await frame.locator(selector === "#editable" ? "[contenteditable]" : selector).focus();
      await page.keyboard.press("Escape");
      expect(await dialog.count()).toBe(1);
    }
    await frame.locator("body").evaluate(body => {
      body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true }));
      body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, repeat: true }));
      Reflect.set(window, "cancelEscape", true);
    });
    await frame.locator("body").evaluate(body => { body.tabIndex = -1; body.focus(); });
    await page.keyboard.press("Escape");
    expect(await dialog.count()).toBe(1);
    // Same envelope from a different source must never dismiss the overlay.
    await page.evaluate(() => window.postMessage({ __bgFrameBridge: true, type: "event", event: "present-dismiss", payload: { documentKey: "forged" } }, "*"));
    expect(await dialog.count()).toBe(1);
    await frame.locator("body").evaluate(() => Reflect.set(window, "cancelEscape", false));
    await frame.locator("body").press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 3000 });
  });
}, 30000);
