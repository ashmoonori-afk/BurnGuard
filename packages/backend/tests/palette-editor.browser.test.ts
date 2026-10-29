import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser, Page } from "../node_modules/playwright-core";
import { emitPaletteCss, parseSaveDesignSystemPaletteRequest, serializePalette, type PaletteState, type SaveDesignSystemPaletteRequest } from "@bg/shared/palette";
import { UpgradeContractError } from "@bg/shared/contract-parser";
import { launchChromiumViaNode } from "../src/services/chromium-node-launch";

declare global { var paletteStateWait: Promise<void> | undefined }

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("PALETTE_EVENT_DEADLINE")), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}

async function armState(page: Page, state: string): Promise<void> {
  await page.evaluate(state => {
    globalThis.paletteStateWait = new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(check);
      const timer = setTimeout(() => { observer.disconnect(); reject(new Error("PALETTE_STATE_DEADLINE")); }, 10_000);
      function check() {
        if (document.querySelector("#system-palette [data-palette-state]")?.getAttribute("data-palette-state") !== state) return;
        observer.disconnect();
        clearTimeout(timer);
        resolve();
      }
      observer.observe(document.body, { subtree: true, childList: true, attributes: true });
      check();
    });
  }, state);
}

async function settleState(page: Page): Promise<void> {
  await page.evaluate(() => globalThis.paletteStateWait);
}

const action = (name: string) => `#system-palette [data-palette-action="${name}"]`;
const input = (suffix: string) => `#system-palette input[id$="-${suffix}"]`;

async function edit(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).fill(value);
  await page.locator(selector).press("Tab");
}

