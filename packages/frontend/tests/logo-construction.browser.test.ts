import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Browser, Page } from "../../backend/node_modules/playwright-core";
import { launchChromiumViaNode } from "../../backend/src/services/chromium-node-launch";
import { LOGO_CONSTRUCTION_RECORD, compileLogoConstruction, withLogoConstruction } from "./helpers/logo-construction-host";

let browser: Browser | undefined;
let assets = { script: "", css: "" };
const lifetime = new AbortController();
const record = JSON.stringify(LOGO_CONSTRUCTION_RECORD);

beforeAll(async () => {
  assets = await compileLogoConstruction();
  browser = await launchChromiumViaNode({}, lifetime.signal);
}, 60_000);
afterAll(async () => {
  try { await browser?.close(); }
  finally { lifetime.abort(); }
});

/** Resolves once the draw-in reports its last frame, or rejects after a bounded wait. */
async function drawnIn(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const done = () => document.querySelector("[data-construction-progress]")?.getAttribute("data-construction-progress") === "1";
    if (done()) { resolve(); return; }
    const timer = window.setTimeout(() => { observer.disconnect(); reject(new Error("construction_draw_in_timeout")); }, 10_000);
    const observer = new MutationObserver(() => {
      if (!done()) return;
      clearTimeout(timer); observer.disconnect(); resolve();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-construction-progress"] });
  }));
}

for (const width of [1024, 1440]) {
  for (const dark of [false, true]) {
    const theme = dark ? "dark" : "light";
    test(`Given a geometric mark at ${width}px in ${theme} When the card renders Then every control is a 44 px target and nothing is clipped`, async () => {
      if (!browser) throw new Error("logo_construction_browser_missing");
      await withLogoConstruction(browser, { ...assets, width, dark, reducedMotion: false, record }, async page => {
        const labels = await page.evaluate(() => globalThis.logoConstructionTest.labels());
        await page.getByRole("tab", { name: labels.construction }).click();
        await page.getByRole("button", { name: labels.replay }).waitFor();
        await drawnIn(page);
        const geometry = await page.evaluate(() => {
          const card = document.querySelector("section");
          if (!card) throw new Error("card_missing");
          const bounds = card.getBoundingClientRect();
          const controls = [...card.querySelectorAll<HTMLElement>("button, [role=tab]")].map(element => {
            const rect = element.getBoundingClientRect();
            return { label: element.textContent, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
          });
          const drawing = card.querySelector("svg")?.getBoundingClientRect();
          return { bounds: { x: bounds.x, right: bounds.right, y: bounds.y, bottom: bounds.bottom }, controls, drawing: drawing ? { width: drawing.width, height: drawing.height } : null, viewport: innerWidth };
        });
        expect(geometry.controls.length).toBe(3);
        for (const control of geometry.controls) {
          expect(control.height).toBeGreaterThanOrEqual(44);
          expect(control.width).toBeGreaterThanOrEqual(44);
          expect(control.x).toBeGreaterThanOrEqual(geometry.bounds.x);
          expect(control.right).toBeLessThanOrEqual(geometry.bounds.right + 0.5);
          expect(control.bottom).toBeLessThanOrEqual(geometry.bounds.bottom + 0.5);
        }
        expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport + 0.5);
        expect(geometry.drawing?.width).toBeGreaterThan(100);
        expect(geometry.drawing?.height).toBe(geometry.drawing?.width);
      });
    }, 30_000);
  }

  test(`Given the card at ${width}px When the view is switched by keyboard Then the construction draws in and Replay starts it again`, async () => {
    if (!browser) throw new Error("logo_construction_browser_missing");
    await withLogoConstruction(browser, { ...assets, width, dark: false, reducedMotion: false, record }, async page => {
      const labels = await page.evaluate(() => globalThis.logoConstructionTest.labels());
      const design = page.getByRole("tab", { name: labels.design });
      await design.focus();
      await page.keyboard.press("ArrowRight");
      const construction = page.getByRole("tab", { name: labels.construction, selected: true });
      await construction.waitFor();
      expect(await construction.evaluate(element => document.activeElement === element)).toBe(true);
      await drawnIn(page);
      await page.evaluate(() => {
        const restarted = new Promise<number>((resolve, reject) => {
          const timer = window.setTimeout(() => { observer.disconnect(); reject(new Error("construction_replay_timeout")); }, 5000);
          const observer = new MutationObserver(() => {
            const value = Number(document.querySelector("[data-construction-progress]")?.getAttribute("data-construction-progress"));
            if (!(value < 1)) return;
            clearTimeout(timer); observer.disconnect(); resolve(value);
          });
          observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-construction-progress"] });
        });
        restarted.catch(() => undefined);
        Reflect.set(window, "constructionRestarted", restarted);
      });
      await page.getByRole("button", { name: labels.replay }).click();
      expect(await page.evaluate(async () => await Reflect.get(window, "constructionRestarted"))).toBeLessThan(1);
      await drawnIn(page);
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("ArrowLeft");
      await page.getByRole("tab", { name: labels.design, selected: true }).waitFor();
      await page.getByRole("button", { name: labels.replay }).waitFor({ state: "detached" });
    });
  }, 30_000);
}

test("Given reduced motion When the construction view opens Then its first frame is the finished drawing", async () => {
  if (!browser) throw new Error("logo_construction_browser_missing");
  await withLogoConstruction(browser, { ...assets, width: 1440, dark: false, reducedMotion: true, record }, async page => {
    const labels = await page.evaluate(() => globalThis.logoConstructionTest.labels());
    await page.getByRole("tab", { name: labels.construction }).click();
    expect(await page.locator("[data-construction-progress]").getAttribute("data-construction-progress")).toBe("1");
  });
}, 30_000);

test("Given a record the parser refuses When the card renders Then it shows an alert and no view switch", async () => {
  if (!browser) throw new Error("logo_construction_browser_missing");
  const broken = JSON.stringify({ ...LOGO_CONSTRUCTION_RECORD, primitives: [] });
  await withLogoConstruction(browser, { ...assets, width: 1440, dark: false, reducedMotion: false, record: broken }, async page => {
    await page.getByRole("alert").waitFor();
    expect(await page.getByRole("tab").count()).toBe(0);
    expect(await page.locator("[data-construction-progress]").count()).toBe(0);
  });
}, 30_000);
