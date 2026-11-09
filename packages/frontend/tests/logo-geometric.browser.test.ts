import { afterAll, beforeAll, expect, test } from "bun:test";
import type { LogoGeometricStatusV1 } from "@bg/shared";
import type { Browser, Page } from "../../backend/node_modules/playwright-core";
import { launchChromiumViaNode } from "../../backend/src/services/chromium-node-launch";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LOGO_GEOMETRY_FILE } from "@bg/shared";
import {
  LOGO_GEOMETRIC_LOCKUP_SVG_FILE,
  LOGO_GEOMETRIC_RECORD_FILES,
  LOGO_GEOMETRIC_WORDMARK_FILES,
  composeLogoGeometricLockup,
  finishLogoGeometricWordmark,
} from "../../backend/src/services/logo-geometric-step";
import { compileLogoGeometric, withLogoGeometricPage } from "./helpers/logo-geometric-host";

type Geometric = Extract<LogoGeometricStatusV1, { method: "geometric" }>;
const SHA = "d".repeat(64);
const base = { schema_version: 1, method: "geometric", available_steps: ["symbol", "wordmark", "lockup"], wordmark_review: null, previews: { wordmark: null, lockup: null } } as const;
const UNANSWERED: Geometric = { ...base, answers: null, plan: [], records: { symbol: null, wordmark: null, lockup: null }, symbol_review: null };
const answers = { schema_version: 1, parts: { choice: "symbol_wordmark" }, direction: { choice: "auto" } } as const;
const REVIEW: Geometric = {
  ...base,
  answers,
  plan: [{ step: "symbol", status: "awaiting_review" }, { step: "wordmark", status: "pending" }, { step: "lockup", status: "pending" }],
  records: { symbol: SHA, wordmark: null, lockup: null },
  symbol_review: { passed: false, findings: ["near_touch", "closed_counter"] },
};
const NOT_MADE: Geometric = { ...REVIEW, plan: [{ step: "symbol", status: "next" }], records: { symbol: null, wordmark: null, lockup: null }, symbol_review: null };
const COMPLETE: Geometric = { ...REVIEW, plan: [{ step: "symbol", status: "done" }], symbol_review: null };
// The wordmark and lockup SVGs the server writes for a real two-bowl B and a Geist wordmark, made in beforeAll.
const svgs = { wordmark: "", lockup: "" };
const wordmarkReview = (): Geometric => ({
  ...REVIEW,
  plan: [{ step: "symbol", status: "done" }, { step: "wordmark", status: "awaiting_review" }, { step: "lockup", status: "pending" }],
  records: { symbol: SHA, wordmark: "e".repeat(64), lockup: null },
  symbol_review: null,
  wordmark_review: { passed: false, findings: ["stem_off"] },
  previews: { wordmark: svgs.wordmark, lockup: null },
});
const lockupComplete = (): Geometric => ({
  ...REVIEW,
  plan: [{ step: "symbol", status: "done" }, { step: "wordmark", status: "done" }, { step: "lockup", status: "done" }],
  records: { symbol: SHA, wordmark: "e".repeat(64), lockup: "f".repeat(64) },
  symbol_review: null,
  previews: { wordmark: svgs.wordmark, lockup: svgs.lockup },
});

