import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFixture } from "./creation-canvas-fixtures.mjs";

const execute = promisify(execFile);
const require = createRequire(new URL("../../packages/backend/package.json", import.meta.url));
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const hash = value => createHash("sha256").update(value).digest("hex");

// Observe the asserted DOM state, not elapsed time or a polling interval.
async function state(locator, predicate, argument) {
  await locator.evaluate(`(element, argument) => new Promise((resolve, reject) => {
    const predicate = (${predicate.toString()});
    let observer, timer;
    const finish = () => { if (!predicate(element, argument)) return; observer?.disconnect(); clearTimeout(timer); resolve(); };
    observer = new MutationObserver(finish);
    observer.observe(element, { attributes: true, childList: true, subtree: true, characterData: true });
    timer = setTimeout(() => { observer.disconnect(); reject(new Error("Expected DOM state not reached")); }, 15000);
    finish();
  })`, argument);
}

export async function run({ page, context, base, home, check, shot, evidence }) {
  const ownedHome = await realpath(home);
  assert.ok(path.basename(ownedHome).startsWith("burnguard-e2e-home-"));
  const failures = [], outcomes = [], deniedTurns = [], browserErrors = [];
  const record = (name, value) => writeFile(path.join(evidence, `${name}.json`), JSON.stringify(value, null, 2));
  const guardPattern = `${base}/api/sessions/*/events`;
  const guard = async route => {
    if (route.request().method() !== "POST") return route.continue();
    deniedTurns.push(route.request().url());
    await route.abort("blockedbyclient");
  };
  const onError = error => browserErrors.push(String(error));
  const onConsole = message => { if (message.type() === "error") browserErrors.push({ text: message.text(), location: message.location() }); };
  const onRequestFailed = request => browserErrors.push({ url: request.url(), failure: request.failure() });
  page.on("pageerror", onError); page.on("console", onConsole); page.on("requestfailed", onRequestFailed);
  await context.route(guardPattern, guard);
  const button = name => page.getByRole("button", { name, exact: true });
  const frame = () => page.frameLocator('iframe[title="캔버스"]');
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:Arial}h1{padding:30px}main{height:1600px;background:linear-gradient(#dbeafe,#fed7aa)}</style></head><body><h1 id="fixture-hero" data-bg-node-id="hero">WORKSPACE_GAPS</h1><main>Local canvas fixture</main></body></html>';
  async function fixture(name) { return createFixture(page, base, ownedHome, name, { "index.html": html, "other.html": html.replace("WORKSPACE_GAPS", "OTHER_FILE") }, true); }
  async function scenario(name, action) {
    try {
      await check(name, async () => { const observation = await action(); outcomes.push({ name, status: "passed", observation }); return observation; });
    } catch (error) {
      const failure = { name, status: String(error).includes("HOST_WEBGL_UNAVAILABLE") ? "blocked-host" : "failed", error: String(error.stack ?? error) };
      failures.push(failure); outcomes.push(failure);
      await writeFile(path.join(evidence, `${name}-dom.txt`), await page.locator("body").innerText());
      const frames = [];
      for (const child of page.frames()) if (child !== page.mainFrame()) frames.push(await child.evaluate(() => ({ url: location.href, ready: document.readyState, html: document.documentElement.outerHTML })));
      await record(`${name}-frames`, frames);
      await record("defects", failures);
      console.error(`WORKSPACE OUTCOME ${JSON.stringify(failure)}`);
    }
  }
  async function writeAction(endpoint, action, method = "PUT") {
    const response = page.waitForResponse(response => response.url() === endpoint && response.request().method() === method);
    response.catch(() => {});
    await action();
    const saved = await response;
    assert.equal(saved.status(), 200, await saved.text());
    return saved;
  }
  async function getData(endpoint) {
    const response = await page.request.get(endpoint); assert.equal(response.status(), 200);
    return (await response.json()).data;
  }
  async function drag(x, y, dx, dy) {
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up();
  }
  async function renderedPixels(locator, name) {
    const bytes = await locator.screenshot({ path: path.join(evidence, `${name}.png`), animations: "disabled" });
    const image = await loadImage(bytes), canvas = createCanvas(image.width, image.height), ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data, colors = new Set();
    for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    assert.ok(colors.size > 30, `${name}: scene must contain shaded rendered geometry, not a flat background`);
    return { sha256: hash(bytes), width: image.width, height: image.height, colors: colors.size };
  }

  let sceneFixture, seeded;
  try {
    await scenario("workspace-drawing-tools-color-width-save-reopen-clear", async () => {
      const project = await fixture("Workspace drawing gaps");
      await button("그리기").click();
      const drawing = page.locator('svg[style*="touch-action: none"]');
      await drawing.waitFor();
      const endpointResponse = page.waitForResponse(response => response.request().method() === "PUT" && response.url().includes(`/projects/${project.id}/draws/`));
      endpointResponse.catch(() => {});
      await page.getByRole("radio", { name: "사각형", exact: true }).click();
      await page.getByRole("radio", { name: "색상 #3B82F6", exact: true }).click();
      await page.getByRole("radio", { name: "선 굵기 6px", exact: true }).click();
      await state(drawing, element => getComputedStyle(element).pointerEvents === "auto");
      const box = await drawing.boundingBox(); assert.ok(box);
      await drag(box.x + 220, box.y + 220, -120, -80);
      const initial = await endpointResponse; assert.equal(initial.status(), 200);
      const endpoint = initial.url();
      async function shapes() {
        const response = await page.request.get(endpoint); assert.equal(response.status(), 200);
        return page.evaluate(svg => Array.from(new DOMParser().parseFromString(svg, "image/svg+xml").querySelectorAll("[data-payload]")).map(node => JSON.parse(node.getAttribute("data-payload"))), await response.text());
      }
      const rectangle = (await shapes())[0];
      assert.equal(rectangle.type, "rect"); assert.equal(rectangle.stroke, "#3B82F6"); assert.equal(rectangle.strokeWidth, 6);
      assert.ok(Math.abs(rectangle.w - 120) < 2 && Math.abs(rectangle.h - 80) < 2, "backward drag normalizes rectangle geometry");
      await page.getByRole("radio", { name: "화살표", exact: true }).click();
      await page.getByRole("radio", { name: "색상 #10B981", exact: true }).click();
      await page.getByRole("radio", { name: "선 굵기 2px", exact: true }).click();
      await writeAction(endpoint, () => drag(box.x + 260, box.y + 160, 140, 100));
      const both = await shapes(); assert.equal(both.length, 2); assert.equal(both[1].type, "arrow"); assert.equal(both[1].strokeWidth, 2); assert.equal(both[1].stroke, "#10B981");
      await button("실행 취소").focus();
      await writeAction(endpoint, () => page.keyboard.press("Control+z")); assert.deepEqual(await shapes(), [rectangle]);
      await writeAction(endpoint, () => page.keyboard.press("Control+Shift+z")); assert.deepEqual(await shapes(), both);
      await page.reload({ waitUntil: "domcontentloaded" }); await button("그리기").click();
      await state(drawing, element => element.querySelectorAll(":scope > rect, :scope > g").length === 2);
      assert.deepEqual(await shapes(), both);
      // Switch through the real file tree and return: sidecars must not leak to another file.
      await button("디자인 파일").click();
      await page.getByRole("navigation", { name: "프로젝트 파일 탐색" }).getByRole("button", { name: /^other\.html(?:\s|$)/ }).click();
      await frame().getByRole("heading", { name: "OTHER_FILE", exact: true }).waitFor();
      if (await button("그리기").getAttribute("aria-pressed") !== "true") await button("그리기").click();
      await state(drawing, element => getComputedStyle(element).pointerEvents === "auto" && element.children.length === 0);
      await button("index.html").click();
      await state(drawing, element => element.querySelectorAll(":scope > rect, :scope > g").length === 2);
      await shot("workspace-drawing-reopened");
      await writeAction(endpoint, () => button("모두 지우기").click()); assert.deepEqual(await shapes(), []);
      await page.reload({ waitUntil: "domcontentloaded" }); await button("그리기").click();
      await state(drawing, element => getComputedStyle(element).pointerEvents === "auto" && element.children.length === 0);
      assert.equal(await button("모두 지우기").isDisabled(), true);
      return { shapes: both, keyboardUndoRedo: true, perFileIsolation: true, clearPersisted: true };
    });

    await scenario("workspace-viewport-boundaries-meta-wheel-pan-reset", async () => {
      await fixture("Workspace viewport gaps");
      const zoom = page.getByLabel("아트보드 확대 비율", { exact: true });
      await zoom.fill("0"); assert.equal(await zoom.inputValue(), "1");
      const controls = zoom.locator("xpath=../..");
      assert.equal(await controls.locator("button").first().isDisabled(), true);
      await zoom.fill("6500"); assert.equal(await zoom.inputValue(), "6400");
      await button("100% 초기화").click();
      await button("화면 이동").click();
      const iframe = page.locator('iframe[title="캔버스"]');
      const initial = await iframe.boundingBox();
      await drag(initial.x + 100, initial.y + 100, 65, 35);
      const moved = await iframe.boundingBox();
      assert.ok(Math.abs(moved.x - initial.x - 65) < 2 && Math.abs(moved.y - initial.y - 35) < 2);
      await page.mouse.move(moved.x + 180, moved.y + 180);
      await page.keyboard.down("Meta");
      try { await page.mouse.wheel(0, -120); } finally { await page.keyboard.up("Meta"); }
      await state(zoom, element => Number(element.value) > 100);
      const increased = Number(await zoom.inputValue());
      await button("100% 초기화").click(); assert.equal(await zoom.inputValue(), "100");
      const reset = await iframe.boundingBox(); assert.ok(Math.abs(reset.x - initial.x) < 2 && Math.abs(reset.y - initial.y) < 2);
      await button("화면 이동").click();
      await page.setViewportSize({ width: 680, height: 900 });
      await zoom.scrollIntoViewIfNeeded(); assert.equal(await zoom.isVisible(), true);
      await zoom.fill("80"); assert.equal(await zoom.inputValue(), "80");
      await button("100% 초기화").click();
      return { min: 1, max: 6400, metaWheelZoom: increased, pan: { x: 65, y: 35 }, narrowWidth: 680 };
    });

    // Real service-created, local-only fixtures. This bypasses graphic authentication
    // solely for workspace setup; it is not evidence of authenticated creation.
    await scenario("workspace-owned-deck-and-mixed-frame-fixtures", async () => {
      const code = `
        import {createProjectRecord} from './packages/backend/src/db/seed.ts';
        import {DECK_STAGE_JS} from './packages/backend/src/runtime/deck-stage.ts';
        import {mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';
        const document=(body,css='')=>'<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:Arial}h1{padding:30px}'+css+'</style></head><body>'+body+'</body></html>';
        const result={};
        for(const type of ['graphic','slide_deck']){
          const entrypoint=type==='graphic'?'index.html':'deck.html';
          const sizes=[{width:360,height:640},{width:800,height:400},{width:480,height:480}];
          const body=type==='graphic'?sizes.map((s,i)=>'<article id="frame-'+i+'" data-graphic-artboard style="width:'+s.width+'px;height:'+s.height+'px;background:'+['#dbeafe','#fed7aa','#bbf7d0'][i]+'"><h1>FRAME_'+i+'</h1></article>').join(''):[0,1,2].map(i=>'<section data-slide style="background:'+['#dbeafe','#fed7aa','#bbf7d0'][i]+'"><h1>SLIDE_'+i+'</h1><aside class="deck-notes">NOTES_'+i+'</aside></section>').join('')+'<script src="runtime/deck-stage.js"></script>';
          result[type]=await createProjectRecord({name:'Workspace '+type,type,designSystemId:null,backendId:'claude-code',optionsJson:JSON.stringify(type==='graphic'?{graphic_canvas:{schema_version:1,...sizes[0]},graphic_set:{schema_version:1,kind:'banner_set',frame_count:3,frames:sizes.map((size,index)=>({...size,label:'Frame '+index}))}}:{use_speaker_notes:true}),entrypoint,thumbnailPath:null,initializeArtifact:async stage=>{await writeFile(path.join(stage,entrypoint),document(body,'[data-slide]{width:1280px;height:720px}.deck-notes{display:none}body[data-presenter] .deck-notes{display:block}'));if(type==='slide_deck'){await mkdir(path.join(stage,'runtime'));await writeFile(path.join(stage,'runtime/deck-stage.js'),DECK_STAGE_JS);}}});
        }
        console.log(JSON.stringify(result));`;
      const result = await execute("bun", ["-e", code], { env: { ...process.env, BG_APP_ROOT: path.join(ownedHome, ".burnguard") }, timeout: 60000 });
      seeded = JSON.parse(result.stdout.trim().split("\n").at(-1));
      await record("seeded", seeded);
      return { graphic: seeded.graphic.id, deck: seeded.slide_deck.id, setup: "owned service fixtures, no provider or authenticated creation" };
    });

    await scenario("workspace-mixed-frame-navigator-keyboard-safe-zones", async () => {
      assert.ok(seeded);
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.goto(`${base}/projects/${seeded.graphic.id}`, { waitUntil: "domcontentloaded" });
      const navigator = page.getByRole("group", { name: "프레임 이동", exact: true });
      await state(navigator, element => element.textContent.includes("1 / 3"));
      assert.equal(await button("이전 프레임").isDisabled(), true);
      const sizes = await frame().locator("[data-graphic-artboard]").evaluateAll(elements => elements.map(element => ({ width: Number.parseFloat(getComputedStyle(element).width), height: Number.parseFloat(getComputedStyle(element).height) })));
      assert.deepEqual(sizes, [{ width: 360, height: 640 }, { width: 800, height: 400 }, { width: 480, height: 480 }]);
      await page.getByText(/^9:16 안전 영역 밖/).waitFor(); await shot("workspace-frame-portrait-safe-zone");
      await button("다음 프레임").click();
      await state(navigator, element => element.textContent.includes("2 / 3"));
      await page.getByText(/^9:16 안전 영역 밖/).waitFor({ state: "hidden" });
      const target = await frame().locator("#frame-1").boundingBox(), viewport = await page.locator('iframe[title="캔버스"]').boundingBox();
      assert.ok(target.y >= viewport.y - 2 && target.y < viewport.y + viewport.height, "navigator must actually reveal the target frame");
      await button("다음 프레임").focus(); await page.keyboard.press("ArrowRight");
      await state(navigator, element => element.textContent.includes("3 / 3")); assert.equal(await button("다음 프레임").isDisabled(), true);
      await button("이전 프레임").focus(); await page.keyboard.press("ArrowRight");
      assert.match(await navigator.innerText(), /3 \/ 3/);
      await page.keyboard.press("ArrowLeft"); await state(navigator, element => element.textContent.includes("2 / 3"));
      await button("이전 프레임").click(); await state(navigator, element => element.textContent.includes("1 / 3"));
      const saved = await (await page.request.get(`${base}/api/projects/${seeded.graphic.id}/fs/index.html`)).text();
      assert.equal(saved.includes("border-dashed"), false, "safe-zone UI must remain outside saved HTML");
      return { sizes, buttonAndKeyboardNavigation: true, boundaryClamping: true, safeZonesOutsideArtifact: true };
    });

    await scenario("workspace-deck-preview-runtime-navigation", async () => {
      await page.goto(`${base}/projects/${seeded.slide_deck.id}`, { waitUntil: "domcontentloaded" });
      await frame().locator("[data-slide] h1").first().waitFor();
      await frame().locator("[data-slide][data-active]").waitFor();
      await frame().locator("body").press("ArrowRight");
      await state(frame().locator("body"), element => element.querySelector("[data-slide][data-active] h1")?.textContent === "SLIDE_1");
      return { previewDeckKeyboardNavigation: true };
    });

    async function openPresentation() {
      await page.goto(`${base}/projects/${seeded.slide_deck.id}`, { waitUntil: "domcontentloaded" });
      await frame().locator("[data-slide] h1").first().waitFor();
      const present = page.getByRole("button", { name: /프레젠테이션|발표/ }).first();
      await present.click();
      const dialog = page.getByRole("dialog", { name: "프레젠테이션", exact: true }); await dialog.waitFor();
      const playback = page.frameLocator('iframe[title="프레젠테이션"]');
      await playback.locator("[data-slide] h1").first().waitFor();
      return { dialog, playback };
    }
    await scenario("workspace-presentation-keyboard-navigation", async () => {
      const { playback } = await openPresentation();
      await playback.locator("body[data-presenter] [data-slide][data-active]").waitFor();
      for (const [key, index] of [["ArrowRight", 1], ["End", 2], ["Home", 0], ["PageDown", 1], ["PageUp", 0], ["Space", 1], ["ArrowLeft", 0]]) {
        await playback.locator("body").press(key);
        await state(playback.locator("body"), (body, index) => Array.from(body.querySelectorAll("[data-slide]")).findIndex(element => element.hasAttribute("data-active")) === index, index);
      }
      await playback.locator("[data-slide][data-active] .deck-notes").waitFor();
      return { navigationKeys: 7, speakerNotes: true };
    });
    await scenario("workspace-presentation-controls-fullscreen-exit", async () => {
      const { dialog } = await openPresentation();
      await page.evaluate(() => new Promise((resolve, reject) => {
        const changed = () => { if (document.fullscreenElement) { document.removeEventListener("fullscreenchange", changed); clearTimeout(timer); resolve(); } };
        const timer = setTimeout(() => { document.removeEventListener("fullscreenchange", changed); reject(new Error("Presentation did not enter real fullscreen")); }, 15000);
        document.addEventListener("fullscreenchange", changed); changed();
      }));
      await shot("workspace-presentation-fullscreen");
      await dialog.getByRole("button", { name: "종료", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => document.fullscreenElement !== null), false);
      await openPresentation();
      // Exercise the actual browser Fullscreen API exit event, not a synthetic event.
      await page.evaluate(() => document.exitFullscreen());
      await dialog.waitFor({ state: "hidden" });
      return { actualFullscreen: true, buttonExit: true, browserFullscreenExit: true };
    });
    await scenario("workspace-presentation-escape-from-focused-frame", async () => {
      const { dialog, playback } = await openPresentation();
      await playback.locator("body").press("Escape");
      await dialog.waitFor({ state: "hidden", timeout: 5000 });
      return { focusedFrameEscapeClosesPresentation: true };
    });

    await scenario("workspace-chart-advanced-edit-render-save-reload", async () => {
      const project = await fixture("Workspace advanced chart gaps");
      await button("차트").click();
      const editor = page.getByRole("region", { name: "차트 편집기", exact: true });
      const endpoint = `${base}/api/projects/${project.id}/charts?path=index.html`;
      await editor.getByRole("button", { name: "혼합 +", exact: true }).click();
      const field = name => editor.getByLabel(name, { exact: true });
      await field("차트 제목").fill("WORKSPACE_REVENUE"); await field("차트 단위").fill("USD"); await field("차트 출처").fill("LOCAL_LEDGER_2026");
      await field("차트 데이터").fill("항목\tRevenue\tForecast\nAlpha\t10\t15\nBeta\t30\t22\nGamma\t20\t35");
      await field("계열 1 표현").selectOption("area"); await field("계열 2 표현").selectOption("line");
      await editor.locator("summary").filter({ hasText: "고급 · 크기, 설명, 색상" }).click();
      await field("차트 가로").fill("760"); await field("차트 세로").fill("420");
      await field("설명").fill("Machine authored fixture description");
      await field("차트 색상 1").fill("#cc2244");
      // Independent theme axis, not a chart-type/theme Cartesian product.
      const themes = [];
      for (const theme of ["brand", "paper", "midnight", "mono"]) {
        await field("차트 테마").selectOption(theme);
        await writeAction(endpoint, () => editor.getByRole("button", { name: "차트 저장", exact: true }).click());
        const saved = (await getData(endpoint)).charts[0]; assert.equal(saved.theme, theme); themes.push(theme);
        await state(editor, element => !element.querySelector('select[aria-label="저장된 차트"]').disabled);
      }
      const persisted = (await getData(endpoint)).charts[0];
      assert.equal(persisted.unit, "USD"); assert.equal(persisted.source, "LOCAL_LEDGER_2026"); assert.deepEqual(persisted.series.map(series => series.kind), ["area", "line"]);
      assert.equal(persisted.width, 760); assert.equal(persisted.height, 420); assert.equal(persisted.colors[0], "#cc2244");
      const savedFigure = frame().locator("figure[data-bg-chart]");
      await savedFigure.locator('svg [fill="#cc2244"]').first().waitFor();
      assert.equal(await savedFigure.locator("svg").getAttribute("viewBox"), "0 0 760 420");
      await savedFigure.locator("summary").click();
      await savedFigure.locator("table").waitFor();
      assert.match(await savedFigure.locator("table").innerText(), /Alpha/);
      const rendered = await savedFigure.locator("svg").evaluate(svg => ({ paths: svg.querySelectorAll("path").length, text: svg.textContent })); assert.ok(rendered.paths > 0);
      const standalone = await context.newPage();
      try {
        await standalone.setViewportSize({ width: 1600, height: 1200 });
        const savedHtml = await (await page.request.get(`${base}/api/projects/${project.id}/fs/index.html`)).text();
        await standalone.setContent(savedHtml, { waitUntil: "load" });
        const svg = standalone.locator("figure[data-bg-chart] svg");
        await svg.screenshot({ path: path.join(evidence, "workspace-chart-composed-svg.png") });
        assert.equal(await svg.getAttribute("viewBox"), "0 0 760 420");
      } finally { await standalone.close(); }
      await shot("workspace-chart-composed-rendered");
      // Invalid numeric data and malformed columns must prevent writes.
      for (const invalid of ["항목\tRevenue\nAlpha\tNaN", "항목\tRevenue\nAlpha\t1\t2"]) {
        await field("차트 데이터").fill(invalid);
        assert.equal(await editor.getByRole("button", { name: "차트 저장", exact: true }).isDisabled(), true);
        await editor.getByRole("alert").waitFor();
      }
      await editor.getByRole("button", { name: "저장본 다시 불러오기", exact: true }).click();
      await state(editor, element => !element.querySelector('select[aria-label="저장된 차트"]').disabled);
      await editor.getByRole("button", { name: "테마 색상 복원", exact: true }).click();
      await writeAction(endpoint, () => editor.getByRole("button", { name: "차트 저장", exact: true }).click());
      assert.deepEqual((await getData(endpoint)).charts[0].colors, []);
      await page.reload({ waitUntil: "domcontentloaded" }); await button("차트").click();
      await field("차트 제목").waitFor();
      await state(editor, element => !element.querySelector('select[aria-label="저장된 차트"]').disabled);
      assert.equal(await field("차트 제목").inputValue(), "WORKSPACE_REVENUE"); assert.equal(await field("차트 출처").inputValue(), "LOCAL_LEDGER_2026");
      return { themes, persisted, rendered, invalidDataBlocksSave: true, resetColorsPersisted: true };
    });

    await scenario("workspace-chart-radial-sankey-keyboard-validation", async () => {
      const project = await fixture("Workspace specialized chart gaps"); await button("차트").click();
      const editor = page.getByRole("region", { name: "차트 편집기", exact: true });
      const endpoint = `${base}/api/projects/${project.id}/charts?path=index.html`;
      await editor.getByRole("button", { name: "원형 진행률 +", exact: true }).click();
      await editor.getByLabel("차트 데이터", { exact: true }).fill("항목\tDone\nAlpha\t40\nBeta\t80");
      await editor.getByLabel("차트 목표값", { exact: true }).fill("60"); assert.equal(await editor.getByRole("button", { name: "차트 저장", exact: true }).isDisabled(), true);
      await editor.getByLabel("차트 목표값", { exact: true }).fill("100");
      await writeAction(endpoint, () => editor.getByRole("button", { name: "차트 저장", exact: true }).click());
      assert.equal((await getData(endpoint)).charts[0].radial_max, 100);
      await editor.getByRole("button", { name: "생키 +", exact: true }).click();
      const data = editor.getByLabel("차트 데이터", { exact: true });
      await data.fill("출발\t도착\t값\nA\tB\t10\nB\tA\t10"); assert.equal(await editor.getByRole("button", { name: "차트 저장", exact: true }).isDisabled(), true);
      await data.fill("출발\t도착\t값\nA\tB\t10\nB\tC"); await data.press("End"); await data.press("Tab"); await data.press("5");
      assert.ok((await data.inputValue()).endsWith("B\tC\t5"));
      await data.press("Shift+Tab"); assert.equal(await data.evaluate(element => element === document.activeElement), false);
      await writeAction(endpoint, () => editor.getByRole("button", { name: "차트 저장", exact: true }).click());
      const charts = (await getData(endpoint)).charts; assert.equal(charts[1].links.length, 2); assert.equal(charts[1].links[1].value, 5);
      await frame().locator("figure[data-bg-chart] svg").nth(1).waitFor();
      await page.reload({ waitUntil: "domcontentloaded" }); await frame().locator("figure[data-bg-chart] svg").nth(1).waitFor();
      return { radialTarget: 100, sankeyLinks: charts[1].links, cycleRejected: true, tabInsertionAndShiftTab: true };
    });

    await scenario("workspace-three-inspector-all-axes-shapes-delete-save-reload", async () => {
      sceneFixture = await fixture("Workspace 3D inspector gaps"); await button("3D 장면").click();
      const editor = page.getByRole("region", { name: "3D 장면 편집기", exact: true });
      const endpoint = `${base}/api/projects/${sceneFixture.id}/three-scene?path=index.html`;
      await editor.getByRole("button", { name: "구 +", exact: true }).click();
      const values = { "위치": [-1, 0.5, 1.5], "회전(도)": [15, 30, 45], "크기": [1.2, 0.8, 1.5] };
      for (const [field, vector] of Object.entries(values)) for (let axis = 0; axis < 3; axis++) await editor.getByLabel(`3D ${field} ${"XYZ"[axis]}`, { exact: true }).fill(String(vector[axis]));
      await editor.getByLabel("3D 오브젝트 색상", { exact: true }).fill("#ff9933");
      await editor.getByLabel("3D 배경색", { exact: true }).fill("#102030");
      await editor.getByRole("button", { name: "도넛 +", exact: true }).click();
      await editor.getByLabel("3D 위치 X", { exact: true }).fill("2");
      await editor.getByLabel("3D 오브젝트 색상", { exact: true }).fill("#33ccaa");
      await editor.getByRole("button", { name: "큐브 +", exact: true }).click();
      await editor.getByRole("button", { name: "선택 오브젝트 삭제", exact: true }).click();
      await writeAction(endpoint, () => editor.getByRole("button", { name: "HTML에 저장", exact: true }).click());
      const scene = (await getData(endpoint)).scene;
      assert.deepEqual(scene.objects.map(object => object.shape), ["sphere", "torus"]);
      assert.deepEqual(scene.objects[0].position, values["위치"]); assert.deepEqual(scene.objects[0].rotation, values["회전(도)"]); assert.deepEqual(scene.objects[0].scale, values["크기"]); assert.equal(scene.background, "#102030");
      await page.reload({ waitUntil: "domcontentloaded" }); await button("3D 장면").click();
      await editor.getByLabel("3D 위치 X", { exact: true }).waitFor();
      assert.equal(await editor.getByLabel("3D 위치 X", { exact: true }).inputValue(), "-1");
      await editor.getByRole("combobox").selectOption(scene.objects[1].id);
      assert.equal(await editor.getByLabel("3D 위치 X", { exact: true }).inputValue(), "2");
      await editor.getByLabel("3D 위치 X", { exact: true }).fill("4");
      await editor.getByRole("button", { name: "저장본 다시 불러오기", exact: true }).click();
      await state(editor, element => element.querySelector('input[aria-label="3D 위치 X"]')?.value === "-1");
      await record("three-scene-saved", scene);
      return { scene, inspectorSaveAndReload: true, renderingClaim: "separate required render scenario" };
    });
    await scenario("workspace-three-real-render-multiple-angles-orbit-wheel", async () => {
      assert.ok(sceneFixture);
      const editor = page.getByRole("region", { name: "3D 장면 편집기", exact: true });
      const probe = await page.evaluate(() => {
        const canvas = document.createElement("canvas"), errors = [];
        canvas.addEventListener("webglcontextcreationerror", event => errors.push(event.statusMessage));
        const gl = canvas.getContext("webgl2");
        return { webgl2: Boolean(gl), error: errors, userAgent: navigator.userAgent, renderer: gl ? gl.getParameter(gl.RENDERER) : null };
      });
      await record("webgl-host-probe", probe);
      if (!await editor.locator("canvas").count()) {
        assert.equal(probe.webgl2, false, "WebGL works on host but app did not mount its canvas: application defect");
        const observation = { ...probe, editorAlert: await editor.getByRole("alert").allTextContents(), frameAlert: await frame().locator("[data-bg-three] [role=alert]").allTextContents() };
        await record("webgl-host-limitation", observation);
        throw new Error(`HOST_WEBGL_UNAVAILABLE: no rendered scene; ${JSON.stringify(observation)}`);
      }
      const canvas = editor.locator("canvas");
      assert.equal(await canvas.evaluate(element => Boolean(element.getContext("webgl2"))), true);
      const front = await renderedPixels(canvas, "workspace-three-front");
      const box = await canvas.boundingBox(); await drag(box.x + box.width / 2, box.y + box.height / 2, 100, 35);
      const side = await renderedPixels(canvas, "workspace-three-side"); assert.notEqual(side.sha256, front.sha256);
      await drag(box.x + box.width / 2, box.y + box.height / 2, -30, 60);
      const above = await renderedPixels(canvas, "workspace-three-above"); assert.notEqual(above.sha256, side.sha256);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -180);
      const zoomed = await renderedPixels(canvas, "workspace-three-zoomed"); assert.notEqual(zoomed.sha256, above.sha256);
      await button("3D 장면").click();
      const savedCanvas = frame().locator("[data-bg-three] canvas"); await savedCanvas.waitFor();
      const saved = await renderedPixels(savedCanvas, "workspace-three-saved-scene");
      return { front, side, above, zoomed, saved };
    });

    await scenario("workspace-no-provider-turns", async () => { assert.deepEqual(deniedTurns, []); return { deniedTurns, providerExecution: false }; });
  } finally {
    await context.unroute(guardPattern, guard); page.off("pageerror", onError); page.off("console", onConsole); page.off("requestfailed", onRequestFailed);
    await record("workspace-outcomes", { outcomes, failures, browserErrors, deniedTurns, assumptions: ["Existing geometry, text, comments, all chart type defaults, Ctrl-wheel, pen and R26 coverage are intentionally not repeated.", "Owned fixtures seed graphic/deck projects without provider authentication; subsequent UI and persistence are real.", "A failed WebGL context is reported as a host blocker, never a rendered scene pass."] });
    await page.goto("about:blank");
  }
  if (failures.length) throw new Error(`${failures.length} workspace outcomes require attention; see ${path.join(evidence, "workspace-outcomes.json")}`);
}
