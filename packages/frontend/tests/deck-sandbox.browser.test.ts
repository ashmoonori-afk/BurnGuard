import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import type { Browser, BrowserContext, Page } from "../../backend/node_modules/playwright-core";
import { Hono } from "../../backend/node_modules/hono";
import { createRequestAuthority } from "../../backend/src/security/request-authority";
import { DECK_STAGE_JS } from "../../backend/src/runtime/deck-stage";
import { launchChromiumViaNode } from "../../backend/src/services/chromium-node-launch";
import { observeDeckEvents } from "./helpers/deck-event-trace";

declare global { var deckTest: {
  bootstrapApiAuthority(): Promise<void>;
  canvas(html: string, url: string): Promise<string>;
  present(src: string): Promise<void>;
  embedCanvasImages(html: string, url: string, signal: AbortSignal): Promise<string>;
}; var scriptAbort: AbortController; var presentationLoad: Promise<void> }
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

let suiteBrowser: Browser | undefined;
let fixtureScript: string;
const lifetime = new AbortController();

beforeAll(async () => {
  const compiler = Bun.spawn([process.execPath, "build", `${import.meta.dir}/fixtures/deck-browser.tsx`, "--target=browser", "--format=iife", "--minify"], { stdout: "pipe", stderr: "pipe" });
  const [code, script, errors] = await Promise.all([compiler.exited, new Response(compiler.stdout).text(), new Response(compiler.stderr).text()]);
  if (code !== 0) throw new Error(errors);
  fixtureScript = script;
  // The launch has its own deadline; the shared browser lives until suite teardown.
  suiteBrowser = await launchChromiumViaNode({}, lifetime.signal);
});

afterAll(async () => {
  try { await suiteBrowser?.close(); }
  finally { lifetime.abort(); }
});

async function withBrowser(action: (page: Page, base: string, requests: { path: string; capability: string | null; status: number }[], server: { stop(closeActiveConnections?: boolean): void | Promise<void> }) => Promise<void>, allowFullscreen = true) {
  const browser = suiteBrowser;
  if (!browser) throw new Error("browser_fixture_not_ready");
  const requests: { path: string; capability: string | null; status: number }[] = [];
  const app = new Hono();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => app.fetch(request) });
  const base = server.url.origin;
  app.use("/api/*", createRequestAuthority({ capability: "deck-private-test", bootstrapSecret: "deck-bootstrap-secret", appAuthority: server.url.host }));
  app.get("/", c => {
    if (!allowFullscreen) c.header("Permissions-Policy", "fullscreen=()");
    return c.html("<!doctype html><html><body></body></html>");
  });
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
  let context: BrowserContext | undefined;
  let trace: readonly string[] = [];
  try {
    // Use the shipped Node browser path for iframe/fullscreen lifecycle coverage.
    context = await browser.newContext();
    trace = await observeDeckEvents(context);
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const browserErrors: string[] = [];
    page.on("pageerror", error => browserErrors.push(String(error)));
    await page.goto(`${base}/#bg-bootstrap:deck-bootstrap-secret`);
    await page.addScriptTag({ content: fixtureScript });
    await page.evaluate(() => globalThis.deckTest.bootstrapApiAuthority());
    await page.evaluate(() => {
      const launch = document.createElement("button");
      launch.type = "button";
      launch.textContent = "Present test fixture";
      launch.addEventListener("click", () => { globalThis.presentationLoad = globalThis.deckTest.present("/api/projects/deck-test/fs/deck.html"); });
      document.body.appendChild(launch);
    });
    await action(page, base, requests, server);
    expect(browserErrors).toEqual([]);
  } catch (error) {
    console.error(JSON.stringify({ event: "deck_failure_trace", browser: browser.version(), trace }));
    throw error;
  } finally {
    try { await context?.close(); }
    finally { await server.stop(true); }
  }
}

