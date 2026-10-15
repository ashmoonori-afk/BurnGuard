import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Browser, Page } from "playwright-core";
import { inspectRenderedPage, type DomAuditFinding } from "../src/services/design-audit-dom";
import { launchChromium } from "../src/services/export-render-session";

const WIDTHS = [1440, 375] as const;
const SKIP_BASE = "position:absolute;left:16px;top:-100px;padding:8px 12px;background:#000;color:#fff;font:16px Arial;transition:top .2s;";
const page = (head: string, body: string) => `<!doctype html><html><head><style>body{margin:0;background:#fff;color:#111;font:18px Arial}main{padding:48px 16px}${head}</style></head><body>${body}<main id="content"><h1>Synthetic page</h1><p>Body copy that fits.</p><button id="probe" type="button">Probe</button></main></body></html>`;
const workingSkip = page(`#skip{${SKIP_BASE}}#skip:focus{top:16px}`, '<a id="skip" href="#content">Skip to content</a>');
const focusVisibleSkip = page(`.skip-link{${SKIP_BASE}}.skip-link:focus-visible{top:16px}`, '<a id="skip" class="skip-link" href="#content">Skip to content</a>');
const brokenSkip = page(`#skip{${SKIP_BASE}}`, '<a id="skip" href="#content">Skip to content</a>');
const clippedCopy = page(".clip{width:120px;height:24px;overflow:hidden;white-space:nowrap}", '<div class="clip"><p class="note">This sentence is far wider than its clipping box allows</p></div>');

let browser: Browser;
beforeAll(async () => { browser = await launchChromium(AbortSignal.timeout(45_000)); }, 60_000);
afterAll(async () => { await browser.close(); });

async function inspect(html: string, width: number, prepare?: (open: Page) => Promise<void>): Promise<{ readonly findings: readonly DomAuditFinding[]; readonly open: Page }> {
  const open = await browser.newPage({ viewport: { width, height: 800 } });
  await open.setContent(html);
  await prepare?.(open);
  const observation = await inspectRenderedPage(open);
  return { findings: observation.findings, open };
}
const overflow = (findings: readonly DomAuditFinding[]) => findings.filter((finding) => finding.code === "text_overflow" || finding.code === "narrow_width");

describe("focus-revealed skip link in the DOM audit", () => {
  for (const width of WIDTHS) {
    test(`Given a working skip link at ${width}px When the page is inspected Then it is not text overflow and focus and scroll are restored`, async () => {
      const { findings, open } = await inspect(workingSkip, width, (target) => target.focus("#probe"));
      try {
        expect(overflow(findings)).toEqual([]);
        expect(await open.evaluate(() => ({ active: document.activeElement?.id, scrollY: window.scrollY }))).toEqual({ active: "probe", scrollY: 0 });
      } finally { await open.close(); }
    }, 60_000);

    test(`Given a skip link revealed only by :focus-visible at ${width}px When the page is inspected Then it is not text overflow`, async () => {
      const { findings, open } = await inspect(focusVisibleSkip, width);
      try { expect(overflow(findings)).toEqual([]); } finally { await open.close(); }
    }, 60_000);

    test(`Given a skip link that never reveals on focus at ${width}px When inspected Then it stays must-fix and carries a locator with bounds`, async () => {
      const { findings, open } = await inspect(brokenSkip, width);
      try {
        const hit = findings.find((finding) => finding.code === "text_overflow");
        expect(hit?.severity).toBe("must_fix");
        expect(hit?.nodeId).toBeNull();
        expect(hit?.locator?.bounds.y).toBeLessThan(0);
        expect(await open.evaluate((selector) => document.querySelector(selector)?.id, hit?.locator?.selector ?? "")).toBe("skip");
      } finally { await open.close(); }
    }, 60_000);

    test(`Given clipped body text at ${width}px When inspected Then it stays must-fix and the locator finds that element`, async () => {
      const { findings, open } = await inspect(clippedCopy, width);
      try {
        const hit = findings.find((finding) => finding.code === "text_overflow");
        expect(hit?.severity).toBe("must_fix");
        expect(hit?.nodeId).toBeNull();
        expect(hit?.locator?.bounds.width).toBe(120);
        expect(await open.evaluate((selector) => document.querySelector(selector)?.className, hit?.locator?.selector ?? "")).toBe("note");
      } finally { await open.close(); }
    }, 60_000);
  }
});
