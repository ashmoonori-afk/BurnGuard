import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Browser, Page } from "../../backend/node_modules/playwright-core";
import { launchChromiumViaNode } from "../../backend/src/services/chromium-node-launch";
import { compileWorkspaceControls, withWorkspaceControls } from "./helpers/workspace-controls-host";

let browser: Browser | undefined;
let assets = { script: "", css: "" };
const lifetime = new AbortController();

beforeAll(async () => {
  assets = await compileWorkspaceControls();
  browser = await launchChromiumViaNode({}, lifetime.signal);
}, 60_000);
afterAll(async () => {
  try { await browser?.close(); }
  finally { lifetime.abort(); }
});

async function clickExport(page: Page): Promise<void> {
  const label = await page.evaluate(() => globalThis.workspaceControlsTest.labels().export);
  const bounds = await page.getByRole("button", { name: label, exact: true, includeHidden: true }).boundingBox();
  if (bounds === null) throw new Error("export_trigger_bounds_missing");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

async function armExportFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const label = globalThis.workspaceControlsTest.labels().export;
    const trigger = [...document.querySelectorAll("header button")].find(element => element.getAttribute("aria-label") === label);
    if (!trigger) throw new Error("export_trigger_missing");
    const focused = new Promise<void>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer); trigger.removeEventListener("focus", finish); resolve();
      };
      const timer = window.setTimeout(() => { trigger.removeEventListener("focus", finish); reject(new Error("export_focus_timeout")); }, 5000);
      trigger.addEventListener("focus", finish, { once: true });
    });
    focused.catch(() => undefined);
    Reflect.set(window, "workspaceExportFocus", focused);
  });
}

async function closeExport(page: Page, boundary: boolean): Promise<void> {
  if (!boundary) await armExportFocus(page);
  await page.evaluate(boundary => {
    const content = document.querySelector("[data-export-menu-content]");
    if (!content) throw new Error("export_content_missing");
    globalThis.workspaceExportObservation("close-arm", boundary, content);
    const closed = new Promise<number>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        globalThis.workspaceExportObservation("close-deadline", boundary, content);
        observer.disconnect(); reject(new Error("export_close_timeout"));
      }, 5000);
      const observer = new MutationObserver(records => {
        for (const record of records.slice(0, 8)) globalThis.workspaceExportObservation("state-mutation", boundary, content, record.oldValue);
        if (content.getAttribute("data-state") !== "closed") return;
        const animations = content.getAnimations();
        if (boundary) for (const animation of animations) { animation.pause(); animation.currentTime = 0; }
        clearTimeout(timer); observer.disconnect(); resolve(animations.length);
      });
      observer.observe(content, { attributes: true, attributeFilter: ["data-state"], attributeOldValue: true });
    });
    closed.catch(() => undefined);
    Reflect.set(window, "workspaceClosed", closed);
  }, boundary);
  await page.keyboard.press("Escape");
  const animations = await page.evaluate(async () => await Reflect.get(window, "workspaceClosed"));
  if (boundary) expect(animations).toBeGreaterThan(0);
  else {
    await page.locator("[data-export-menu-content]").waitFor({ state: "detached" });
    await page.evaluate(async () => await Reflect.get(window, "workspaceExportFocus"));
  }
}

for (const width of [390, 1440]) {
  for (const boundary of [true, false]) {
    test(`Given Export dismissed at ${boundary ? "the exit boundary" : "completed closure"} at ${width}px When clicked once Then it remains open without starting an export`, async () => {
      if (!browser) throw new Error("workspace_browser_missing");
      await withWorkspaceControls(browser, { ...assets, width }, async (page, mutations) => {
        const labels = await page.evaluate(() => globalThis.workspaceControlsTest.labels());
        const trigger = page.getByRole("button", { name: labels.export, exact: true, includeHidden: true });
        await trigger.click();
        await page.getByRole("menu").waitFor();
        await closeExport(page, boundary);
        expect(await trigger.getAttribute("aria-expanded")).toBe("false");
        await clickExport(page);
        expect(await trigger.getAttribute("aria-expanded")).toBe("true");
        expect(await page.getByRole("menu").count()).toBe(1);
        expect(await page.getByRole("menu").isVisible()).toBe(true);
        expect(mutations).toEqual([]);
        await closeExport(page, false);
        await page.locator("[data-outside-target]").click();
        expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-outside-target"))).toBe(true);
      });
    }, 30_000);
  }

  test(`Given Export closed at ${width}px When reopened by keyboard and transferred to Recent exports Then focus returns and one click reopens it`, async () => {
    if (!browser) throw new Error("workspace_browser_missing");
    await withWorkspaceControls(browser, { ...assets, width }, async (page, mutations) => {
      const labels = await page.evaluate(() => globalThis.workspaceControlsTest.labels());
      const trigger = page.getByRole("button", { name: labels.export, exact: true, includeHidden: true });
      await trigger.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("menu").waitFor();
      await closeExport(page, false);
      await page.keyboard.press("Enter");
      expect(await trigger.getAttribute("aria-expanded")).toBe("true");
      await page.getByRole("menuitem").filter({ hasText: labels.recent }).click();
      await page.getByRole("dialog").waitFor();
      expect(await page.locator("[data-export-menu-content]").count()).toBe(0);
      await armExportFocus(page);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.evaluate(async () => await Reflect.get(window, "workspaceExportFocus"));
      expect(await trigger.evaluate(element => document.activeElement === element)).toBe(true);
      await clickExport(page);
      expect(await trigger.getAttribute("aria-expanded")).toBe("true");
      expect(mutations).toEqual([]);
    });
  }, 30_000);
}

for (const width of [390, 768, 1440]) {
  test(`Given the complete workspace controls at ${width}px When layout is measured Then actions fit without overlap and Export is keyboard reachable`, async () => {
    if (!browser) throw new Error("workspace_browser_missing");
    await withWorkspaceControls(browser, { ...assets, width }, async page => {
      const geometry = await page.evaluate(() => {
        const elements = [...document.querySelectorAll<HTMLElement>("header button, header a, header h1, [data-canvas-toolbar] button")];
        const visible = elements.filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
        const rects = visible.map(element => {
          const rect = element.getBoundingClientRect();
          return { label: element.getAttribute("aria-label") ?? element.textContent, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
        });
        const outside = rects.filter(rect => rect.x < -0.5 || rect.right > innerWidth + 0.5 || rect.width <= 0 || rect.height <= 0);
        const overlaps = rects.flatMap((a, index) => rects.slice(index + 1).filter(b =>
          Math.min(a.right, b.right) - Math.max(a.x, b.x) > 0.5 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 0.5,
        ).map(b => [a.label, b.label]));
        return { outside, overlaps, controls: rects.length };
      });
      expect(geometry.outside).toEqual([]);
      expect(geometry.overlaps).toEqual([]);
      expect(geometry.controls).toBeGreaterThan(10);
      const label = await page.evaluate(() => globalThis.workspaceControlsTest.labels().export);
      const trigger = page.getByRole("button", { name: label, exact: true });
      await page.locator("header a").focus();
      const focusable = await page.locator("header button, header a, header h1").count();
      let reached = false;
      for (let index = 0; index < focusable; index += 1) {
        await page.keyboard.press("Tab");
        if (await trigger.evaluate(element => document.activeElement === element)) { reached = true; break; }
      }
      expect(reached).toBe(true);
      const focus = await trigger.evaluate(element => ({ visible: element.matches(":focus-visible"), shadow: getComputedStyle(element).boxShadow }));
      expect(focus.visible).toBe(true);
      expect(focus.shadow).not.toBe("none");
    });
  }, 30_000);
}
