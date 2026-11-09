import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Browser, Page } from "../../backend/node_modules/playwright-core";
import { launchChromiumViaNode } from "../../backend/src/services/chromium-node-launch";
import { compileExportConstruction, withExportConstruction } from "./helpers/export-construction-host";

let browser: Browser | undefined;
let assets = { script: "", css: "" };
const lifetime = new AbortController();

beforeAll(async () => {
  assets = await compileExportConstruction();
  browser = await launchChromiumViaNode({}, lifetime.signal);
}, 60_000);
afterAll(async () => {
  try { await browser?.close(); }
  finally { lifetime.abort(); }
});

function required(): Browser {
  if (!browser) throw new Error("export_construction_browser_missing");
  return browser;
}

async function openMenu(page: Page) {
  const labels = await page.evaluate(() => globalThis.exportConstructionTest.labels());
  await page.getByRole("button", { name: labels.export }).click();
  const sheet = page.getByRole("menuitem").filter({ hasText: labels.sheet });
  const gif = page.getByRole("menuitem").filter({ hasText: labels.gif });
  await sheet.waitFor();
  return { labels, sheet, gif };
}

for (const width of [1440, 1024]) {
  test(`Given a logo without its construction record at ${width}px When Export opens Then both construction entries are listed, disabled, and say why`, async () => {
    await withExportConstruction(required(), { ...assets, width, dark: false, constructionRecord: false, failingGif: false }, async page => {
      const { labels, sheet, gif } = await openMenu(page);
      for (const entry of [sheet, gif]) {
        expect(await entry.getAttribute("aria-disabled")).toBe("true");
        expect(await entry.textContent()).toContain(labels.missing);
      }
    });
  });

  test(`Given a logo with its construction record at ${width}px When Export opens Then both construction entries can be chosen`, async () => {
    await withExportConstruction(required(), { ...assets, width, dark: false, constructionRecord: true, failingGif: false }, async page => {
      const { labels, sheet, gif } = await openMenu(page);
      for (const entry of [sheet, gif]) {
        expect(await entry.getAttribute("aria-disabled")).toBeNull();
        expect(await entry.textContent()).not.toContain(labels.missing);
      }
    });
  });
}

test("Given a running draw-in GIF export When it fails as too large Then the error toast carries the construction copy, not the generic failure", async () => {
  await withExportConstruction(required(), { ...assets, width: 1440, dark: false, constructionRecord: true, failingGif: true }, async page => {
    const labels = await page.evaluate(() => globalThis.exportConstructionTest.labels());
    const alert = page.getByRole("alert");
    // The menu polls a running job every second; the server fails it on the second poll.
    await alert.waitFor({ timeout: 10_000 });
    expect(await alert.textContent()).toContain(labels.tooLarge);
  });
});
