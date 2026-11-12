import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Browser, Page } from "../../backend/node_modules/playwright-core";
import { launchChromiumViaNode } from "../../backend/src/services/chromium-node-launch";
import { compileCanvasMove, withCanvasMove } from "./helpers/canvas-move-host";

let browser: Browser | undefined;
let assets = { script: "", css: "" };
const lifetime = new AbortController();

beforeAll(async () => {
  assets = await compileCanvasMove();
  browser = await launchChromiumViaNode({}, lifetime.signal);
}, 60_000);
afterAll(async () => {
  try { await browser?.close(); }
  finally { lifetime.abort(); }
});

interface Vector { x: number; y: number }

interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number }

/**
 * The element's rectangle as the page itself lays it out, in the canvas frame's own pixels. It is read on the frame's
 * next animation frame: a sandboxed frame that has only just loaded has no size yet, and everything in it measures 0.
 */
const rectOf = (page: Page, selector: string) => page.frameLocator("iframe").locator(selector).evaluate((element) => new Promise<Rect>((resolve) => {
  requestAnimationFrame(() => {
    const rect = element.getBoundingClientRect();
    resolve({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
  });
}));

async function select(page: Page, selector: string, zoom = 1) {
  const rect = await rectOf(page, selector);
  const point = { x: (rect.left + rect.width / 2) * zoom, y: (rect.top + rect.height / 2) * zoom };
  await page.mouse.click(point.x, point.y);
  await page.locator("[data-canvas-move]").waitFor();
  return { rect, point };
}

/** Drags the element by `by` screen pixels and returns how far the preview went and how far the saved page moved it. */
async function drag(page: Page, selector: string, by: Vector, zoom = 1): Promise<{ preview: Vector; moved: Vector }> {
  const { rect: before, point } = await select(page, selector, zoom);
  const surface = await page.locator("[data-canvas-move]").boundingBox();
  if (surface === null) throw new Error("canvas_move_surface_bounds_missing");
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.evaluate(() => globalThis.canvasMoveTest.arm());
  await page.mouse.move(point.x + by.x, point.y + by.y);
  const shown = await page.evaluate(() => globalThis.canvasMoveTest.preview());
  await page.mouse.up();
  await page.evaluate(() => globalThis.canvasMoveTest.saved());
  const after = await rectOf(page, selector);
  return {
    preview: { x: shown.x - surface.x, y: shown.y - surface.y },
    moved: { x: (after.left - before.left) * zoom, y: (after.top - before.top) * zoom },
  };
}

function expectVector(actual: Vector, expected: Vector): void {
  expect(actual.x).toBeCloseTo(expected.x, 1);
  expect(actual.y).toBeCloseTo(expected.y, 1);
}

const DRAGS: ReadonlyArray<{ name: string; document: string; selector: string; by: Vector; widths: readonly number[]; zoom?: number }> = [
  { name: "a box with its own scale(2)", document: "qa-transform.html", selector: ".scaled", by: { x: 40, y: 0 }, widths: [1440, 390] },
  { name: "a child of a rotate(90deg) parent", document: "qa-transform.html", selector: ".child", by: { x: 40, y: 0 }, widths: [1440, 390] },
  { name: "a flex item", document: "qa-magnet.html", selector: "nav a:nth-child(2)", by: { x: 40, y: 12 }, widths: [1440, 390] },
  { name: "a grid item", document: "qa-magnet.html", selector: ".card:nth-child(2)", by: { x: 40, y: 12 }, widths: [1440, 390] },
  { name: "an untransformed box", document: "transform-cases.html", selector: ".plain", by: { x: 40, y: 25 }, widths: [1440] },
  { name: "a child of a scale(0.5) parent", document: "transform-cases.html", selector: ".inhalf", by: { x: 40, y: 25 }, widths: [1440] },
  { name: "a child of a rotated and unevenly scaled parent", document: "transform-cases.html", selector: ".inskew", by: { x: 40, y: 25 }, widths: [1440] },
  { name: "a box with its own rotation and scale", document: "transform-cases.html", selector: ".turned", by: { x: 40, y: 25 }, widths: [1440] },
  { name: "a child of a rotate(90deg) parent on a canvas zoomed to 200%", document: "qa-transform.html", selector: ".child", by: { x: 40, y: 24 }, widths: [1440], zoom: 2 },
];

for (const row of DRAGS) {
  for (const width of row.widths) {
    test(`Given ${row.name} at ${width}px When dragged by ${row.by.x},${row.by.y} Then the preview and the saved page both move it exactly that far`, async () => {
      if (!browser) throw new Error("canvas_move_browser_missing");
      await withCanvasMove(browser, { ...assets, document: row.document, width, zoom: row.zoom }, async (page) => {
        const result = await drag(page, row.selector, row.by, row.zoom);
        expectVector(result.preview, row.by);
        expectVector(result.moved, row.by);
      });
    }, 30_000);
  }
}

test("Given a child of a rotate(90deg) parent When nudged right three times with the arrow key Then the saved page moves it 3 px to the right", async () => {
  if (!browser) throw new Error("canvas_move_browser_missing");
  await withCanvasMove(browser, { ...assets, document: "qa-transform.html", width: 1440 }, async (page) => {
    const { rect: before } = await select(page, ".child");
    await page.evaluate(() => globalThis.canvasMoveTest.arm());
    for (let press = 0; press < 3; press += 1) await page.keyboard.press("ArrowRight");
    // Leaving the Move surface saves the burst at once, without its idle pause.
    await page.locator("[data-canvas-move]").evaluate((surface: HTMLElement) => surface.blur());
    await page.evaluate(() => globalThis.canvasMoveTest.saved());
    const after = await rectOf(page, ".child");
    expectVector({ x: after.left - before.left, y: after.top - before.top }, { x: 3, y: 0 });
  });
}, 30_000);

async function align(page: Page, mode: "left" | "center" | "right" | "top" | "middle" | "bottom"): Promise<void> {
  await page.evaluate(() => globalThis.canvasMoveTest.arm());
  await page.evaluate((chosen) => globalThis.canvasMoveTest.align(chosen), mode);
  await page.evaluate(() => globalThis.canvasMoveTest.saved());
}

test("Given a box with its own scale(2) in a padded parent When aligned left then bottom Then its drawn edges sit on the parent's content box", async () => {
  if (!browser) throw new Error("canvas_move_browser_missing");
  await withCanvasMove(browser, { ...assets, document: "transform-cases.html", width: 1440 }, async (page) => {
    await select(page, ".zoomed");
    const content = await page.frameLocator("iframe").locator(".pad").evaluate((parent) => {
      const rect = parent.getBoundingClientRect(), style = getComputedStyle(parent);
      return { left: rect.left + parent.clientLeft + Number.parseFloat(style.paddingLeft), bottom: rect.bottom - parent.clientTop - Number.parseFloat(style.paddingBottom) };
    });
    await align(page, "left");
    expect((await rectOf(page, ".zoomed")).left).toBeCloseTo(content.left, 1);
    await align(page, "bottom");
    const aligned = await rectOf(page, ".zoomed");
    expect(aligned.bottom).toBeCloseTo(content.bottom, 1);
    expect(aligned.left).toBeCloseTo(content.left, 1);
  });
}, 30_000);

test("Given a child of a rotate(90deg) parent When aligned right then top Then its drawn edges sit on the parent's drawn edges", async () => {
  if (!browser) throw new Error("canvas_move_browser_missing");
  await withCanvasMove(browser, { ...assets, document: "transform-cases.html", width: 1440 }, async (page) => {
    await select(page, ".inframe");
    const parent = await rectOf(page, ".frame");
    await align(page, "right");
    expect((await rectOf(page, ".inframe")).right).toBeCloseTo(parent.right, 1);
    await align(page, "top");
    const aligned = await rectOf(page, ".inframe");
    expect(aligned.top).toBeCloseTo(parent.top, 1);
    expect(aligned.right).toBeCloseTo(parent.right, 1);
  });
}, 30_000);

test("Given a child of a scale(0.5) parent When centred Then its drawn centre is the parent's drawn centre", async () => {
  if (!browser) throw new Error("canvas_move_browser_missing");
  await withCanvasMove(browser, { ...assets, document: "transform-cases.html", width: 1440 }, async (page) => {
    await select(page, ".inhalf");
    const parent = await rectOf(page, ".half");
    await align(page, "center");
    const aligned = await rectOf(page, ".inhalf");
    expect(aligned.left + aligned.width / 2).toBeCloseTo(parent.left + parent.width / 2, 1);
  });
}, 30_000);
