import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { chromium } from "./playwright-runtime";
import { resolveWithin } from "../security/path-boundary";
import { isChromiumLaunchable } from "./chromium-capability";
import { registerExportBrowser } from "./export-browser-registry";
import { chromiumNodeCommand, launchChromiumViaNode } from "./chromium-node-launch";
import { DECK_STAGE_JS } from "../runtime/deck-stage";

export type RenderViewport = { readonly width: number; readonly height: number; readonly dpr: 1 | 2 };
export type RenderFinding = { readonly code: "console_error" | "page_error" | "request_failed" | "remote_request" | "font_error"; readonly path: string | null };
export type RenderSession = { readonly browser: Browser; readonly context: BrowserContext; readonly page: Page; readonly findings: readonly RenderFinding[]; readonly close: () => Promise<void> };
export type RenderPhase = "browser_ready" | "navigated" | "content_ready";

export class RenderSessionError extends Error {
  readonly name = "RenderSessionError";
  constructor(readonly code: "chromium_not_installed" | "chromium_launch_timeout" | "render_failed" | "deck_not_ready" | "render_aborted", message: string, readonly findings: readonly RenderFinding[] = []) { super(message); }
}

export async function openRenderSession(input: { readonly stagedDir: string; readonly entrypoint: string; readonly viewport: RenderViewport; readonly deck: boolean; readonly signal: AbortSignal; readonly strict?: boolean; readonly browser?: Browser; readonly onPhase?: (phase: RenderPhase) => void }): Promise<RenderSession> {
  if (input.signal.aborted) throw new RenderSessionError("render_aborted", "Render was cancelled");
  const browser = input.browser ?? await launchChromium(input.signal);
  let context: BrowserContext | null = null;
  const owner = input.browser === undefined ? registerExportBrowser(() => browser.close()) : { close: async () => { await context?.close(); } };
  const findings: RenderFinding[] = []; let abort: (() => void) | null = null;
  try {
    context = await browser.newContext({ viewport: { width: input.viewport.width, height: input.viewport.height }, deviceScaleFactor: input.viewport.dpr }); const page = await context.newPage();
    page.on("console", (message) => { if (message.type() === "error") findings.push({ code: "console_error", path: message.text() }); });
    page.on("pageerror", (error) => findings.push({ code: "page_error", path: error.message })); page.on("requestfailed", (request) => { const url = new URL(request.url()); findings.push({ code: "request_failed", path: url.protocol === "file:" ? safeFileFinding(url, input.stagedDir) : sanitizeUrl(url) }); });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (input.deck && url.protocol === "file:" && /^(?:\/[a-z]:)?\/runtime\/deck-stage\.js$/i.test(url.pathname)) { await route.fulfill({ contentType: "application/javascript", body: DECK_STAGE_JS }); return; }
      if (url.protocol === "data:") { await route.continue(); return; }
      if (url.protocol === "file:") {
        try { resolveWithin(input.stagedDir, path.relative(input.stagedDir, fileURLToPath(url))); await route.continue(); return; }
        catch { findings.push({ code: "remote_request", path: "file:outside-artifact" }); }
      } else findings.push({ code: "remote_request", path: sanitizeUrl(url) });
      await route.abort("blockedbyclient");
    });
    abort = (): void => { void owner.close(); }; input.signal.addEventListener("abort", abort, { once: true }); input.onPhase?.("browser_ready");
    const htmlPath = resolveWithin(input.stagedDir, input.entrypoint); await page.goto(`${pathToFileURL(htmlPath)}${input.deck ? "?print=1" : ""}`, { waitUntil: "load", timeout: 30_000 }); input.onPhase?.("navigated");
    await page.evaluate(async () => { if (document.readyState !== "complete") await new Promise<void>((resolve) => addEventListener("load", () => resolve(), { once: true })); await document.fonts.ready; });
    const state = await page.evaluate(() => {
      const fonts = [...document.fonts].filter((font) => font.status === "error").map((font) => font.family); const slides = [...document.querySelectorAll<HTMLElement>("[data-slide]")]; const sentinel = Reflect.get(globalThis, "__BURNGUARD_DECK_RUNTIME__"); const owned = typeof sentinel === "object" && sentinel !== null && Reflect.get(sentinel, "version") === 1 && Reflect.get(sentinel, "slideCount") === slides.length;
      const geometry = slides.every((slide) => { const previous = slide.style.cssText; slide.style.setProperty("display", "block", "important"); const rect = slide.getBoundingClientRect(); slide.style.cssText = previous; return Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0; }); return { fonts, slideCount: slides.length, owned, geometry };
    });
    for (const font of state.fonts) findings.push({ code: "font_error", path: font });
    if (input.deck && (state.slideCount === 0 || !state.owned || !state.geometry)) throw new RenderSessionError("deck_not_ready", "Owned deck runtime did not produce finite slide geometry", findings);
    if ((input.strict ?? true) && findings.length > 0) throw new RenderSessionError("render_failed", "Render emitted browser errors", findings); input.onPhase?.("content_ready"); let closed = false;
    return { browser, context, page, findings, close: async () => { if (closed) return; closed = true; if (abort !== null) input.signal.removeEventListener("abort", abort); await owner.close(); } };
  } catch (error) {
    if (abort !== null) input.signal.removeEventListener("abort", abort); try { await owner.close(); } catch (closeError) { throw new AggregateError([error, closeError], "Render failed and Chromium cleanup failed"); }
    if (input.signal.aborted) throw new RenderSessionError("render_aborted", "Render was cancelled", findings); if (error instanceof RenderSessionError) throw error; throw new RenderSessionError("render_failed", error instanceof Error ? error.message : String(error), findings);
  }
}

