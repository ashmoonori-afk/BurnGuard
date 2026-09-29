import type { Browser, Page } from "playwright-core";
import {
  MAX_MEASURED_PAGES,
  MAX_MEASURED_SECTIONS,
  MEASURED_VIEWPORTS,
  parseDesignSystemMeasuredLayout,
  type DesignSystemMeasuredLayout,
  type DesignSystemPageType,
  type MeasuredPageLayout,
  type MeasuredViewportLayout,
  type MeasuredViewportName,
} from "@bg/shared";
import { launchChromium, RenderSessionError } from "./export-render-session";

export type MeasuredPageInput = { readonly path: string; readonly pageType: DesignSystemPageType; readonly url: string; readonly html: string };
export type RenderedLayoutInput = {
  readonly pages: readonly MeasuredPageInput[];
  /** Stylesheet bodies already acquired for these pages, keyed by absolute URL. */
  readonly stylesheets: ReadonlyMap<string, string>;
  readonly signal: AbortSignal;
  readonly launch?: (signal: AbortSignal) => Promise<Browser>;
  /** Receives a JPEG of each measured viewport, taken after measurement from the same offline render. */
  readonly captureReference?: (shot: LayoutReferenceCapture) => void;
  /** Receives why measurement produced no layout, so the caller can record it instead of a bare "unavailable". */
  readonly reportFailure?: (failure: LayoutMeasureFailure) => void;
};
/**
 * Why a measurement produced no layout. `code` is a stable token (a RenderSessionError code for launch failures,
 * otherwise launch_failed, render_failed or invalid_measurement); `launchMs` is how long the browser took to start,
 * or null when it never started. No raw browser diagnostics or paths are carried.
 */
export type LayoutMeasureFailure = { readonly stage: "launch" | "render" | "validate"; readonly code: string; readonly launchMs: number | null };
export type LayoutReferenceCapture = { readonly path: string; readonly viewport: MeasuredViewportName; readonly jpeg: Uint8Array; readonly width: number; readonly height: number };

const PAGE_TIMEOUT_MS = 8_000;
/** A reference screenshot covers at most this many viewport heights from the top of the page. */
const REFERENCE_VIEWPORT_HEIGHTS = 3;
/**
 * Media that was never acquired renders empty in the offline page; a neutral hatch keeps those regions visible in
 * the reference screenshot. Applied after measurement, so it cannot change measured values.
 */
const REFERENCE_MEDIA_CSS = "img,video,picture,canvas,iframe,object,embed{background:repeating-linear-gradient(45deg,#c8c8c8 0 10px,#e2e2e2 10px 20px)!important;color:transparent!important}"
  // Entrance animations start hidden and offset (inline opacity near 0 plus a transform) and only a script reveals
  // them; the reference shows them in their final place, as a visitor sees the page.
  + "[style*='opacity:0'][style*='transform'],[style*='opacity: 0'][style*='transform'],[data-framer-appear-id]{opacity:1!important;transform:none!important}";

/**
 * Renders acquired pages offline and measures their layout. Scripts are disabled and every request is
 * answered from the acquired bytes or aborted, so nothing is fetched and no page code runs. Returns null
 * when Chromium is unavailable or measurement fails; extraction never depends on it.
 */