async function serverSvgs(): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), `bg-logo-geometric-browser-${process.pid}-`));
  try {
    await mkdir(path.join(dir, "geometric"), { recursive: true });
    await writeFile(path.join(dir, LOGO_GEOMETRY_FILE), JSON.stringify({
      schema_version: 1, grid: 64, radii: [{ id: "bowl", value: 10 }, { id: "counter", value: 4 }],
      primitives: [
        { kind: "rect", id: "stem", x: 16, y: 12, width: 8, height: 40 },
        { kind: "line", id: "edge", from: [24, 64], to: [24, 0] },
        { kind: "circle", id: "upper", cx: 32, cy: 22, r: "bowl" },
        { kind: "circle", id: "lower", cx: 32, cy: 42, r: "bowl" },
        { kind: "circle", id: "upper-counter", cx: 32, cy: 22, r: "counter" },
        { kind: "circle", id: "lower-counter", cx: 32, cy: 42, r: "counter" },
      ],
      tree: { op: "union", args: [
        { ref: "stem" },
        { op: "subtract", args: [{ op: "intersect", args: [{ ref: "upper" }, { ref: "edge" }] }, { ref: "upper-counter" }] },
        { op: "subtract", args: [{ op: "intersect", args: [{ ref: "lower" }, { ref: "edge" }] }, { ref: "lower-counter" }] },
      ] },
      optical: [],
    }));
    await writeFile(path.join(dir, LOGO_GEOMETRIC_RECORD_FILES.wordmark), JSON.stringify({ schema_version: 1, text: "Northstar", font: "Geist", cap_height: 16, stem: 2, tracking: 1 }));
    await finishLogoGeometricWordmark(dir, "Northstar");
    if (await composeLogoGeometricLockup(dir, "Northstar") === null) throw new Error("logo_geometric_lockup_fixture");
    svgs.wordmark = await readFile(path.join(dir, LOGO_GEOMETRIC_WORDMARK_FILES.svg), "utf8");
    svgs.lockup = await readFile(path.join(dir, LOGO_GEOMETRIC_LOCKUP_SVG_FILE), "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

let browser: Browser | undefined;
let assets = { script: "", css: "" };
const lifetime = new AbortController();

beforeAll(async () => {
  assets = await compileLogoGeometric();
  await serverSvgs();
  browser = await launchChromiumViaNode({}, lifetime.signal);
}, 60_000);
afterAll(async () => {
  try { await browser?.close(); }
  finally { lifetime.abort(); }
});

/** Opens one page at a desktop width; `mount` renders a state into it, so a page serves several states. */
async function open(width: number, run: (page: Page) => Promise<void>): Promise<void> {
  if (!browser) throw new Error("logo_geometric_browser_missing");
  await withLogoGeometricPage(browser, { ...assets, width, dark: false }, run);
}

function mount(page: Page, status: Geometric | null, flags: { dark?: boolean; disabled?: boolean; loadFailed?: boolean } = {}): Promise<void> {
  return page.evaluate(options => globalThis.logoGeometricTest.mount(options), {
    locale: "en" as const, status, dark: flags.dark ?? false, disabled: flags.disabled ?? false, loadFailed: flags.loadFailed ?? false,
  });
}

const labels = (page: Page) => page.evaluate(() => globalThis.logoGeometricTest.labels());
const events = (page: Page) => page.evaluate(() => globalThis.logoGeometricTest.events);

/** Targets, clipping and text contrast inside the panel, measured in the page. */
function measure(page: Page) {
  return page.evaluate(async () => {
    const panel = document.querySelector("section");
    if (!panel) throw new Error("panel_missing");
    const visible = (element: Element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
    const targets = [...panel.querySelectorAll("button, textarea, input:not([type=radio]), label:has(input[type=radio])")].filter(visible).map(element => {
      const rect = element.getBoundingClientRect();
      return { name: element.textContent?.trim() ?? element.tagName, width: rect.width, height: rect.height, right: rect.right };
    });
    const channels = (color: string): number[] => (color.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = ([r = 0, g = 0, b = 0]: number[]) => {
      const linear = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    };
    // The colour actually behind an element: its own and its ancestors' backgrounds, translucent layers blended in.
    const behind = (element: Element): number[] => {
      const layers: number[][] = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        const [r = 0, g = 0, b = 0, a = 1] = channels(getComputedStyle(node).backgroundColor);
        if (getComputedStyle(node).backgroundColor === "rgba(0, 0, 0, 0)" || a === 0) continue;
        layers.push([r, g, b, a]);
        if (a >= 1) break;
      }
      return layers.reverse().reduce<number[]>((under, [r = 0, g = 0, b = 0, a = 1]) => [r * a + (under[0] ?? 255) * (1 - a), g * a + (under[1] ?? 255) * (1 - a), b * a + (under[2] ?? 255) * (1 - a)], [255, 255, 255]);
    };
    // Opacity fades text into what is behind it, so it counts toward contrast.
    const opacity = (element: Element): number => {
      let value = 1;
      for (let node: Element | null = element; node; node = node.parentElement) value *= Number(getComputedStyle(node).opacity);
      return value;
    };
    // Disabled buttons are exempt from contrast (WCAG 1.4.3); a closed choice's reason is not, it must stay readable.
    const contrast = [...panel.querySelectorAll("*")].filter(element => visible(element) && !element.closest("button:disabled") && [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()))
      .map(element => {
        const under = behind(element);
        const [r = 0, g = 0, b = 0, a = 1] = channels(getComputedStyle(element).color);
        const alpha = a * opacity(element);
        const background = luminance(under);
        const text = luminance([r * alpha + (under[0] ?? 255) * (1 - alpha), g * alpha + (under[1] ?? 255) * (1 - alpha), b * alpha + (under[2] ?? 255) * (1 - alpha)]);
        const [light, darkest] = text > background ? [text, background] : [background, text];
        return { text: element.textContent?.trim() ?? "", ratio: (light + 0.05) / (darkest + 0.05) };
      });
    // Each preview is awaited until decoded; one that fails reports no width, one that overflows ends past the viewport.
    const decoded = await Promise.all([...panel.querySelectorAll("img")].map(image => image.decode().then(() => image.naturalWidth, () => 0)));
    const images = [...panel.querySelectorAll("img")].map((image, index) => ({ alt: image.alt, width: decoded[index] ?? 0, right: image.getBoundingClientRect().right }));
    return { targets, contrast, images, background: getComputedStyle(panel).backgroundColor, viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth };
  });
}

for (const width of [1024, 1440]) {
  test(`Given the questions, review, wordmark and finished states at ${width}px in light and dark When rendered Then every control is a 44 px target, nothing overflows and text has 4.5:1 contrast`, async () => {
    await open(width, async page => {
      const backgrounds = new Set<string>();
      for (const dark of [false, true]) {
        for (const [state, status] of [["questions", UNANSWERED], ["review", REVIEW], ["wordmark", wordmarkReview()], ["complete", lockupComplete()]] as const) {
          await mount(page, status, { dark });
          const result = await measure(page);
          const where = `${state} ${dark ? "dark" : "light"}`;
          backgrounds.add(`${dark}:${result.background}`);
          // Questions: four parts, four directions and Start. Reviews: Approve and Ask for changes; complete: none. The plan bar adds one below 1280 px.
          const own = state === "questions" ? 9 : state === "complete" ? 0 : 2;
          expect({ where, targets: result.targets.length }).toEqual({ where, targets: state === "questions" ? 9 : own + (width < 1280 ? 1 : 0) });
          expect(result.images.filter(image => image.width === 0 || image.right > result.viewport + 0.5).map(image => `${where}: ${image.alt}`)).toEqual([]);
          expect(result.targets.filter(target => target.height < 44 || target.width < 44 || target.right > result.viewport + 0.5).map(target => `${where}: ${target.name}`)).toEqual([]);
          expect(result.scrollWidth).toBeLessThanOrEqual(result.viewport);
          // The finished state at 1024 px holds only the plan bar and the status line, so it measures two texts.
          expect(result.contrast.length).toBeGreaterThan(state === "complete" ? 1 : 3);
          expect(result.contrast.filter(entry => entry.ratio < 4.5).map(entry => `${where}: ${entry.text} ${entry.ratio.toFixed(2)}`)).toEqual([]);
        }
      }
      // Each theme paints one panel colour, and the two differ: the dark pass really rendered dark.
      expect(new Set([...backgrounds].map(entry => entry.split(":")[1])).size).toBe(2);
      expect(backgrounds.size).toBe(2);
    });
  }, 60_000);
}

test("Given the plan at 1440px When the review renders Then the plan is a pinned list and its toggle is hidden", async () => {
  await open(1440, async page => {
    await mount(page, REVIEW);
    const plan = page.getByRole("navigation", { name: (await labels(page)).plan });
    expect(await plan.locator("ol").isVisible()).toBe(true);
    expect(await plan.locator("button[aria-expanded]").isVisible()).toBe(false);
    expect(await plan.locator("li[aria-current=step]").count()).toBe(1);
  });
}, 30_000);

test("Given the plan at 1024px When its bar is opened by keyboard Then the steps show and the bar reports it", async () => {
  await open(1024, async page => {
    await mount(page, REVIEW);
    const plan = page.getByRole("navigation", { name: (await labels(page)).plan });
    const toggle = plan.locator("button[aria-expanded]");
    expect(await plan.locator("ol").isVisible()).toBe(false);
    await toggle.focus();
    await page.keyboard.press("Enter");
    expect(await toggle.getAttribute("aria-expanded")).toBe("true");
    expect(await plan.locator("li").count()).toBe(3);
    expect(await plan.locator("ol").isVisible()).toBe(true);
  });
}, 30_000);

test("Given the questions with every part open When answered by keyboard only Then nothing is preselected or closed and the answer is sent", async () => {
  await open(1440, async page => {
    await mount(page, UNANSWERED);
    const text = await labels(page);
    expect(await page.locator("input[type=radio]:checked").count()).toBe(0);
    expect(await page.locator("input[type=radio]:disabled").count()).toBe(0);
    const start = page.getByRole("button", { name: text.start });
    expect(await start.isDisabled()).toBe(true);
    const symbolOnly = page.getByRole("radio", { name: text.symbolOnly, exact: true });
    await symbolOnly.focus();
    await page.keyboard.press("Space");
    expect(await symbolOnly.isChecked()).toBe(true);
    await page.keyboard.press("Tab");
    expect(await page.getByRole("radio", { name: text.sharp }).evaluate(element => document.activeElement === element)).toBe(true);
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    expect(await start.evaluate(element => document.activeElement === element)).toBe(true);
    await page.keyboard.press("Enter");
    expect(await events(page)).toEqual([{ kind: "action", action: { action: "answer", parts: { choice: "symbol" }, direction: { choice: "sharp_geometric" } } }]);
  });
}, 30_000);

test("Given the parts Something else When chosen Then its own field takes focus, Start waits for words and the trimmed words are sent", async () => {
  await open(1440, async page => {
    await mount(page, UNANSWERED);
    const text = await labels(page);
    await page.getByRole("radio", { name: text.other, exact: true }).first().check();
    const field = page.getByRole("textbox", { name: text.partsOtherLabel });
    expect(await field.evaluate(element => document.activeElement === element)).toBe(true);
    await page.getByRole("radio", { name: text.sharp }).check();
    expect(await page.getByRole("button", { name: text.start }).isDisabled()).toBe(true);
    await field.fill("  A badge with the name  ");
    await page.getByRole("button", { name: text.start }).click();
    expect(await events(page)).toEqual([{ kind: "action", action: { action: "answer", parts: { other: "A badge with the name" }, direction: { choice: "sharp_geometric" } } }]);
  });
}, 30_000);

test("Given the direction Something else When chosen Then its field takes focus and the trimmed words are sent", async () => {
  await open(1024, async page => {
    await mount(page, UNANSWERED, { dark: true });
    const text = await labels(page);
    await page.getByRole("radio", { name: text.symbolOnly, exact: true }).check();
    await page.getByRole("radio", { name: text.other, exact: true }).last().check();
    const field = page.getByRole("textbox", { name: text.otherLabel });
    expect(await field.evaluate(element => document.activeElement === element)).toBe(true);
    expect(await page.getByRole("button", { name: text.start }).isDisabled()).toBe(true);
    await page.keyboard.type("  Calm and round  ");
    await page.keyboard.press("Enter");
    expect(await events(page)).toEqual([{ kind: "action", action: { action: "answer", parts: { choice: "symbol" }, direction: { other: "Calm and round" } } }]);
  });
}, 30_000);

test("Given a symbol waiting for review When approved or sent back with a note Then each action names the record on screen and Escape returns focus", async () => {
  await open(1440, async page => {
    await mount(page, REVIEW);
    const text = await labels(page);
    expect(await page.locator("section ul li").count()).toBe(2);
    await page.getByRole("button", { name: text.approve }).click();
    const revise = page.getByRole("button", { name: text.revise });
    await revise.click();
    const note = page.getByRole("textbox", { name: text.noteLabel });
    expect(await note.evaluate(element => document.activeElement === element)).toBe(true);
    await page.keyboard.type("draft");
    await page.keyboard.press("Escape");
    expect(await revise.evaluate(element => document.activeElement === element)).toBe(true);
    await page.keyboard.press("Enter");
    expect(await note.inputValue()).toBe("");
    expect(await page.getByRole("button", { name: text.sendNote }).isDisabled()).toBe(true);
    await page.keyboard.type("Open the lower counter");
    await page.getByRole("button", { name: text.sendNote }).click();
    expect(await events(page)).toEqual([
      { kind: "action", action: { action: "approve", step: "symbol", record_sha256: SHA } },
      { kind: "action", action: { action: "revise", step: "symbol", record_sha256: SHA, note: "Open the lower counter" } },
    ]);
  });
}, 30_000);

test("Given a turn running When the review renders Then the choices are disabled and a status line says the AI is working", async () => {
  await open(1440, async page => {
    await mount(page, REVIEW, { disabled: true });
    const text = await labels(page);
    expect(await page.getByRole("button", { name: text.approve }).isDisabled()).toBe(true);
    expect(await page.getByRole("button", { name: text.revise }).isDisabled()).toBe(true);
    expect(await page.getByRole("status").count()).toBe(1);
  });
}, 30_000);

test("Given a step not made yet, a finished flow or a failed load When rendered Then each offers only its one way forward", async () => {
  await open(1440, async page => {
    await mount(page, NOT_MADE);
    await page.getByRole("button", { name: (await labels(page)).make }).click();
    expect(await events(page)).toEqual([{ kind: "make" }]);
    await mount(page, COMPLETE);
    expect(await page.getByRole("status").count()).toBe(1);
    expect(await page.locator("section button:visible").count()).toBe(0);
    await mount(page, null, { loadFailed: true });
    await page.getByRole("alert").waitFor();
    await page.getByRole("button", { name: (await labels(page)).retry }).click();
    expect(await events(page)).toEqual([{ kind: "retry" }]);
  });
}, 30_000);

test("Given a wordmark waiting for review When rendered Then its server SVG shows as an image with its finding and Approve names the wordmark record", async () => {
  await open(1440, async page => {
    await mount(page, wordmarkReview());
    const text = await labels(page);
    const preview = page.getByRole("img", { name: text.wordmarkPreview });
    expect(await preview.evaluate(async element => { await (element as HTMLImageElement).decode(); return (element as HTMLImageElement).naturalWidth > 0 && element.getAttribute("src")?.startsWith("data:image/svg+xml"); })).toBe(true);
    // Shown as an image, the SVG adds no element of its own to the page.
    expect(await page.locator("section svg[aria-label=Northstar]").count()).toBe(0);
    expect(await page.locator("section ul li").count()).toBe(1);
    await page.getByRole("button", { name: text.approveWordmark }).click();
    expect(await events(page)).toEqual([{ kind: "action", action: { action: "approve", step: "wordmark", record_sha256: "e".repeat(64) } }]);
  });
}, 30_000);

test("Given every part approved When rendered Then the lockup preview shows under the finished status, and a lockup to remake offers its one button", async () => {
  await open(1024, async page => {
    await mount(page, lockupComplete());
    const text = await labels(page);
    expect(await page.getByRole("status").count()).toBe(1);
    expect(await page.getByRole("img", { name: text.lockupPreview }).evaluate(async element => { await (element as HTMLImageElement).decode(); return (element as HTMLImageElement).naturalWidth > 0; })).toBe(true);
    const stale = lockupComplete();
    await mount(page, { ...stale, plan: [stale.plan[0]!, stale.plan[1]!, { step: "lockup", status: "next" }], records: { ...stale.records, lockup: null }, previews: { ...stale.previews, lockup: null } });
    await page.getByRole("button", { name: text.makeLockup }).click();
    expect(await events(page)).toEqual([{ kind: "make" }]);
  });
}, 30_000);