function fullscreenState(page: Page, active: boolean): Promise<void> {
  const settled = page.evaluate(active => new Promise<void>((resolve, reject) => {
    if (Boolean(document.fullscreenElement) === active) { resolve(); return; }
    const changed = () => {
      if (Boolean(document.fullscreenElement) !== active) return;
      clearTimeout(timer); document.removeEventListener("fullscreenchange", changed); resolve();
    };
    const timer = setTimeout(() => { document.removeEventListener("fullscreenchange", changed); reject(new Error("fullscreen_state_timeout")); }, 5000);
    document.addEventListener("fullscreenchange", changed);
  }), active);
  settled.catch(() => {});
  return settled;
}

test("Given context cleanup rejects When the fixture closes Then its real server is still stopped", async () => {
  const failure = new Error("context_cleanup_failure");
  let cleanup: (() => Promise<void>) | undefined;
  let assertStopped: () => void = () => { throw new Error("server_not_observed"); };
  try {
    await expect(withBrowser(async (page, _base, _requests, server) => {
      const stopped = spyOn(server, "stop");
      cleanup = async () => { stopped.mockRestore(); await server.stop(true); };
      assertStopped = () => { expect(stopped).toHaveBeenCalledWith(true); };
      const context = page.context();
      const close = context.close.bind(context);
      context.close = async () => { await close(); throw failure; };
    })).rejects.toBe(failure);
    assertStopped();
  } finally { await cleanup?.(); }
});

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
    const previous = frame.getByRole("button", { name: "Previous slide" });
    const previousBox = await previous.boundingBox();
    if (previousBox === null) throw new Error("missing_previous_slide_bounds");
    await page.mouse.move(previousBox.x + previousBox.width / 2, previousBox.y + previousBox.height / 2);
    await previous.hover();
    await previous.click();
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

async function dismissPresentationWithEscape(page: Page): Promise<void> {
  // Escape removes its renderer; release the key only after owned teardown.
  // Keep the original five-second action budget and three-second dismissal bound.
  const escape = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("presentation_escape_deadline");
      escape.abort(error);
      reject(error);
    }, 5000);
  });
  try {
    await Promise.race([
      (async () => {
        await page.frameLocator("main iframe").locator("body").focus();
        escape.signal.throwIfAborted();
        const renderer = page.frames().find(candidate => candidate.parentFrame() === page.mainFrame());
        if (!renderer) throw new Error("presentation_frame_missing");
        const detached = page.waitForEvent("framedetached", { predicate: candidate => candidate === renderer, timeout: 3000 });
        detached.catch(() => undefined);
        await page.keyboard.down("Escape");
        escape.signal.throwIfAborted();
        await detached;
        escape.signal.throwIfAborted();
        await page.keyboard.up("Escape");
      })(),
      deadline,
    ]);
  } finally { clearTimeout(timer); }
}

function initialPresentationDocument(page: Page): Promise<boolean> {
  const published = page.evaluate(() => new Promise<boolean>((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const frame = document.querySelector("main iframe");
      if (!(frame instanceof HTMLIFrameElement)) return;
      clearTimeout(timer);
      observer.disconnect();
      resolve(Boolean(frame.srcdoc));
    });
    const timer = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error("presentation_publication_deadline"));
    }, 5000);
    observer.observe(document, { subtree: true, childList: true });
  }));
  published.catch(() => undefined);
  return published;
}

test("presentation remounts after its owned fullscreen exit and forwards focused page Escape", async () => {
  await withBrowser(async (page) => {
    const entered = fullscreenState(page, true);
    const initial = initialPresentationDocument(page);
    await page.getByRole("button", { name: "Present test fixture" }).click();
    expect(await initial).toBe(true);
    await page.evaluate(() => globalThis.presentationLoad);
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const frame = page.frameLocator("main iframe");
    await frame.locator("[data-slide] h1").first().waitFor();
    // Iframe load can precede fullscreen entry; settle this mount before dismissal.
    await entered;
    // Subscribe before dismissal: fullscreen exit belongs to this overlay.
    const exited = fullscreenState(page, false);
    await dismissPresentationWithEscape(page);
    await dialog.waitFor({ state: "hidden", timeout: 3000 });
    await exited;
    const reentered = fullscreenState(page, true);
    const remounted = initialPresentationDocument(page);
    await page.getByRole("button", { name: "Present test fixture" }).click();
    expect(await remounted).toBe(true);
    await page.evaluate(() => globalThis.presentationLoad);
    await frame.locator("body[data-deck-ready][data-presenter]").waitFor();
    await reentered;
    expect(await frame.locator(".deck-notes").isVisible()).toBe(true);
    const finalExit = fullscreenState(page, false);
    await dismissPresentationWithEscape(page);
    await dialog.waitFor({ state: "hidden", timeout: 3000 });
    await finalExit;
  });
}, 30000);

