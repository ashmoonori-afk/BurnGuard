import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "../../backend/node_modules/playwright-core";
import { Hono } from "../../backend/node_modules/hono";
import { createRequestAuthority } from "../../backend/src/security/request-authority";
import { DECK_STAGE_JS } from "../../backend/src/runtime/deck-stage";
import { chromiumNodeCommand, launchChromiumViaNode } from "../../backend/src/services/chromium-node-launch";
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
let protocolDirectory: string | undefined;
const lifetime = new AbortController();

beforeAll(async () => {
  const compiler = Bun.spawn([process.execPath, "build", `${import.meta.dir}/fixtures/deck-browser.tsx`, "--target=browser", "--format=iife", "--minify"], { stdout: "pipe", stderr: "pipe" });
  const [code, script, errors] = await Promise.all([compiler.exited, new Response(compiler.stdout).text(), new Response(compiler.stderr).text()]);
  if (code !== 0) throw new Error(errors);
  fixtureScript = script;
  const appRoot = process.env.BG_APP_ROOT;
  if (!appRoot) throw new Error("deck_test_profile_missing");
  const directory = await mkdtemp(path.join(appRoot, "deck-protocol-"));
  protocolDirectory = directory;
  const command = chromiumNodeCommand();
  // The launch has its own deadline; the shared browser lives until suite teardown.
  suiteBrowser = await launchChromiumViaNode({}, lifetime.signal, command === null ? null : {
    ...command,
    script: fileURLToPath(new URL("../../backend/tests/fixtures/deck-node-protocol.mjs", import.meta.url)),
    cwd: directory,
  });
});

afterAll(async () => {
  try { await suiteBrowser?.close(); }
  finally {
    lifetime.abort();
    if (protocolDirectory !== undefined) await rm(protocolDirectory, { recursive: true, force: true });
  }
});

const protocolEvents = new Set([
  "Page.frameAttached", "Page.frameDetached", "Page.frameNavigated",
  "Page.frameStartedLoading", "Page.frameStoppedLoading", "Page.lifecycleEvent",
  "Target.attachedToTarget", "Target.detachedFromTarget",
]);
const protocolKeyTypes = new Set(["keyDown", "keyUp", "rawKeyDown", "char"]);
const protocolCounter = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Project fields again at the file boundary; never print an arbitrary parsed object. */
function protocolRecord(value: unknown): object | null {
  if (value === null || typeof value !== "object"
    || !("seq" in value) || !protocolCounter(value.seq)
    || !("elapsed_ms" in value) || !protocolCounter(value.elapsed_ms)
    || !("launch" in value) || !protocolCounter(value.launch)
    || !("kind" in value) || !("method" in value) || typeof value.method !== "string") return null;
  const common = { seq: value.seq, elapsed_ms: value.elapsed_ms, launch: value.launch };
  switch (value.kind) {
    case "event":
      return protocolEvents.has(value.method) ? { ...common, kind: "event", method: value.method } : null;
    case "send":
    case "receive": {
      if (!("id" in value) || !protocolCounter(value.id) || value.id === 0) return null;
      let input: { readonly type: string; readonly isEscape: boolean } | undefined;
      switch (value.method) {
        case "Input.dispatchKeyEvent":
          if (!("type" in value) || typeof value.type !== "string" || !protocolKeyTypes.has(value.type)
            || !("isEscape" in value) || typeof value.isEscape !== "boolean") return null;
          input = { type: value.type, isEscape: value.isEscape };
          break;
        case "Page.enable":
          break;
        default:
          return null;
      }
      const command = { ...common, kind: value.kind, id: value.id, method: value.method, ...input };
      if (value.kind === "send") return command;
      return "error" in value && typeof value.error === "boolean" ? { ...command, error: value.error } : null;
    }
    default:
      return null;
  }
}

async function readDeckProtocolTrace() {
  const unavailable = { state: "unavailable" } as const;
  if (protocolDirectory === undefined) return unavailable;
  try {
    // A bounded disk read still works when the browser action/transport is stuck.
    const text = await Bun.file(path.join(protocolDirectory, "deck-node-protocol.json")).slice(0, 262_145).text();
    if (text.length > 262_144) return unavailable;
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object"
      || !("records" in value) || !Array.isArray(value.records) || value.records.length > 256
      || !("pending" in value) || !Array.isArray(value.pending) || value.pending.length > 256
      || !("pendingOverflow" in value) || !protocolCounter(value.pendingOverflow)
      || !("oversizedMessages" in value) || !protocolCounter(value.oversizedMessages)) return unavailable;
    const records = value.records.map(protocolRecord);
    const pending = value.pending.map(protocolRecord);
    if (records.includes(null) || pending.includes(null)) return unavailable;
    return { state: "read", records, pending, pendingOverflow: value.pendingOverflow, oversizedMessages: value.oversizedMessages };
  } catch {
    // Missing, partial or unreadable diagnostics never replace the original failure or its cleanup.
    return unavailable;
  }
}

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
    const protocol = await readDeckProtocolTrace();
    console.error(JSON.stringify({ event: "deck_failure_trace", browser: browser.version(), trace, protocol }));
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

test("presentation remounts after its owned fullscreen exit and forwards focused page Escape", async () => {
  await withBrowser(async (page) => {
    const entered = fullscreenState(page, true);
    await page.getByRole("button", { name: "Present test fixture" }).click();
    await page.evaluate(() => globalThis.presentationLoad);
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const frame = page.frameLocator("main iframe");
    await frame.locator("[data-slide] h1").first().waitFor();
    // Iframe load can precede fullscreen entry; settle this mount before dismissal.
    await entered;
    // Subscribe before dismissal: fullscreen exit belongs to this overlay.
    const exited = fullscreenState(page, false);
    await frame.locator("body").press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 3000 });
    await exited;
    const reentered = fullscreenState(page, true);
    await page.getByRole("button", { name: "Present test fixture" }).click();
    await page.evaluate(() => globalThis.presentationLoad);
    await frame.locator("body[data-deck-ready][data-presenter]").waitFor();
    await reentered;
    expect(await frame.locator(".deck-notes").isVisible()).toBe(true);
    const finalExit = fullscreenState(page, false);
    await frame.locator("body").press("Escape");
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
    await page.getByRole("button", { name: "Present test fixture" }).click();
    await page.evaluate(() => globalThis.presentationLoad);
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const frame = page.frameLocator("main iframe");
    await frame.locator("body[data-deck-ready][data-presenter]").waitFor();
    expect(await page.evaluate(() => document.fullscreenEnabled)).toBe(false);
    expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    expect(await frame.locator(".deck-notes").isVisible()).toBe(true);
    for (const selector of ["input", "textarea", "select", "#editable"]) {
      await frame.locator(selector === "#editable" ? "[contenteditable]" : selector).focus();
      await page.keyboard.press("Escape");
      await settleFrameMessages(page);
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
          await frame.locator("body").focus();
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
    await dialog.waitFor({ state: "hidden", timeout: 3000 });
  }, false);
}, 30000);