/** Bun's in-process launch (seen on Windows and macOS) can start Chromium yet never complete the Playwright handshake or resolve browser.close(), so every attempt is capped. */
export const CHROMIUM_LAUNCH_TIMEOUT_MS = 20_000;
type ChromiumLaunchAttempt = { readonly headless: true; readonly channel?: string };
export type ChromiumLauncher = (options: ChromiumLaunchAttempt) => Promise<Browser>;
type LaunchOutcome = { readonly kind: "browser"; readonly browser: Browser } | { readonly kind: "failed"; readonly error: unknown } | { readonly kind: "timeout" } | { readonly kind: "aborted" };
const LAUNCH_ATTEMPTS: readonly ChromiumLaunchAttempt[] = [{ headless: true }, { headless: true, channel: "chrome" }, { headless: true, channel: "msedge" }];

export async function launchChromium(signal: AbortSignal, launch: ChromiumLauncher = (options) => chromiumNodeCommand() !== null ? launchChromiumViaNode(options, signal) : chromium.launch(options)): Promise<Browser> {
  // A launch that never completes its handshake blocks the Bun event loop, so
  // the in-process attempt below would freeze every other request and even the
  // timer meant to cap it. The child-process probe answers that question
  // without touching this loop; when it says no, fail immediately.
  const usable = await isChromiumLaunchable(undefined, { waitForResult: true, signal });
  if (signal.aborted) throw new RenderSessionError("render_aborted", "Render was cancelled");
  if (!usable) {
    throw new RenderSessionError("chromium_launch_timeout", "chromium_launch_timeout: Chromium could not be launched on this host");
  }
  const timeoutMs = chromiumLaunchTimeoutMs(); const errors: string[] = []; const tried: string[] = []; let timedOut = false;
  for (const options of LAUNCH_ATTEMPTS) {
    if (signal.aborted) throw new RenderSessionError("render_aborted", "Render was cancelled");
    const channel = options.channel ?? "bundled"; tried.push(channel); const attempt = launch(options); const outcome = await settleLaunch(attempt, timeoutMs, signal);
    if (outcome.kind === "browser") return outcome.browser;
    // A timed out or aborted attempt can still connect later: close whatever process it ends up owning.
    if (outcome.kind !== "failed") void attempt.then((browser) => { void browser.close().catch(() => undefined); }, () => undefined);
    if (outcome.kind === "aborted") throw new RenderSessionError("render_aborted", "Render was cancelled");
    if (outcome.kind === "timeout") { timedOut = true; errors.push(`${channel}: no Chromium connection within ${timeoutMs}ms`); } else errors.push(`${channel}: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`);
  }
  const detail = `tried channels: ${tried.join(", ")}\n${errors.join("\n")}`;
  if (timedOut) throw new RenderSessionError("chromium_launch_timeout", `chromium_launch_timeout: Chromium did not finish launching\n${detail}`);
  throw new RenderSessionError("chromium_not_installed", `chromium_not_installed: Chromium could not be launched\n${detail}`);
}

function chromiumLaunchTimeoutMs(): number { const override = Number(process.env.BG_CHROMIUM_LAUNCH_TIMEOUT_MS); return Number.isFinite(override) && override > 0 ? override : CHROMIUM_LAUNCH_TIMEOUT_MS; }

/** Resolves on the first of launch, timeout or abort, and never leaves a timer or listener behind. */
function settleLaunch(attempt: Promise<Browser>, timeoutMs: number, signal: AbortSignal): Promise<LaunchOutcome> {
  return new Promise<LaunchOutcome>((resolve) => {
    let settled = false; let timer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = (): void => { finish({ kind: "aborted" }); };
    const finish = (outcome: LaunchOutcome): void => { if (settled) return; settled = true; if (timer !== null) clearTimeout(timer); signal.removeEventListener("abort", onAbort); resolve(outcome); };
    timer = setTimeout(() => { finish({ kind: "timeout" }); }, timeoutMs); signal.addEventListener("abort", onAbort, { once: true });
    attempt.then((browser) => { finish({ kind: "browser", browser }); }, (error: unknown) => { finish({ kind: "failed", error }); });
  });
}
function sanitizeUrl(url: URL): string { return `${url.protocol}//${url.host}${url.pathname}`; }
function safeFileFinding(url: URL, root: string): string { try { const relative = path.relative(root, fileURLToPath(url)); resolveWithin(root, relative); return relative.split(path.sep).join("/"); } catch { return "file:outside-artifact"; } }
