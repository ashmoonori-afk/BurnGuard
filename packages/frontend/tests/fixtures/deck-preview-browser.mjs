import { chromium } from "../../../backend/node_modules/playwright-core/index.mjs";
import assert from "node:assert/strict";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { html } = JSON.parse(input);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setContent('<iframe style="width:800px;height:500px;border:0" sandbox="allow-scripts"></iframe>');
  await page.locator("iframe").evaluate((frame, source) => { frame.srcdoc = source; }, html);
  const frame = await (await page.locator("iframe").elementHandle()).contentFrame();
  async function fits(selector) {
    await frame.waitForFunction(selector => {
      const element = document.querySelector(selector);
      if (!element || !document.documentElement.hasAttribute("data-bg-deck-fit")) return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.left >= -0.5 && box.top >= -0.5 && box.right <= innerWidth + 0.5 && box.bottom <= innerHeight + 0.5;
    }, selector);
  }
  await fits(".placeholder");
  for (const [width, height] of [[296, 591], [1200, 300], [800, 500]]) {
    await page.locator("iframe").evaluate((iframe, size) => { iframe.style.width = size[0] + "px"; iframe.style.height = size[1] + "px"; }, [width, height]);
    await frame.waitForFunction(size => innerWidth === size[0] && innerHeight === size[1], [width, height]);
    await fits(".placeholder");
  }
  await frame.evaluate(() => {
    document.querySelector("[data-active]").removeAttribute("data-active");
    document.querySelectorAll("[data-slide]")[1].setAttribute("data-active", "");
  });
  await fits("[data-active]");
  assert.equal(await frame.locator("[data-active]").evaluate(element => element.offsetWidth), 1920);
  const hit = await frame.evaluate(() => {
    const node = document.querySelector("h1");
    const rect = node.getBoundingClientRect();
    return document.elementFromPoint(rect.x + 5, rect.y + 5)?.getAttribute("data-bg-node-id");
  });
  assert.equal(hit, "heading");
  await frame.evaluate(() => {
    const child = document.createElement("div");
    child.id = "grown";
    child.style.cssText = "width:3200px;height:1600px;background:red";
    document.querySelector("[data-active]").appendChild(child);
  });
  await fits("#grown");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ fit: true, resize: true, switch: true, growth: true, hit: true }));
} finally { await browser.close(); }
