import { chromium } from "playwright-core";
import assert from "node:assert/strict";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { runtime, printCss } = JSON.parse(input);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.setContent('<style>body{margin:0}.deck-slide{width:1920px;height:1080px}body[data-deck-ready] .deck-slide{position:fixed;inset:0}</style>' + Array.from({ length: 29 }, (_, i) => `<section data-slide>${i + 1} / 29</section>`).join(""));
  await page.addScriptTag({ content: runtime });
  const visible = () => page.locator("[data-slide]:visible").count();
  assert.equal(await visible(), 1);
  assert.deepEqual(await page.locator("[data-active]").boundingBox(), { x: 0, y: 0, width: 1920, height: 1080 });
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("[data-active]").textContent(), "2 / 29");
  await page.evaluate(() => {
    const node = document.createElement("section");
    node.setAttribute("data-slide", "");
    node.textContent = "30 / 30";
    document.body.appendChild(node);
  });
  await page.waitForFunction(() => document.querySelectorAll(".deck-slide").length === 30);
  await page.keyboard.press("End");
  assert.equal(await visible(), 1);
  assert.equal(await page.locator("[data-active]").textContent(), "30 / 30");
  await page.addStyleTag({ content: printCss });
  await page.emulateMedia({ media: "print" });
  assert.equal(await visible(), 30);
  console.log(JSON.stringify({ slides: 29, visible: 1, navigation: true, insertedSlide: true, printSlides: 30 }));
} finally { await browser.close(); }
