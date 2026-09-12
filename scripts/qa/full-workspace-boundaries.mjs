#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFixture } from "./creation-canvas-fixtures.mjs";

// Run through full-feature-runner.mjs: one owned backend/browser and automatic cleanup.
// Fault rows are explicitly M; no response fixture is used for successful persistence.
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
async function state(locator, predicate, argument) {
  await locator.evaluate(`(element, argument) => new Promise((resolve, reject) => {
    const predicate = (${predicate.toString()});
    let timer;
    const observer = new MutationObserver(finish);
    function finish() { if (predicate(element, argument)) { observer.disconnect(); clearTimeout(timer); resolve(); } }
    observer.observe(element, {subtree:true, childList:true, attributes:true, characterData:true});
    timer = setTimeout(() => { observer.disconnect(); reject(new Error('Boundary DOM state not reached')); }, 15000);
    finish();
  })`, argument);
}

export async function run({ page, context, base, home, check, shot, evidence }) {
  const ownedHome = await realpath(home);
  assert.ok(path.basename(ownedHome).startsWith("burnguard-e2e-home-"));
  const outcomes = [], failures = [], deniedTurns = [], requests = [];
  const record = (name, value) => writeFile(path.join(evidence, `${name}.json`), JSON.stringify(value, null, 2));
  const button = name => page.getByRole("button", { name, exact: true });
  const canvas = () => page.frameLocator('iframe[data-document-key][aria-busy="false"]');
  const ready = () => page.locator('iframe[data-document-key][aria-busy="false"]').waitFor();
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:Arial}h1{color:#112233}</style></head><body><h1 id="fixture-hero">BOUNDARY_FIXTURE</h1></body></html>';
  const guardPattern = `${base}/api/sessions/*/events`;
  const guard = async route => {
    if (route.request().method() !== "POST") return route.continue();
    deniedTurns.push(route.request().url());
    await route.abort("blockedbyclient");
  };
  const onRequest = request => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) requests.push({ method: request.method(), url: request.url() }); };
  page.on("request", onRequest);
  await context.route(guardPattern, guard);
  async function scenario(name, action, mode = "live-local") {
    try {
      await check(name, async () => { const observation = await action(); outcomes.push({ name, mode, ok: true, observation }); return observation; }, mode);
    } catch (error) {
      const result = { name, mode, ok: false, error: String(error.stack ?? error) };
      outcomes.push(result); failures.push(result);
      await writeFile(path.join(evidence, `${name}-dom.txt`), await page.locator("body").innerText());
      console.error(JSON.stringify(result));
    }
    await record("workspace-boundaries-outcomes", { outcomes, failures, deniedTurns, requests });
  }
  async function fixture(name, files = {}) {
    const project = await createFixture(page, base, ownedHome, name, { "index.html": html, ...files }, true);
    await ready();
    return project;
  }
  async function getData(url) { const response = await page.request.get(url); assert.equal(response.status(), 200); return (await response.json()).data; }
  async function save(url, action) {
    const response = page.waitForResponse(r => r.url() === url && r.request().method() === "PUT");
    response.catch(() => {});
    await action();
    const result = await response;
    assert.equal(result.status(), 200, await result.text());
  }
  async function original(project, name) {
    const response = await page.request.get(`${base}/api/projects/${project.id}/fs/${name}`);
    assert.equal(response.status(), 200);
    return response.body();
  }
  const preview = () => page.getByRole("region", { name: "파일 미리보기", exact: true });
  async function openFile(name) {
    await page.getByRole("navigation", { name: "프로젝트 파일 탐색", exact: true }).locator(`button[title="${name}"]`).click();
    await preview().locator(`h3[title="${name}"]`).waitFor();
    await preview().locator('[aria-busy="false"]').waitFor();
  }
  async function downloadOriginal(name, expected) {
    const event = page.waitForEvent("download"); event.catch(() => {});
    await preview().getByRole("link", { name: "원본 다운로드", exact: true }).click();
    const download = await event;
    assert.equal(download.suggestedFilename(), name);
    const destination = path.join(evidence, `original-${name}`);
    await download.saveAs(destination);
    assert.equal(await download.failure(), null);
    const bytes = await readFile(destination);
    assert.deepEqual(bytes, expected, `Original download must preserve every byte of ${name}`);
    return { bytes: bytes.length, sha256: sha256(bytes), filename: download.suggestedFilename() };
  }

  let chartsProject, filesProject, historyProject;
  try {
    await scenario("boundary-chart32-save-reopen-reject33", async () => {
      chartsProject = await fixture("Chart capacity boundary");
      const url = `${base}/api/projects/${chartsProject.id}/charts?path=index.html`;
      await button("차트").click();
      const editor = page.getByRole("region", { name: "차트 편집기", exact: true });
      const select = editor.getByLabel("저장된 차트", { exact: true });
      const savedIds = [];
      for (let index = 1; index <= 32; index++) {
        await editor.getByRole("button", { name: "막대 +", exact: true }).click();
        await editor.getByLabel("차트 제목", { exact: true }).fill(`BOUNDARY_CHART_${index}`);
        await save(url, () => editor.getByRole("button", { name: "차트 저장", exact: true }).click());
        await state(select, (element, count) => !element.disabled && element.options.length === count + 1, index);
        const document = await getData(url);
        assert.equal(document.charts.length, index);
        assert.equal(document.charts.at(-1).title, `BOUNDARY_CHART_${index}`);
        savedIds.push(document.charts.at(-1).id);
      }
      assert.equal(new Set(savedIds).size, 32);
      const before = await original(chartsProject, "index.html");
      const addButtons = editor.getByRole("button", { name: / \+$/ });
      assert.equal(await addButtons.count(), 8);
      const writesBefore = requests.filter(r => r.url === url && r.method === "PUT").length;
      for (const add of await addButtons.all()) {
        assert.equal(await add.isDisabled(), true);
        // Physical pointer click on a disabled native control, without force or dispatchEvent.
        await add.scrollIntoViewIfNeeded(); const box = await add.boundingBox(); assert.ok(box);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }
      assert.equal(requests.filter(r => r.url === url && r.method === "PUT").length, writesBefore);
      assert.deepEqual(await original(chartsProject, "index.html"), before);
      await page.reload({ waitUntil: "domcontentloaded" }); await ready(); await button("차트").click();
      await state(select, element => !element.disabled && element.options.length === 33);
      assert.deepEqual((await getData(url)).charts.map(chart => chart.id), savedIds);
      assert.equal(await canvas().locator("figure[data-bg-chart]").count(), 32);
      for (const add of await addButtons.all()) assert.equal(await add.isDisabled(), true);
      return { charts: 32, distinctIds: savedIds.length, realUISaves: 32, rejectedAddControls: 8, originalSha256: sha256(before), reopened: true };
    });

    await scenario("boundary-scene16-save-reopen-reject17", async () => {
      const project = await fixture("Scene capacity boundary");
      const url = `${base}/api/projects/${project.id}/three-scene?path=index.html`;
      await button("3D 장면").click();
      const editor = page.getByRole("region", { name: "3D 장면 편집기", exact: true });
      const select = editor.getByRole("combobox");
      for (let index = 0; index < 16; index++) {
        await editor.getByRole("button", { name: ["큐브 +", "구 +", "도넛 +"][index % 3], exact: true }).click();
        assert.equal(await select.locator("option").count(), index + 2);
        await editor.getByLabel("3D 위치 X", { exact: true }).fill(String(index - 8));
      }
      const ids = await select.locator('option:not([value=""])').evaluateAll(elements => elements.map(element => element.value));
      assert.equal(new Set(ids).size, 16);
      for (const add of await editor.getByRole("button", { name: / \+$/ }).all()) {
        assert.equal(await add.isDisabled(), true);
        const box = await add.boundingBox(); assert.ok(box); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }
      assert.equal(await select.locator("option").count(), 17);
      await save(url, () => editor.getByRole("button", { name: "HTML에 저장", exact: true }).click());
      const saved = (await getData(url)).scene;
      assert.deepEqual(saved.objects.map(object => object.id), ids);
      assert.deepEqual(saved.objects.map(object => object.position[0]), Array.from({ length: 16 }, (_, i) => i - 8));
      assert.deepEqual(saved.objects.map(object => object.shape), Array.from({ length: 16 }, (_, i) => ["cube", "sphere", "torus"][i % 3]));
      const bytes = await original(project, "index.html");
      await page.reload({ waitUntil: "domcontentloaded" }); await ready(); await button("3D 장면").click();
      await state(select, element => element.options.length === 17);
      for (const add of await editor.getByRole("button", { name: / \+$/ }).all()) assert.equal(await add.isDisabled(), true);
      assert.deepEqual((await getData(url)).scene, saved);
      assert.deepEqual(await original(project, "index.html"), bytes);
      return { objects: saved.objects, rejectedAddControls: 3, reopened: true, renderingClaim: false, originalSha256: sha256(bytes) };
    });

    const textFiles = {
      "boundary.txt": Buffer.from("TEXT_BOUNDARY\r\nUTF8: 한글 café\r\n<script>window.BOUNDARY_EXECUTED=true</script>\r\n"),
      "boundary.json": Buffer.from('{\r\n  "sentinel": "JSON_BOUNDARY", "items": [0, false, null, "한글"]\r\n}\r\n'),
      "boundary.md": Buffer.from('# MARKDOWN_BOUNDARY\n\n**literal markdown**\n\n<script>window.BOUNDARY_EXECUTED=true</script>\n'),
      "boundary.bin": Buffer.from(Array.from({ length: 8192 }, (_, i) => i % 256)),
      "large-boundary.txt": Buffer.concat([Buffer.from("LARGE_BOUNDARY_START\n"), Buffer.alloc(1024 * 1024, 65), Buffer.from("\nFULL_ORIGINAL_TAIL_한글\r\n")]),
      "boundary.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6sYQAAAAASUVORK5CYII=", "base64"),
    };
    await scenario("boundary-files-owned-fixture", async () => {
      filesProject = await fixture("Design Files boundary", textFiles);
      await button("디자인 파일").click();
      return { project: filesProject.id, files: Object.fromEntries(Object.entries(textFiles).map(([name, bytes]) => [name, { bytes: bytes.length, sha256: sha256(bytes) }])) };
    });
    for (const name of ["boundary.txt", "boundary.json", "boundary.md"]) await scenario(`boundary-preview-${name}`, async () => {
      assert.ok(filesProject);
      await openFile(name);
      assert.equal(await preview().locator("pre").textContent(), textFiles[name].toString("utf8"));
      assert.equal(await preview().locator("script,iframe").count(), 0);
      assert.equal(await page.evaluate(() => window.BOUNDARY_EXECUTED), undefined);
      return { literalReadOnlyPreview: true, download: await downloadOriginal(name, textFiles[name]) };
    });
    await scenario("boundary-unsupported-binary-original", async () => {
      await openFile("boundary.bin");
      await preview().getByRole("heading", { level: 4 }).waitFor();
      assert.equal(await preview().locator("pre,img").count(), 0);
      return { unsupported: true, download: await downloadOriginal("boundary.bin", textFiles["boundary.bin"]) };
    });
    await scenario("boundary-large-text-truncated-full-original", async () => {
      await openFile("large-boundary.txt");
      await preview().getByRole("status").waitFor();
      const text = await preview().locator("pre").textContent();
      assert.equal(Buffer.byteLength(text), 1024 * 1024);
      assert.equal(text, textFiles["large-boundary.txt"].subarray(0, 1024 * 1024).toString("utf8"));
      assert.equal(text.includes("FULL_ORIGINAL_TAIL"), false);
      return { previewBytes: Buffer.byteLength(text), download: await downloadOriginal("large-boundary.txt", textFiles["large-boundary.txt"]) };
    });
    await scenario("boundary-image-decode-fault-real-retry", async () => {
      const url = `${base}/api/projects/${filesProject.id}/fs/boundary.png`;
      let injected = 0;
      const fault = route => { injected++; return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("NOT_A_PNG_DECODE_BOUNDARY") }); };
      await page.route(url, fault);
      try {
        await openFile("boundary.png"); await preview().getByRole("alert").waitFor();
        assert.equal(injected, 1);
        await page.unroute(url, fault);
        const response = page.waitForResponse(r => r.url() === url && r.request().method() === "GET"); response.catch(() => {});
        await preview().getByRole("button", { name: "다시 시도", exact: true }).click();
        const fetched = await response; assert.equal(fetched.status(), 200); assert.deepEqual(await fetched.body(), textFiles["boundary.png"]);
        const image = preview().getByRole("img", { name: "boundary.png", exact: true });
        await image.waitFor();
        const dimensions = await image.evaluate(async element => { await element.decode(); return { width: element.naturalWidth, height: element.naturalHeight }; });
        assert.deepEqual(dimensions, { width: 1, height: 1 });
        assert.equal(await preview().getByRole("alert").count(), 0);
        return { fault: "M: HTTP 200 image/png with invalid bytes, no app state injection", injected, recoveredViaRealBackend: dimensions, download: await downloadOriginal("boundary.png", textFiles["boundary.png"]) };
      } finally { await page.unroute(url, fault); }
    }, "M-transport-decode-fault-real-recovery");

    await scenario("boundary-history-real-ui-save-fixture", async () => {
      historyProject = await fixture("History boundary");
      await button("차트").click();
      const editor = page.getByRole("region", { name: "차트 편집기", exact: true });
      await editor.getByRole("button", { name: "막대 +", exact: true }).click();
      await editor.getByLabel("차트 제목", { exact: true }).fill("HISTORY_BOUNDARY_SAVE");
      await save(`${base}/api/projects/${historyProject.id}/charts?path=index.html`, () => editor.getByRole("button", { name: "차트 저장", exact: true }).click());
      const history = await getData(`${base}/api/projects/${historyProject.id}/history`);
      assert.ok(history.entries.some(entry => entry.available));
      return { project: historyProject.id, revision: history.current_revision, entries: history.entries.length };
    });
    await scenario("boundary-history-expired-unselectable", async () => {
      const url = `${base}/api/projects/${historyProject.id}/history`;
      const history = await getData(url), bytes = await original(historyProject, "index.html");
      const expired = { ...history, undo_operation_id: null, entries: history.entries.map(entry => ({ ...entry, available: false })) };
      let injected = 0;
      const fault = route => { injected++; return route.fulfill({ status: 200, json: { data: expired } }); };
      await page.route(url, fault);
      try {
        await page.reload({ waitUntil: "domcontentloaded" }); await ready(); await button("저장 이력").click();
        const dialog = page.getByRole("dialog");
        const entries = dialog.getByRole("button", { name: /^리비전 / });
        assert.equal(await entries.count(), expired.entries.length);
        for (const entry of await entries.all()) assert.equal(await entry.isDisabled(), true);
        assert.equal(await dialog.getByRole("button", { name: "선택한 시점으로 복원", exact: true }).isDisabled(), true);
        await shot("boundary-history-expired-dialog");
        assert.deepEqual(await original(historyProject, "index.html"), bytes);
        assert.ok(injected > 0);
        return { fault: "M: real history response with available=false and undo_operation_id=null", entries: expired.entries.length, disabled: true, bytesUnchanged: true };
      } finally { await page.unroute(url, fault); }
    }, "M-history-retention-response");

    for (const code of ["undo_unavailable", "undo_pruned", "stale_revision"]) await scenario(`boundary-history-restore-${code}`, async () => {
      const bytes = await original(historyProject, "index.html");
      const history = await getData(`${base}/api/projects/${historyProject.id}/history`);
      await page.reload({ waitUntil: "domcontentloaded" }); await ready(); await button("저장 이력").click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: /^리비전 / }).and(dialog.locator("button:enabled")).first().click();
      const pattern = `${base}/api/projects/${historyProject.id}/operations/*/undo`;
      let captured = null;
      const status = code === "undo_pruned" ? 410 : 409;
      const fault = route => {
        assert.equal(route.request().method(), "POST");
        assert.equal(captured, null, "One click must issue one restore");
        captured = route.request().postDataJSON();
        return route.fulfill({ status, json: { error: { code, message: `Owned restore boundary: ${code}` } } });
      };
      await page.route(pattern, fault);
      try {
        const response = page.waitForResponse(r => r.url().includes(`/projects/${historyProject.id}/operations/`) && r.url().endsWith("/undo") && r.request().method() === "POST"); response.catch(() => {});
        await dialog.getByRole("button", { name: "선택한 시점으로 복원", exact: true }).click();
        assert.equal((await response).status(), status);
        await page.getByRole("alert").last().waitFor();
        assert.equal(await dialog.isVisible(), true, "Failed restore must not close the user's selection");
        assert.deepEqual(captured, { expected_revision: history.current_revision, expected_artifact_digest: history.current_digest });
        assert.deepEqual(await original(historyProject, "index.html"), bytes);
        assert.equal((await getData(`${base}/api/projects/${historyProject.id}/history`)).current_revision, history.current_revision);
        return { fault: `M: explicit HTTP ${status} ${code}`, captured, selectionRetained: true, errorVisible: true, originalSha256: sha256(bytes), revisionUnchanged: true };
      } finally { await page.unroute(pattern, fault); }
    }, "M-restore-response-fault");
    await scenario("boundary-no-provider-turns", async () => { assert.deepEqual(deniedTurns, []); return { providerTurns: 0 }; });
  } finally {
    await context.unroute(guardPattern, guard); page.off("request", onRequest);
    await record("workspace-boundaries-outcomes", { outcomes, failures, deniedTurns, requests, assumptions: ["Owned local fixture files; all chart and scene saves and downloads use real UI and backend.", "M rows exercise decode/retention/restore transport faults, not elapsed retention or real concurrent writers.", "Scene capacity checks persisted object data, not host WebGL rendering."] });
    await page.goto("about:blank");
  }
  if (failures.length) throw new Error(`${failures.length} workspace boundary failures; see ${path.join(evidence, "workspace-boundaries-outcomes.json")}`);
}
