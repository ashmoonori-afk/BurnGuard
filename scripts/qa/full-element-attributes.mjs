import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { createFixture } from "./creation-canvas-fixtures.mjs";

const require = createRequire(new URL("../../packages/backend/package.json", import.meta.url));
const { parse } = require("node-html-parser");
const svg = (color, width) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="90"><rect width="100%" height="100%" fill="${color}"/></svg>`;
const initialSvg = svg("#2244aa", 160);
const replacementSvg = svg("#dd6622", 220);
const inlineSvg = svg("#228844", 190);
const dataImage = `data:image/svg+xml;base64,${Buffer.from(inlineSvg).toString("base64")}`;
const documentHtml = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px;font-family:Arial}h1{margin:0 0 20px;font-size:24px}a{display:block;width:260px;padding:16px;background:#dbeafe;margin-bottom:20px}img{display:block;margin-bottom:20px}#destination{padding:16px;background:#eee}</style></head><body><h1 id="fixture-hero" data-bg-node-id="hero">ELEMENT_ATTRIBUTES</h1><a id="fixture-link" data-bg-node-id="link" href="#original" title="Original link title">ATTRIBUTE_LINK</a><img id="fixture-image" data-bg-node-id="image" src="images/original.svg" alt="Original blue image"><div id="destination" data-bg-node-id="destination">LOCAL_DESTINATION</div></body></html>`;