async function settleFrameMessages(page: Page): Promise<void> {
  const settled = page.evaluate(() => new Promise<void>((resolve, reject) => {
    const stop = () => { window.clearTimeout(timer); window.removeEventListener("message", listener); };
    const listener = (event: MessageEvent) => { if (event.data === "qa-input-fence") { stop(); resolve(); } };
    const timer = window.setTimeout(() => { stop(); reject(new Error("frame_message_fence_deadline")); }, 5000);
    window.addEventListener("message", listener);
  }));
  settled.catch(() => undefined);
  await page.frameLocator("main iframe").locator("body").evaluate(() => parent.postMessage("qa-input-fence", "*"));
  await settled;
}

test("presentation fullscreen fallback preserves authored input, composition and untrusted source isolation", async () => {
  await withBrowser(async (page) => {
    await page.evaluate(() => {
      let focusReturned = false;
      const focus = HTMLIFrameElement.prototype.focus;
      HTMLIFrameElement.prototype.focus = function(options) {
        focus.call(this, options);
        if (this.matches("main iframe") && this.srcdoc) focusReturned = true;
      };
      const present = globalThis.deckTest.present;
      globalThis.deckTest.present = src => present(src).then(() => {
        document.documentElement.dataset.qaPresentationFocusReady = String(focusReturned);
      });
    });
    await page.getByRole("button", { name: "Present test fixture" }).click();
    await page.evaluate(() => globalThis.presentationLoad);
    expect(await page.locator("html").getAttribute("data-qa-presentation-focus-ready")).toBe("true");
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const frame = page.frameLocator("main iframe");
    await frame.locator("body[data-deck-ready][data-presenter]").waitFor();
    expect(await page.evaluate(() => document.fullscreenEnabled)).toBe(false);
    expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    expect(await frame.locator(".deck-notes").isVisible()).toBe(true);
    // DOM focus alone does not establish the browser's native frame input owner.
    await frame.locator("input").click();
    for (const [index, selector] of ["input", "textarea", "select", "#editable"].entries()) {
      if (index > 0) await page.keyboard.press("Tab");
      const field = frame.locator(selector === "#editable" ? "[contenteditable]" : selector);
      expect(await field.evaluate(element => document.activeElement === element)).toBe(true);
      await field.evaluate(element => {
        element.addEventListener("keydown", event => {
          if (event instanceof KeyboardEvent && event.isTrusted && event.key === "Escape" && event.target === element) {
            element.setAttribute("data-qa-native-escape", "true");
          }
        }, { once: true });
      });
      await page.keyboard.press("Escape");
      await settleFrameMessages(page);
      expect(await field.getAttribute("data-qa-native-escape")).toBe("true");
      expect(await dialog.count()).toBe(1);
    }
    await frame.locator("body").evaluate(body => {
      body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true }));
      body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, repeat: true }));
      Reflect.set(window, "cancelEscape", true);
    });
    await frame.locator("body").evaluate(body => { body.tabIndex = -1; body.focus(); });
    await page.keyboard.press("Escape");
    await settleFrameMessages(page);
    expect(await dialog.count()).toBe(1);
    // Same envelope from a different source must never dismiss the overlay.
    await page.evaluate(() => window.postMessage({ __bgFrameBridge: true, type: "event", event: "present-dismiss", payload: { documentKey: "forged" } }, "*"));
    await settleFrameMessages(page);
    expect(await dialog.count()).toBe(1);
    await frame.locator("body").evaluate(() => Reflect.set(window, "cancelEscape", false));
    await dismissPresentationWithEscape(page);
    await dialog.waitFor({ state: "hidden", timeout: 3000 });
  }, false);
}, 30000);