export async function measureRenderedLayout(input: RenderedLayoutInput): Promise<DesignSystemMeasuredLayout | null> {
  const pages = input.pages.slice(0, MAX_MEASURED_PAGES);
  if (pages.length === 0) return null;
  let browser: Browser | null = null;
  const measured: MeasuredPageLayout[] = [];
  let stage: LayoutMeasureFailure["stage"] = "launch";
  const startedAt = Date.now();
  let launchMs: number | null = null;
  try {
    browser = await (input.launch ?? launchChromium)(input.signal);
    launchMs = Date.now() - startedAt;
    stage = "render";
    for (const page of pages) {
      input.signal.throwIfAborted();
      const viewports = {} as Record<MeasuredViewportName, MeasuredViewportLayout>;
      for (const name of Object.keys(MEASURED_VIEWPORTS) as MeasuredViewportName[]) viewports[name] = await measureViewport(browser, page, name, input.stylesheets, input.captureReference);
      measured.push({ path: page.path, page_type: page.pageType, viewports });
    }
    // Only what the strict reader accepts is ever stored.
    stage = "validate";
    return parseDesignSystemMeasuredLayout({ schema_version: 1, method: "rendered-offline", pages: measured });
  } catch (error) {
    // Pages finished before an abort are kept (the entry page is measured first), so a deadline that cuts the
    // last pages short still records the entry; the caller decides whether the abort itself must propagate.
    if (input.signal.aborted) {
      if (measured.length > 0) return parseDesignSystemMeasuredLayout({ schema_version: 1, method: "rendered-offline", pages: measured });
      input.reportFailure?.({ stage, code: "aborted", launchMs });
      throw error;
    }
    const code = stage === "launch" ? (error instanceof RenderSessionError ? error.code : "launch_failed") : stage === "render" ? "render_failed" : "invalid_measurement";
    input.reportFailure?.({ stage, code, launchMs });
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function measureViewport(browser: Browser, page: MeasuredPageInput, name: MeasuredViewportName, stylesheets: ReadonlyMap<string, string>, capture: RenderedLayoutInput["captureReference"]): Promise<MeasuredViewportLayout> {
  const size = MEASURED_VIEWPORTS[name];
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block", viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });
  try {
    await context.routeWebSocket("**/*", async (socket) => { await socket.close({ code: 1008, reason: "Measurement network access is disabled" }); });
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      if (url === page.url && route.request().resourceType() === "document") { await route.fulfill({ contentType: "text/html; charset=utf-8", body: page.html }); return; }
      const css = stylesheets.get(url);
      if (css !== undefined && route.request().resourceType() === "stylesheet") { await route.fulfill({ contentType: "text/css; charset=utf-8", body: css }); return; }
      await route.abort("blockedbyclient");
    });
    const tab: Page = await context.newPage();
    await tab.goto(page.url, { waitUntil: "load", timeout: PAGE_TIMEOUT_MS });
    const layout = await tab.evaluate(collectLayout, { width: size.width, height: size.height, maxSections: MAX_MEASURED_SECTIONS });
    if (capture) {
      const height = Math.max(size.height, Math.min(layout.page_height, size.height * REFERENCE_VIEWPORT_HEIGHTS));
      // The reference is optional: a failed capture leaves the measured values intact, and the caller reports
      // the missing screenshot by comparing what it received with what was measured. An abort still stops the
      // run at the next page boundary.
      // addStyleTag waits for a load event that never fires with scripts disabled, so the style is added directly.
      const jpeg = await tab.evaluate((css) => { const style = document.createElement("style"); style.textContent = css; document.documentElement.append(style); }, REFERENCE_MEDIA_CSS)
        .then(() => tab.screenshot({ type: "jpeg", quality: 70, fullPage: true, clip: { x: 0, y: 0, width: size.width, height }, animations: "disabled", timeout: PAGE_TIMEOUT_MS }))
        .catch(() => null);
      if (jpeg !== null) capture({ path: page.path, viewport: name, jpeg, width: size.width, height });
    }
    return layout;
  } finally {
    await context.close();
  }
}