test("Given the real palette workspace When inputs, history, saves and conflicts run Then numeric drafts and committed authority remain distinct", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-palette-editor-"));
  const entry = path.resolve(import.meta.dir, "../../frontend/tests/fixtures/palette-editor-browser.tsx");
  let browser: Browser | undefined;
  const stored: { state: PaletteState | null; revision: number } = { state: null, revision: 0 };
  let hold: ReturnType<typeof deferred<void>> | null = null;
  let seen: ReturnType<typeof deferred<SaveDesignSystemPaletteRequest>> | null = null;
  const gates: ReturnType<typeof deferred<void>>[] = [];
  const requests: SaveDesignSystemPaletteRequest[] = [];
  const digest = () => new Bun.CryptoHasher("sha256").update(JSON.stringify([stored.revision, stored.state])).digest("hex");
  const response = () => Response.json({ data: {
    state: stored.state, css: stored.state === null ? null : emitPaletteCss(stored.state),
    expected_digest: digest(), content_revision: stored.revision, receipt_id: stored.state === null ? null : `fixture-${stored.revision}`,
  } }, { headers: { "Cache-Control": "no-store" } });
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/") return new Response('<div id="root"></div><script src="/fixture.js"></script>', { headers: { "Content-Type": "text/html" } });
      if (url.pathname === "/fixture.js") return new Response(Bun.file(path.join(root, "palette-editor-browser.js")), { headers: { "Content-Type": "application/javascript" } });
      if (url.pathname === "/api/bootstrap") return Response.json({ data: { capability: "palette-editor-test" } });
      if (url.pathname !== "/api/design-systems/palette-editor/palette") return new Response(null, { status: 404 });
      if (request.headers.get("x-burnguard-capability") !== "palette-editor-test") return new Response(null, { status: 403 });
      if (request.method === "GET") return response();
      if (request.method !== "PUT") return new Response(null, { status: 405 });
      let parsed: SaveDesignSystemPaletteRequest;
      try { parsed = parseSaveDesignSystemPaletteRequest(await request.json()); }
      catch (error) {
        if (!(error instanceof UpgradeContractError) && !(error instanceof SyntaxError)) throw error;
        return Response.json({ error: { code: "invalid_palette", message: "INVALID_FIXTURE_INPUT" } }, { status: 400 });
      }
      requests.push(parsed);
      const gate = hold;
      hold = null;
      seen?.resolve(parsed);
      if (gate) await gate.promise;
      if (parsed.expected_digest !== digest()) return Response.json({ error: {
        code: "expected_digest_conflict", message: "STALE_FIXTURE_HEAD",
      } }, { status: 412 });
      stored.state = parsed.state;
      stored.revision += 1;
      return response();
    },
  });
  try {
    const compiler = Bun.spawn([process.execPath, "build", entry, "--target=browser", "--format=iife", "--outdir", root], { stdout: "pipe", stderr: "pipe" });
    const compileDeadline = setTimeout(() => compiler.kill(), 15_000);
    const [exit, output, errors] = await Promise.all([compiler.exited, new Response(compiler.stdout).text(), new Response(compiler.stderr).text()]);
    clearTimeout(compileDeadline);
    expect({ exit, errors: exit === 0 ? "" : errors + output }).toEqual({ exit: 0, errors: "" });
    const abort = new AbortController();
    const launchDeadline = setTimeout(() => abort.abort(new Error("PALETTE_BROWSER_DEADLINE")), 20_000);
    try { browser = await launchChromiumViaNode({}, abort.signal); }
    finally { clearTimeout(launchDeadline); }
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(server.url.href);
    await armState(page, "dirty");
    await settleState(page);

    await edit(page, input("stop-position"), "0.070123456");
    expect(await page.locator(input("stop-position")).inputValue()).toBe("0.070123456");
    expect(await page.locator(input("range-start")).inputValue()).toBe("0.070123456");
    await page.locator(action("add-anchor")).click();
    const red = '#system-palette input[id*="-anchor-r-"]';
    await edit(page, red, "0.1234567890123");
    await page.locator('#system-palette select[id*="-anchor-space-"]').selectOption("display-p3");
    await armState(page, "saved");
    await page.locator(action("save")).click();
    await settleState(page);
    expect(requests.at(-1)?.state.stops[0]?.position).toBe(0.070123456);
    expect(requests.at(-1)?.state.anchors[0]?.color).toEqual({ space: "display-p3", r: 0.1234567890123, g: 0.36, b: 0.84 });
    await page.locator(red).focus();
    await page.locator(red).press("Tab");
    expect(await page.locator("[data-palette-state]").getAttribute("data-palette-state")).toBe("saved");
    expect(await page.locator(action("save")).isDisabled()).toBe(true);

    await edit(page, input("curve-amount"), "24");
    await edit(page, input("curve-amount"), "");
    expect(await page.locator(input("curve-amount")).getAttribute("aria-invalid")).toBe("true");
    expect(await page.locator('#system-palette input[type="range"]:has(+ input[id$="-curve-amount"])').inputValue()).toBe("24");
    expect(await page.locator(action("save")).isDisabled()).toBe(true);
    await page.locator(action("dismiss-validation")).click();
    expect(await page.locator(action("save")).isDisabled()).toBe(true);
    expect(requests).toHaveLength(1);
    await armState(page, "saved");
    await page.locator(action("undo")).click();
    await settleState(page);
    expect(await page.locator(input("curve-amount")).inputValue()).toBe("20");
    expect(await page.locator(input("curve-amount")).getAttribute("aria-invalid")).toBe("false");
    await armState(page, "dirty");
    await page.locator(action("redo")).click();
    await settleState(page);
    expect(await page.locator(input("curve-amount")).inputValue()).toBe("24");
    await armState(page, "saved");
    await page.locator(action("undo")).click();
    await settleState(page);

    await edit(page, input("curve-amount"), "30");
    hold = deferred<void>();
    gates.push(hold);
    seen = deferred<SaveDesignSystemPaletteRequest>();
    const blocked = hold;
    await armState(page, "saving");
    await page.locator(action("save")).click();
    await settleState(page);
    expect((await bounded(seen.promise)).state.curve.amount).toBe(0.3);
    await edit(page, input("curve-amount"), "40");
    await armState(page, "dirty");
    blocked.resolve();
    await settleState(page);
    expect(stored.state?.curve.amount).toBe(0.3);
    expect(await page.locator(input("curve-amount")).inputValue()).toBe("40");
    await armState(page, "saved");
    await page.locator(action("save")).click();
    await settleState(page);
    expect(stored.state?.curve.amount).toBe(0.4);
    expect(requests).toHaveLength(3);
    expect(requests[2]?.expected_digest).not.toBe(requests[1]?.expected_digest);

    await edit(page, input("curve-amount"), "50");
    const prior = requests.at(-1)?.state;
    if (prior === undefined) throw new Error("PALETTE_SAVED_STATE");
    stored.state = { ...prior, curve: { ...prior.curve, amount: 0.6 } };
    stored.revision += 1;
    await armState(page, "unavailable");
    await page.locator(action("save")).click();
    await settleState(page);
    expect(await page.locator(input("curve-amount")).inputValue()).toBe("50");
    expect(await page.locator(action("save")).isDisabled()).toBe(true);
    await armState(page, "saved");
    await page.locator(action("reload")).click();
    await settleState(page);
    expect(await page.locator(input("curve-amount")).inputValue()).toBe("60");
    expect(serializePalette(stored.state)).toBe(serializePalette({ ...prior, curve: { ...prior.curve, amount: 0.6 } }));
  } finally {
    for (const gate of gates) gate.resolve();
    await browser?.close();
    await server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
