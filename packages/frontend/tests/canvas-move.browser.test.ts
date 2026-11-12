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

for (const width of [1440, 390]) {
  test(`Given text inside a line at ${width}px When it is selected, dragged and nudged Then nothing is saved, it stays in place, and the Move surface gives the panel's reason`, async () => {
    if (!browser) throw new Error("canvas_move_browser_missing");
    await withCanvasMove(browser, { ...assets, document: "qa-transform.html", width }, async (page) => {
      const { rect: before, point } = await select(page, ".inl");
      const surface = page.locator("[data-canvas-move]");
      expect(await surface.getAttribute("data-move-refusal")).toBe("line");
      const panel = page.locator('[data-position-refusal="line"]');
      expect(await panel.locator("input").first().isDisabled()).toBe(true);
      const reason = await surface.getAttribute("title");
      expect(reason).toMatch(/\S/);
      expect(await panel.locator("p").textContent()).toBe(reason);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x + 40, point.y);
      await page.mouse.up();
      await page.keyboard.press("ArrowRight");
      await surface.evaluate((element: HTMLElement) => element.blur());
      expect(await page.evaluate(() => globalThis.canvasMoveTest.saves())).toBe(0);
      expect(await rectOf(page, ".inl")).toEqual(before);
    });
  }, 30_000);
}

const KINDS: ReadonlyArray<{ selector: string; tag: string; moves: boolean }> = [
  { selector: ".k-span", tag: "span", moves: false },
  { selector: ".k-link", tag: "a", moves: false },
  { selector: ".k-em", tag: "em", moves: false },
  { selector: ".k-inline-block", tag: "span", moves: true },
  { selector: ".k-img", tag: "img", moves: true },
  { selector: ".k-svg", tag: "svg", moves: true },
  { selector: ".k-svg-rect", tag: "rect", moves: true },
  { selector: ".k-button", tag: "button", moves: true },
];

for (const kind of KINDS) {
  test(`Given ${kind.selector} in a line of text When the canvas reads it Then the move tools refuse it exactly when the browser would not move it`, async () => {
    if (!browser) throw new Error("canvas_move_browser_missing");
    await withCanvasMove(browser, { ...assets, document: "inline-cases.html", width: 1440 }, async (page) => {
      const rect = await rectOf(page, kind.selector);
      const read = await page.evaluate(([x, y]) => globalThis.canvasMoveTest.refusalAt(x, y), [rect.left + rect.width / 2, rect.top + rect.height / 2] as const);
      // The browser's own answer: set a translate on the element, measure it, and take it off again.
      const shift = await page.frameLocator("iframe").locator(kind.selector).evaluate((element: HTMLElement | SVGElement) => {
        const before = element.getBoundingClientRect().left;
        element.style.translate = "10px 0px";
        const moved = element.getBoundingClientRect().left - before;
        element.style.translate = "";
        return moved;
      });
      expect(shift).toBeCloseTo(kind.moves ? 10 : 0, 1);
      expect(read).toEqual({ tag: kind.tag, refusal: kind.moves ? null : "line" });
    });
  }, 30_000);
}

test("Given text inside a line that a resize turned into its own box When it is dragged Then it moves and the save carries the move", async () => {
  if (!browser) throw new Error("canvas_move_browser_missing");
  await withCanvasMove(browser, { ...assets, document: "qa-transform.html", width: 1440 }, async (page) => {
    await select(page, ".inl");
    const handle = await page.locator('button[style*="e-resize"]').first().boundingBox();
    if (handle === null) throw new Error("canvas_move_handle_bounds_missing");
    const grip = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.evaluate(() => globalThis.canvasMoveTest.arm());
    await page.mouse.move(grip.x + 20, grip.y);
    await page.mouse.up();
    await page.evaluate(() => globalThis.canvasMoveTest.saved());
    const result = await drag(page, ".inl", { x: 40, y: 0 });
    expectVector(result.moved, { x: 40, y: 0 });
    expect(await page.evaluate(() => globalThis.canvasMoveTest.saves())).toBe(2);
  });
}, 30_000);

test("Given Align is waiting for the frame's measurement When another save lands on the element Then Align's save is refused as stale and the newer offset stays in the file", async () => {
  if (!browser) throw new Error("canvas_move_browser_missing");
  await withCanvasMove(browser, { ...assets, document: "transform-cases.html", width: 1440 }, async (page) => {
    await select(page, ".inhalf");
    const file = await page.evaluate(() => globalThis.canvasMoveTest.alignWhileFileChanges("center"));
    expect(await page.evaluate(() => globalThis.canvasMoveTest.stale())).toBe(1);
    expect([...file.matchAll(/translate:\s*([^;"]+)/g)].map((match) => match[1]?.trim())).toEqual(["99px 0px"]);
  });
}, 30_000);

test("Given a page whose own script answers the canvas with values of the wrong type When the canvas asks what is under a point and where a node is Then both answers are dropped, nothing is selected and nothing is saved", async () => {
  if (!browser) throw new Error("canvas_move_browser_missing");
  await withCanvasMove(browser, { ...assets, document: "hostile-answers.html", width: 1440 }, async (page) => {
    const rect = await rectOf(page, ".box");
    const point = [rect.left + rect.width / 2, rect.top + rect.height / 2] as const;
    await page.mouse.click(point[0], point[1]);
    // Asked after the click, so answered after it: by then the overlay has handled the answer to its own question.
    expect(await page.evaluate(([x, y]) => globalThis.canvasMoveTest.answersAt(x, y, "hostile"), point)).toEqual({ hit: false, rect: false });
    expect(await page.locator("[data-canvas-move]").count()).toBe(0);
    expect(await page.evaluate(() => globalThis.canvasMoveTest.saves())).toBe(0);
  });
}, 30_000);

test("Given an SVG shape, which has no offset box When it is selected Then the selection box has the size of its drawn rectangle", async () => {
  if (!browser) throw new Error("canvas_move_browser_missing");
  await withCanvasMove(browser, { ...assets, document: "inline-cases.html", width: 1440 }, async (page) => {
    const { rect } = await select(page, ".k-svg-rect");
    const box = await page.locator("[data-canvas-move]").boundingBox();
    if (box === null) throw new Error("canvas_move_surface_bounds_missing");
    // The Move surface sits a few pixels inside or outside the selection box; without a box size it has none at all.
    expect(Math.abs(box.width - rect.width)).toBeLessThanOrEqual(4);
    expect(Math.abs(box.height - rect.height)).toBeLessThanOrEqual(4);
  });
}, 30_000);