// Real local backend and canvas; fixtures only establish owned project bytes.
// No provider responses are fabricated, and unexpected generation is blocked.
export async function run({ page, context, base, home, check, evidence }) {
  const ownedHome = await realpath(home);
  assert.ok(path.basename(ownedHome).startsWith("burnguard-e2e-home-"));
  const failures = [], outcomes = [], writes = [], deniedTurns = [];
  const button = name => page.getByRole("button", { name, exact: true });
  const canvas = () => page.locator('iframe[title="캔버스"]');
  const frame = () => page.frameLocator('iframe[title="캔버스"]');
  const attributes = () => page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "고급 속성" }) });
  const record = (name, value) => writeFile(path.join(evidence, `${name}.json`), JSON.stringify(value, null, 2));
  const guardPattern = `${base}/api/sessions/*/events`;
  const guard = async route => {
    if (route.request().method() !== "POST") return route.continue();
    deniedTurns.push(route.request().url());
    await route.abort("blockedbyclient");
  };
  await context.route(guardPattern, guard);
  let project;
  const endpoint = () => `${base}/api/projects/${project.id}/fs/index.html`;
  const canonical = () => readFile(path.join(ownedHome, ".burnguard", "data", "projects", project.id, "index.html"), "utf8");
  const node = (html, id) => {
    const target = parse(html).querySelector(`#fixture-${id}`);
    assert.ok(target, `Missing canonical ${id}`);
    return target;
  };
  async function scenario(name, action) {
    try {
      await check(name, async () => {
        const observation = await action();
        outcomes.push({ name, ok: true, observation });
        return observation;
      });
    } catch (error) {
      const failure = { name, ok: false, error: String(error.stack ?? error) };
      failures.push(failure); outcomes.push(failure);
      await writeFile(path.join(evidence, `${name}-dom.txt`), await page.locator("body").innerText());
      await record("outcomes", { outcomes, failures, writes, deniedTurns });
    }
  }
  async function fixture(name) {
    project = await createFixture(page, base, ownedHome, name, {
      "index.html": documentHtml,
      "images/original.svg": initialSvg,
      "images/replacement.svg": replacementSvg,
    }, true);
    await canvas().and(page.locator('[aria-busy="false"]')).waitFor();
    await button("편집").click();
    return project;
  }
  async function select(id) {
    await canvas().and(page.locator('[aria-busy="false"]')).waitFor();
    const target = frame().locator(`#fixture-${id}`);
    const box = await target.boundingBox(); assert.ok(box, `No visible bounds for ${id}`);
    // EditLayer intentionally intercepts the iframe: click the actual overlay at
    // the measured element center, not a force-click through it or a DOM click.
    const overlay = page.locator('div.absolute.inset-0[style*="pointer-events: auto"][style*="cursor: crosshair"]');
    assert.equal(await overlay.count(), 1);
    const bounds = await overlay.boundingBox(); assert.ok(bounds);
    const x = box.x + box.width / 2 - bounds.x, y = box.y + box.height / 2 - bounds.y;
    assert.ok(x > 0 && y > 0 && x < bounds.width && y < bounds.height, "Element center must be inside the real edit layer");
    await overlay.click({ position: { x, y } });
    await page.getByLabel("텍스트 내용", { exact: true }).waitFor();
    if (await attributes().getAttribute("open") === null) await attributes().locator("summary").click();
    await attributes().getByText(new RegExp(`· ${id}$`)).waitFor();
  }
  async function row(key) {
    const names = attributes().getByRole("textbox", { name: /^속성 \d+ 이름$/ });
    const keys = await names.evaluateAll(elements => elements.map(element => element.value));
    const index = keys.indexOf(key); assert.notEqual(index, -1, `Missing implemented attribute row ${key}; actual=${keys.join(",")}`);
    return names.nth(index).locator("..");
  }
  const valueField = async key => (await row(key)).getByRole("textbox", { name: /^속성 \d+ 값$/ });
  async function set(key, value) { await (await valueField(key)).fill(value); }
  async function save(label, expectedStatus = 200) {
    const before = await canonical();
    const oldKey = await canvas().getAttribute("data-document-key");
    const responseSignal = page.waitForResponse(response => response.url() === endpoint() && response.request().method() === "PATCH");
    responseSignal.catch(() => {});
    // Subscribe before Save; frame identity plus readiness is the exact refresh
    // contract. No sleeps, polling intervals, forced actions or evaluate-clicks.
    const refreshed = expectedStatus === 200
      ? page.locator(`iframe[title="캔버스"][aria-busy="false"]:not([data-document-key=${JSON.stringify(oldKey)}])`).waitFor({ timeout: 90_000 })
      : null;
    refreshed?.catch(() => {});
    await button("저장").click();
    const response = await responseSignal;
    const payload = await response.json();
    const after = await canonical();
    const observation = { label, projectId: project.id, status: response.status(), request: response.request().postDataJSON(), response: payload, before, after };
    writes.push(observation);
    await record("writes", writes);
    assert.equal(response.status(), expectedStatus, `${label}: ${JSON.stringify(payload)}; canonicalChanged=${before !== after}`);
    if (refreshed) await refreshed;
    // onSuccess awaits audit invalidation; a cold Chromium capability probe has
    // a 45-second backend budget. Bound the actual settled UI state accordingly.
    await button("저장").waitFor({ timeout: 90_000 });
    assert.equal(await button("저장").isEnabled(), true);
    return observation;
  }
  async function reloadSelect(id) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await canvas().and(page.locator('[aria-busy="false"]')).waitFor();
    await button("편집").click();
    await select(id);
  }
  async function decodedImage(expectedSvg, expectedWidth) {
    const rendered = await frame().locator("#fixture-image").evaluate(async image => {
      await image.decode();
      return { src: image.getAttribute("src"), alt: image.alt, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, width: image.getBoundingClientRect().width };
    });
    assert.equal(rendered.naturalWidth, expectedWidth); assert.equal(rendered.naturalHeight, 90); assert.ok(rendered.width > 0);
    assert.match(rendered.src, /^data:image\/svg\+xml;base64,/);
    assert.equal(Buffer.from(rendered.src.split(",")[1], "base64").toString(), expectedSvg);
    return rendered;
  }
  try {
    await scenario("attributes-link-safe-href-save-and-reload", async () => {
      await fixture("Element attributes safe link"); await select("link");
      assert.equal(await (await valueField("href")).inputValue(), "#original");
      const variants = ["#destination", "index.html#destination", "https://example.invalid/attribute-destination?x=1&y=2"];
      for (const href of variants) {
        await set("href", href);
        const saved = await save(`safe href ${href}`);
        assert.deepEqual(saved.request.attributes, { href });
        assert.equal(node(saved.after, "link").getAttribute("href"), href);
        assert.equal(await frame().locator("#fixture-link").getAttribute("href"), href);
        await reloadSelect("link");
        assert.equal(await (await valueField("href")).inputValue(), href);
      }
      return { safeHrefVariants: variants, persistedAcrossReload: true, externalNavigation: "Not clicked; no outbound request needed to prove editing" };
    });
    await scenario("attributes-image-alt-save-and-reload", async () => {
      await fixture("Element attributes image alt"); await select("image");
      const alt = 'Diagram: A & B "quoted" <not markup>';
      await set("alt", alt);
      const saved = await save("image alt");
      assert.deepEqual(saved.request.attributes, { alt });
      assert.equal(node(saved.after, "image").getAttribute("alt"), alt);
      assert.equal(node(saved.after, "image").getAttribute("src"), "images/original.svg", "alt-only edit must not canonicalize the preview data URL");
      assert.equal((await decodedImage(initialSvg, 160)).alt, alt);
      await reloadSelect("image"); assert.equal(await (await valueField("alt")).inputValue(), alt);
      return { alt, originalLocalSrcPreserved: true, persistedAcrossReload: true };
    });
    await scenario("attributes-image-src-local-and-data-save-reload-render", async () => {
      await fixture("Element attributes image source"); await select("image");
      const observedInitialSrc = await (await valueField("src")).inputValue();
      for (const [src, bytes, width] of [["images/replacement.svg", replacementSvg, 220], [dataImage, inlineSvg, 190]]) {
        await set("src", src);
        const saved = await save(`image source ${width}`);
        assert.deepEqual(saved.request.attributes, { src });
        assert.equal(node(saved.after, "image").getAttribute("src"), src);
        assert.equal(node(saved.after, "image").getAttribute("alt"), "Original blue image");
        await decodedImage(bytes, width);
        await reloadSelect("image");
        const reopenedSrc = await (await valueField("src")).inputValue();
        assert.equal(Buffer.from(reopenedSrc.split(",")[1], "base64").toString(), bytes, "the implemented editor reads the embedded preview src on fresh selection");
        await decodedImage(bytes, width);
      }
      return { observedInitialSrc, localAndDataSrcSaved: true, decodedWidths: [220, 190], note: "Reselection exposes embedded preview data URL, while canonical local src stays relative" };
    });
    await scenario("attributes-add-rename-delete-row-persistence", async () => {
      await fixture("Element attributes rows"); await select("link");
      await button("+ 추가").click();
      const names = attributes().getByRole("textbox", { name: /^속성 \d+ 이름$/ });
      await names.last().fill("aria-label");
      await attributes().getByRole("textbox", { name: /^속성 \d+ 값$/ }).last().fill("ADDED_LINK_LABEL");
      let saved = await save("add aria-label"); assert.deepEqual(saved.request.attributes, { "aria-label": "ADDED_LINK_LABEL" });
      assert.equal(await frame().getByRole("link", { name: "ADDED_LINK_LABEL", exact: true }).count(), 1);
      await (await row("aria-label")).getByRole("textbox", { name: /^속성 \d+ 이름$/ }).fill("data-qa-label");
      saved = await save("rename attribute"); assert.deepEqual(saved.request.attributes, { "data-qa-label": "ADDED_LINK_LABEL", "aria-label": null });
      assert.equal(node(saved.after, "link").hasAttribute("aria-label"), false);
      assert.equal(node(saved.after, "link").getAttribute("data-qa-label"), "ADDED_LINK_LABEL");
      await (await row("data-qa-label")).getByRole("button", { name: "속성 삭제", exact: true }).click();
      saved = await save("delete attribute"); assert.deepEqual(saved.request.attributes, { "data-qa-label": null });
      await reloadSelect("link");
      assert.equal(node(await canonical(), "link").hasAttribute("data-qa-label"), false);
      assert.equal(await frame().locator("#fixture-link").getAttribute("data-qa-label"), null);
      assert.equal(await names.evaluateAll(elements => elements.some(element => element.value === "data-bg-node-id")), false);
      return { add: true, rename: true, delete: true, immutableNodeIdNotExposed: true, persistedAcrossReload: true };
    });
    await scenario("attributes-selection-clear-discards-unsaved-drafts", async () => {
      await fixture("Element attributes clear selection");
      const before = await canonical(), patchRequests = [];
      const listener = request => { if (request.url() === endpoint() && request.method() === "PATCH") patchRequests.push(request.postDataJSON()); };
      page.on("request", listener);
      try {
        for (const [id, key, draft] of [["link", "href", "#discarded"], ["image", "alt", "DISCARDED_ALT"], ["image", "src", dataImage]]) {
          await select(id); const original = await (await valueField(key)).inputValue();
          await set(key, draft); await button("선택 해제").click();
          await page.getByLabel("텍스트 내용", { exact: true }).waitFor({ state: "hidden" });
          await select(id); assert.equal(await (await valueField(key)).inputValue(), original);
        }
        await button("선택 해제").click();
        await page.getByLabel("텍스트 내용", { exact: true }).waitFor({ state: "hidden" });
        await page.reload({ waitUntil: "domcontentloaded" }); await canvas().and(page.locator('[aria-busy="false"]')).waitFor();
        assert.equal(await canonical(), before); assert.deepEqual(patchRequests, []);
      } finally { page.off("request", listener); }
      return { discarded: ["href", "alt", "src"], patchRequests, exactCanonicalBytesUnchanged: true, cancelControl: "No Cancel exists; Clear selection is implemented" };
    });
    for (const [id, attribute, unsafe] of [["link", "href", "javascript:alert('ATTRIBUTE_UNSAFE')"], ["image", "src", "javascript:alert('ATTRIBUTE_UNSAFE')"], ["link", "href", "data:text/html,<script>alert('ATTRIBUTE_UNSAFE')</script>"]]) {
      await scenario(`attributes-unsafe-${attribute}-${unsafe.startsWith("data:") ? "data-html" : "javascript"}-rejected`, async () => {
        await fixture(`Element unsafe ${attribute} ${unsafe.split(":")[0]}`); await select(id);
        const before = await canonical();
        await set(attribute, unsafe);
        const saved = await save(`reject unsafe ${attribute}: ${unsafe}`, 422);
        assert.equal(saved.after, before, "Rejected URL must leave exact canonical bytes unchanged");
        return { unsafe, status: saved.status, exactCanonicalBytesUnchanged: true };
      });
    }
    await scenario("attributes-no-provider-calls", async () => {
      assert.deepEqual(deniedTurns, []);
      return { providerCalls: 0, deniedTurns, fixtureMode: "real isolated local import and filesystem seed; no model/provider requests" };
    });
  } finally {
    await record("outcomes", { outcomes, failures, writes, deniedTurns, implementedControls: ["text content", "Advanced attributes disclosure", "attribute name", "attribute value", "add", "delete", "Save", "Clear selection"], assumptions: ["Existing text-content edit coverage is not repeated", "Local fixture import is setup, not evidence of creation", "No dedicated href/alt/src or Cancel fields exist", "Unsafe values are never navigated or executed"] });
    await context.unroute(guardPattern, guard);
    await page.goto("about:blank");
  }
  if (failures.length) throw new Error(`${failures.length} attribute checks failed; see ${path.join(evidence, "outcomes.json")}`);
}