/** Runs inside the rendered page; returns plain measured values in CSS px. Shared by extraction and the conformance review so both measure identically. */
export function collectLayout(input: { readonly width: number; readonly height: number; readonly maxSections: number }): MeasuredViewportLayout {
  const vw = input.width;
  const round = (value: number) => Math.round(value);
  // Every stored length stays inside the contract's 0..100000 px range (x may be negative), so one odd box
  // cannot invalidate the whole measurement.
  const MAX_PX = 100_000;
  const clamp = (value: number, min = 0) => Math.min(MAX_PX, Math.max(min, round(value)));
  const visible = (el: Element) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05; };
  const ownsText = (el: Element) => [...el.childNodes].some(node => node.nodeType === 3 && (node.textContent ?? "").trim().length > 1);
  const leafStyle = (el: Element) => getComputedStyle(ownsText(el) ? el : [...el.querySelectorAll("*")].find(child => visible(child) && ownsText(child)) ?? el);
  const align = (left: number, width: number, textAlign: string): "left" | "center" | "right" => {
    const centre = left + width / 2;
    if (Math.abs(centre - vw / 2) <= vw * 0.04 && (textAlign === "center" || width < vw * 0.9)) return "center";
    return textAlign === "right" || textAlign === "end" ? "right" : "left";
  };
  const top = (el: Element) => el.getBoundingClientRect().top + window.scrollY;
  const box = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: clamp(r.left, -MAX_PX), y: clamp(r.top + window.scrollY), width: clamp(r.width), height: clamp(r.height), align: align(r.left, r.width, leafStyle(el).textAlign) };
  };
  const median = (values: number[]) => { if (values.length === 0) return null; const sorted = [...values].sort((a, b) => a - b); return round(sorted[Math.floor(sorted.length / 2)]!); };
  const inChrome = (el: Element) => el.closest("nav, header, footer") !== null;
  const fontOf = (el: Element) => parseFloat(leafStyle(el).fontSize);

  const h1 = [...document.querySelectorAll("h1")].find(visible) ?? null;
  const h1Bottom = h1 ? h1.getBoundingClientRect().bottom + window.scrollY : 0;
  const h1Size = h1 ? fontOf(h1) : 0;
  const subheading = h1 ? [...document.querySelectorAll("p, h2, h3, div, span")].filter(el => visible(el) && !inChrome(el) && top(el) >= h1Bottom - 2 && top(el) < h1Bottom + input.height * 0.5 && (el.textContent ?? "").trim().length > 20 && el.getBoundingClientRect().height < 160 && fontOf(el) < h1Size * 0.7)
    .sort((a, b) => top(a) - top(b) || a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0] ?? null : null;
  const cta = h1 ? [...document.querySelectorAll("a, button")].find(el => visible(el) && !inChrome(el) && top(el) >= h1Bottom - 2 && top(el) < h1Bottom + input.height * 0.6 && (el.textContent ?? "").trim().length > 1) ?? null : null;
  const openingEnd = [...document.querySelectorAll("h2")].filter(visible).map(top)[0] ?? Number.POSITIVE_INFINITY;
  const media = [...document.querySelectorAll("img, video, canvas, picture, svg")].filter(el => visible(el) && top(el) < openingEnd && !inChrome(el) && el.getBoundingClientRect().width >= vw * 0.2)
    .sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0] ?? null;

  const textLeaves = [...document.querySelectorAll("body *")].filter(el => visible(el) && ownsText(el) && !inChrome(el));
  const lefts = textLeaves.map(el => el.getBoundingClientRect().left).filter(left => left >= 0);
  const rights = textLeaves.map(el => el.getBoundingClientRect().right).filter(right => right <= vw);
  const containerLeft = median(lefts.filter(left => left < vw / 2));
  const containerRight = median(rights.filter(right => right > vw / 2));

  // The content container is the most common width among horizontally centred wrappers (40-95% of the
  // viewport); ties go to the wider one. Centred text columns inside those wrappers are narrower and rarer.
  const wrapperWidths = new Map<number, number>();
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el) || inChrome(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < vw * 0.4 || r.width > vw * 0.95 || Math.abs(r.left + r.width / 2 - vw / 2) > vw * 0.02) continue;
    const width = Math.round(r.width / 10) * 10;
    wrapperWidths.set(width, (wrapperWidths.get(width) ?? 0) + 1);
  }
  const containerWidth = [...wrapperWidths].sort((l, r) => r[1] - l[1] || r[0] - l[0])[0]?.[0] ?? null;
  const centredContainer = containerWidth === null ? null : { left: clamp((vw - containerWidth) / 2), width: clamp(containerWidth) };
  // A text column is never wider than its container, so a centred candidate narrower than the text edges
  // (a lone hero image or lead paragraph inside a full-width padded layout) cannot be the container.
  const textContainer = containerLeft !== null && containerRight !== null && containerRight > containerLeft ? { left: clamp(containerLeft), width: clamp(containerRight - containerLeft) } : null;
  // Sections follow visual order, which can differ from DOM order.
  const anchors = [...document.querySelectorAll("h1, h2")].filter(visible).map(el => ({ el, top: top(el) })).sort((a, b) => a.top - b.top);
  const blocks = [...document.querySelectorAll("body *")].filter(el => { if (!visible(el) || inChrome(el)) return false; const r = el.getBoundingClientRect(); return r.width > 120 && r.width < vw * 0.6 && r.height > 60; })
    .map(el => { const r = el.getBoundingClientRect(); return { left: round(r.left), right: round(r.right), top: round(r.top + window.scrollY), bottom: round(r.bottom + window.scrollY) }; });
  const gaps: number[] = [];
  const gutters: number[] = [];
  const sections = anchors.slice(0, input.maxSections).map((anchor, index) => {
    const end = anchors[index + 1]?.top ?? document.documentElement.scrollHeight;
    const inside = blocks.filter(block => block.top >= anchor.top && block.top < end);
    const rows = new Map<number, typeof inside>();
    for (const block of inside) { const key = Math.round(block.top / 12); rows.set(key, [...(rows.get(key) ?? []), block]); }
    let columns = 0;
    for (const row of rows.values()) {
      const lanes = [...new Map(row.map(block => [block.left, block])).values()].sort((a, b) => a.left - b.left);
      columns = Math.max(columns, lanes.length);
      for (let i = 1; i < lanes.length; i += 1) { const gap = lanes[i]!.left - lanes[i - 1]!.right; if (gap > 0 && gap < vw * 0.2) gutters.push(gap); }
    }
    const contentBottom = Math.max(anchor.top + anchor.el.getBoundingClientRect().height, ...inside.map(block => block.bottom));
    if (index + 1 < anchors.length && anchors[index + 1]!.top > contentBottom) gaps.push(anchors[index + 1]!.top - contentBottom);
    const heading = (anchor.el.textContent ?? "").replace(/\s+/g, " ").replace(/[<>\p{Cc}]/gu, "").trim().slice(0, 60);
    const r = anchor.el.getBoundingClientRect();
    return { heading, top: clamp(anchor.top), height: clamp(end - anchor.top), columns, align: align(r.left, r.width, leafStyle(anchor.el).textAlign) };
  });

  const sizesOf = (selector: string) => [...document.querySelectorAll(selector)].filter(el => visible(el) && !inChrome(el)).map(fontOf);
  const typeScale: Record<string, number> = {};
  const put = (role: string, value: number | null) => { if (value !== null && value >= 1) typeScale[role] = round(value); };
  put("hero", h1 ? h1Size : null);
  put("subheading", subheading ? fontOf(subheading) : null);
  put("cta", cta ? fontOf(cta) : null);
  put("h2", median(sizesOf("h2")));
  put("h3", median(sizesOf("h3")));
  put("body", median(textLeaves.filter(el => (el.textContent ?? "").trim().length > 40 && !/^H[1-6]$/.test(el.tagName)).map(fontOf)));
  put("nav", median([...document.querySelectorAll("nav a, header a")].filter(visible).map(fontOf)));

  const blockMap: Record<string, ReturnType<typeof box>> = {};
  if (h1) blockMap.hero_heading = box(h1);
  if (subheading) blockMap.subheading = box(subheading);
  if (cta) blockMap.cta = box(cta);
  if (media) blockMap.media = box(media);
  return {
    viewport: { width: input.width, height: input.height },
    page_height: clamp(document.documentElement.scrollHeight),
    container: textContainer === null || (centredContainer !== null && centredContainer.width >= textContainer.width - 10) ? centredContainer ?? textContainer : textContainer,
    gutter: median(gutters),
    section_gap: median(gaps),
    type_scale: typeScale,
    blocks: blockMap,
    sections,
  };
}
