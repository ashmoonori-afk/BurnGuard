import type { Browser, Page } from "playwright-core";
import {
  MAX_MEASURED_PAGES,
  MAX_MEASURED_SECTIONS,
  MEASURED_VIEWPORTS,
  parseDesignSystemMeasuredLayout,
  type DesignSystemMeasuredLayout,
  type DesignSystemPageType,
  type MeasuredViewportLayout,
  type MeasuredViewportName,
} from "@bg/shared";
import { launchChromium } from "./export-render-session";

export type MeasuredPageInput = { readonly path: string; readonly pageType: DesignSystemPageType; readonly url: string; readonly html: string };
export type RenderedLayoutInput = {
  readonly pages: readonly MeasuredPageInput[];
  /** Stylesheet bodies already acquired for these pages, keyed by absolute URL. */
  readonly stylesheets: ReadonlyMap<string, string>;
  readonly signal: AbortSignal;
  readonly launch?: (signal: AbortSignal) => Promise<Browser>;
};

const PAGE_TIMEOUT_MS = 8_000;

/**
 * Renders acquired pages offline and measures their layout. Scripts are disabled and every request is
 * answered from the acquired bytes or aborted, so nothing is fetched and no page code runs. Returns null
 * when Chromium is unavailable or measurement fails; extraction never depends on it.
 */
export async function measureRenderedLayout(input: RenderedLayoutInput): Promise<DesignSystemMeasuredLayout | null> {
  const pages = input.pages.slice(0, MAX_MEASURED_PAGES);
  if (pages.length === 0) return null;
  let browser: Browser | null = null;
  try {
    browser = await (input.launch ?? launchChromium)(input.signal);
    const measured = [];
    for (const page of pages) {
      input.signal.throwIfAborted();
      const viewports = {} as Record<MeasuredViewportName, MeasuredViewportLayout>;
      for (const name of Object.keys(MEASURED_VIEWPORTS) as MeasuredViewportName[]) viewports[name] = await measureViewport(browser, page, name, input.stylesheets);
      measured.push({ path: page.path, page_type: page.pageType, viewports });
    }
    // Only what the strict reader accepts is ever stored.
    return parseDesignSystemMeasuredLayout({ schema_version: 1, method: "rendered-offline", pages: measured });
  } catch (error) {
    if (input.signal.aborted) throw error;
    return null;
  } finally {
    await browser?.close();
  }
}

async function measureViewport(browser: Browser, page: MeasuredPageInput, name: MeasuredViewportName, stylesheets: ReadonlyMap<string, string>): Promise<MeasuredViewportLayout> {
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
    return await tab.evaluate(collectLayout, { width: size.width, height: size.height, maxSections: MAX_MEASURED_SECTIONS });
  } finally {
    await context.close();
  }
}

/** Runs inside the rendered page; returns plain measured values in CSS px. */
function collectLayout(input: { readonly width: number; readonly height: number; readonly maxSections: number }): MeasuredViewportLayout {
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
    container: centredContainer ?? (containerLeft !== null && containerRight !== null && containerRight > containerLeft ? { left: clamp(containerLeft), width: clamp(containerRight - containerLeft) } : null),
    gutter: median(gutters),
    section_gap: median(gaps),
    type_scale: typeScale,
    blocks: blockMap,
    sections,
  };
}
