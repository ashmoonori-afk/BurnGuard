#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const execute = promisify(execFile);
const hash = value => createHash("sha256").update(value).digest("hex");
const baseline = "BG_EXISTING_GRAPHIC_HEADING";
const replacement = "BG_CODEX_HEADING_EDIT_COMPLETE";
const graphicHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Owned typography</title><link rel="stylesheet" href="assets/type.css"></head><body><article id="owned-artboard" data-graphic-artboard style="width:640px;height:480px"><img src="assets/mark.svg" width="40" height="40" alt="Owned mark"><h1 id="qa-heading" data-bg-node-id="qa-heading">${baseline}</h1><p>Local typographic graphic. Existing assets and fixed dimensions.</p></article></body></html>`;
const css = "body{margin:0;background:#e8edf5;font-family:Arial,sans-serif}article{box-sizing:border-box;padding:36px;background:#fff;color:#152d50}h1{font-size:48px;line-height:1.1;overflow-wrap:anywhere}p{font-size:20px}";
const mark = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="#152d50"/></svg>';

/** M = real local save/UI + explicitly mocked 503 send; L = one real Codex graphic EDIT, not image synthesis. */
export async function run({ page, context, base, home, check, shot, evidence }) {
  const observations = [], failures = [], stream = [], browserErrors = [], intercepted = [];
  const bus = new EventEmitter(), pending = new Set();
  let fixtures, headers, activeSession, expectedMock, allowedLive, liveForwarded = 0;
  const record = (name, value) => writeFile(path.join(evidence, `${name}.json`), JSON.stringify(value, null, 2));
  const persist = () => record("ai-entrypoints-observations", { observations, failures, intercepted, liveForwarded, browserErrors });
  const row = async (name, mode, action) => {
    try { await check(name, async () => { const result = await action(); observations.push({ name, mode, ...result }); await persist(); return result; }, mode); }
    catch (error) { failures.push({ name, error: String(error.stack ?? error) }); await persist(); console.error(`[ai-entrypoints] ${name}: ${error.message}`); }
  };
  const request = async (suffix, method = "GET", data) => {
    const response = await page.request.fetch(`${base}${suffix}`, { method, headers, ...(data === undefined ? {} : { data }) });
    const body = await response.json();
    assert.ok(response.ok(), `${method} ${suffix}: ${response.status()} ${JSON.stringify(body)}`);
    return body.data;
  };
  // Exact SSE subscription, armed before the action; no timing/polling waits.
  const arm = (predicate, timeout = 240_000) => {
    let listener, timer, rejectWait;
    const cancel = () => { clearTimeout(timer); bus.off("event", listener); pending.delete(cancel); rejectWait(new Error("Owned SSE observation cancelled")); };
    const promise = new Promise((resolve, reject) => {
      rejectWait = reject;
      listener = item => { if (predicate(item)) { clearTimeout(timer); bus.off("event", listener); pending.delete(cancel); resolve(item); } };
      bus.on("event", listener);
      timer = setTimeout(() => { bus.off("event", listener); pending.delete(cancel); reject(new Error("Exact SSE event deadline exceeded")); }, timeout);
    });
    promise.catch(() => {}); // Owner awaits it; cancellation must not create an unhandled rejection.
    pending.add(cancel);
    return { promise, cancel };
  };
  const enabled = locator => locator.evaluate(element => new Promise((resolve, reject) => {
    if (!element.disabled) return resolve();
    const observer = new MutationObserver(() => { if (!element.disabled) { observer.disconnect(); clearTimeout(timer); resolve(); } });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error("Control remained disabled")); }, 30_000);
    observer.observe(element, { attributes: true, attributeFilter: ["disabled"] });
  }));
  const readyCanvas = async (relPath, previousKey = null) => {
    const key = await page.evaluate(({ relPath, previousKey }) => new Promise((resolve, reject) => {
      const current = () => {
        const frame = document.querySelector('iframe[data-document-key][aria-busy="false"]');
        const key = frame?.dataset.documentKey;
        return key && !key.startsWith("placeholder:") && key.includes(`/fs/${relPath}`) && key !== previousKey ? key : null;
      };
      const initial = current(); if (initial) return resolve(initial);
      const observer = new MutationObserver(() => { const key = current(); if (key) { observer.disconnect(); clearTimeout(timer); resolve(key); } });
      const timer = setTimeout(() => { observer.disconnect(); reject(new Error(`Current canvas document not ready: ${relPath}`)); }, 30_000);
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-busy", "data-document-key"] });
    }), { relPath, previousKey });
    return key;
  };
  const frame = () => page.frameLocator('iframe[data-document-key][aria-busy="false"]');
  const composer = () => page.locator('[data-qa="composer"]');
  const textarea = () => composer().locator("textarea");
  const button = name => page.getByRole("button", { name, exact: true });
  const selectOptions = async models => {
    await textarea().waitFor(); await enabled(textarea());
    assert.equal(await button("Codex").getAttribute("aria-pressed"), "true");
    const model = composer().getByRole("combobox", { name: "Generation model", exact: true });
    const chosen = models[0].id;
    await model.locator(`option[value="${chosen}"]`).waitFor({ state: "attached" });
    const details = composer().locator("fieldset details");
    if (await details.getAttribute("open") === null) await details.locator("summary").click();
    await composer().getByRole("checkbox").check();
    await model.selectOption(chosen);
    await composer().getByRole("combobox", { name: "Reasoning effort", exact: true }).selectOption("low");
    return { model: chosen, effort: "low", vanilla: true, provider: "native" };
  };
  const open = async (project, relPath = "index.html") => {
    activeSession = (await request(`/api/projects/${project.id}/session`)).id;
    const subscribed = arm(item => item.kind === "subscribe" && item.url.includes(`/sessions/${activeSession}/stream`), 30_000);
    await page.goto(`${base}/projects/${project.id}`, { waitUntil: "domcontentloaded" });
    await subscribed.promise;
    await readyCanvas("index.html");
    if (relPath !== "index.html") {
      await button("Design files").click();
      await page.getByRole("navigation", { name: "Browse project files", exact: true }).getByRole("button", { name: new RegExp(`^${relPath.replaceAll(".", "\\.")}(?:\\s|$)`) }).click();
      await readyCanvas(relPath);
    }
    await textarea().waitFor(); await enabled(textarea());
  };
  const onError = error => browserErrors.push(String(error));
  const routePattern = `${base}/api/sessions/*/events`;
  const routeHandler = async route => {
    if (route.request().method() !== "POST") return route.continue();
    const sent = route.request().postDataJSON();
    const session = new URL(route.request().url()).pathname.split("/")[3];
    if (allowedLive && session === allowedLive.session && sent.text === allowedLive.prompt && liveForwarded === 0) {
      liveForwarded++;
      return route.continue();
    }
    const expected = expectedMock?.session === session;
    intercepted.push({ mode: "M", expected, case: expectedMock?.name ?? "unexpected-blocked-send", session, sent, response: { status: 503, code: "qa_ai_entrypoint_mock503" }, providerExecuted: false });
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "qa_ai_entrypoint_mock503", message: "Explicit QA mocked503 send response; provider not executed" } }) });
  };
  page.on("pageerror", onError);
  await page.route(routePattern, routeHandler);
  try {
    await page.exposeBinding("__aiEntrypointsObserved", (_source, item) => { if (item.event) stream.push(item); bus.emit("event", item); });
    await context.addInitScript(() => {
      if (window !== window.top) return;
      localStorage.setItem("burnguard.locale", "en");
      const Native = window.EventSource;
      window.EventSource = class extends Native {
        constructor(url, config) {
          super(url, config);
          // Idle streams flush on first event; construction, not heartbeat timing, establishes observation.
          window.__aiEntrypointsObserved({ kind: "subscribe", url: String(url) });
          this.addEventListener("open", () => window.__aiEntrypointsObserved({ kind: "open", url: String(url) }));
          this.addEventListener("message", message => window.__aiEntrypointsObserved({ kind: "message", url: String(url), ...JSON.parse(message.data) }));
        }
      };
    });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    const bootstrap = await page.evaluate(async () => { const response = await fetch("/api/bootstrap"); if (!response.ok) throw new Error(`Bootstrap HTTP ${response.status}`); return (await response.json()).data; });
    headers = { "x-burnguard-capability": bootstrap.capability, origin: base };
    const detected = await request("/api/backends/detect");
    const codex = detected.backends.find(item => item.id === "codex");
    assert.ok(codex?.models?.length, "Codex models unavailable");
    const ownedHome = await realpath(home);
    // Native service fixtures, not an authenticated creation claim. The graphic exists before its sole edit turn.
    const seed = `
      import {createProjectRecord} from './packages/backend/src/db/seed.ts';
      import {chartSample} from './packages/shared/src/chart.ts';
      import {renderChart} from './packages/shared/src/chart-render.ts';
      import {mkdir,writeFile} from 'node:fs/promises'; import path from 'node:path';
      const wrap=body=>'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Owned AI entrypoints</title></head><body>'+body+'</body></html>';
      const result={};
      for(const kind of ['chart','three','graphic']) {
        result[kind]=await createProjectRecord({name:'Owned AI entrypoint '+kind,type:kind==='graphic'?'graphic':'prototype',designSystemId:null,backendId:'codex',optionsJson:kind==='graphic'?JSON.stringify({graphic_canvas:{schema_version:1,width:640,height:480},graphic_set:{schema_version:1,kind:'single',frame_count:1}}):null,entrypoint:'index.html',thumbnailPath:null,initializeArtifact:async stage=>{
          if(kind==='graphic') { await mkdir(path.join(stage,'assets')); await writeFile(path.join(stage,'index.html'),${JSON.stringify(graphicHtml)}); await writeFile(path.join(stage,'assets/type.css'),${JSON.stringify(css)}); await writeFile(path.join(stage,'assets/mark.svg'),${JSON.stringify(mark)}); }
          else { await writeFile(path.join(stage,'index.html'),wrap('<h1>DECOY_DO_NOT_EDIT</h1>')); await writeFile(path.join(stage,'target.html'),wrap('<h1>OWNED_TARGET</h1>'+(kind==='chart'?renderChart({...chartSample('bar','chart_decoy'),title:'Untouched chart'})+renderChart({...chartSample('line','chart_selected'),title:'Selected chart'}):''))); }
        }});
      }
      console.log(JSON.stringify(result));`;
    const seeded = await execute("bun", ["-e", seed], { cwd: root, env: { ...process.env, BG_APP_ROOT: path.join(ownedHome, ".burnguard") }, timeout: 60_000 });
    fixtures = JSON.parse(seeded.stdout.trim().split("\n").at(-1));
    for (const project of Object.values(fixtures)) {
      project.dir = await realpath(path.join(ownedHome, ".burnguard/data/projects", project.id));
      assert.ok(project.dir.startsWith(`${ownedHome}${path.sep}`));
    }
    await record("ai-entrypoints-fixtures", fixtures);

    for (const kind of ["chart", "three"]) await row(`ai-${kind}-save-and-ask-mocked503`, "M", async () => {
      const project = fixtures[kind];
      await open(project, "target.html");
      const selected = await selectOptions(codex.models);
      const beforeEvents = await request(`/api/sessions/${activeSession}/events`);
      const decoy = await readFile(path.join(project.dir, "index.html"));
      const endpoint = `${base}/api/projects/${project.id}/${kind === "chart" ? "charts" : "three-scene"}?path=target.html`;
      await button(kind === "chart" ? "Chart" : "3D scene").click();
      const editor = page.getByRole("region", { name: kind === "chart" ? "Chart editor" : "3D scene editor", exact: true });
      let beforeChart;
      if (kind === "chart") {
        const select = editor.getByRole("combobox", { name: "Saved charts", exact: true });
        await enabled(select); await select.selectOption("chart_selected");
        beforeChart = (await request(`/api/projects/${project.id}/charts?path=target.html`)).charts[0];
        await editor.getByLabel("Chart title", { exact: true }).fill("BG_CHART_LOCAL_EDIT");
      } else {
        await editor.getByRole("button", { name: "Sphere +", exact: true }).click();
        await editor.getByLabel("3D object color", { exact: true }).fill("#cc3344");
      }
      const instruction = kind === "chart" ? "BG_CHART_TARGET_ONLY: edit only chart_selected in target.html; preserve other charts and files." : "BG_THREE_TARGET_ONLY: edit only the managed data-bg-three scene in target.html; preserve other files.";
      const aiInput = editor.getByLabel(kind === "chart" ? "AI chart request" : "Ask AI to edit the 3D scene", { exact: true });
      await aiInput.fill(instruction);
      const selectedTarget = kind === "chart" ? await editor.getByLabel("Saved charts", { exact: true }).inputValue() : await editor.getByRole("combobox").inputValue();
      expectedMock = { name: kind, session: activeSession };
      const saveResponse = page.waitForResponse(response => response.url() === endpoint && response.request().method() === "PUT");
      const sendResponse = page.waitForResponse(response => response.url() === `${base}/api/sessions/${activeSession}/events` && response.request().method() === "POST");
      await editor.getByRole("button", { name: kind === "chart" ? "Save and ask AI" : "Save scene and ask AI", exact: true }).click();
      const saved = await saveResponse, failed = await sendResponse;
      assert.equal(saved.status(), 200, await saved.text());
      assert.equal(failed.status(), 503);
      assert.equal((await failed.json()).error.code, "qa_ai_entrypoint_mock503");
      const sent = failed.request().postDataJSON();
      assert.equal(sent.type, "user.message"); assert.equal(sent.active_rel_path, "target.html");
      assert.deepEqual(sent.generation, selected);
      // Machine-consumed target identities and bounded suffix, not a pinned prompt/prose template.
      assert.ok(sent.text.includes(JSON.stringify("target.html"))); assert.ok(sent.text.endsWith(instruction)); assert.ok(sent.text.length < 1024);
      assert.ok(sent.text.includes(kind === "chart" ? JSON.stringify(selectedTarget) : "data-bg-three"));
      assert.ok(!sent.text.includes("index.html") && !sent.text.includes("chart_decoy"));
      // A failed AI send must retain the selected file and its request draft.
      const errorToast = page.locator('[role="status"][aria-live="polite"] [role="alert"]').last();
      await errorToast.waitFor();
      const errorText = await errorToast.innerText();
      const activeFileAfterSave = await page.locator('iframe[data-document-key]').getAttribute("data-document-key");
      const requestRetained = await aiInput.inputValue() === instruction;
      assert.ok(activeFileAfterSave?.includes("/fs/target.html"), "Saving must not reset the active file to the entrypoint");
      assert.equal(requestRetained, true, "A rejected AI request must remain available for retry");
      await enabled(textarea());
      const persisted = await request(`/api/projects/${project.id}/${kind === "chart" ? "charts" : "three-scene"}?path=target.html`);
      if (kind === "chart") {
        assert.deepEqual(persisted.charts[0], beforeChart);
        assert.equal(persisted.charts.find(item => item.id === selectedTarget).title, "BG_CHART_LOCAL_EDIT");
      } else {
        assert.equal(persisted.scene.objects.find(item => item.id === selectedTarget).color, "#cc3344");
        assert.equal(persisted.scene.objects.length, 1);
      }
      assert.deepEqual(await readFile(path.join(project.dir, "index.html")), decoy);
      const afterEvents = await request(`/api/sessions/${activeSession}/events`);
      assert.deepEqual(afterEvents.slice(0, beforeEvents.length), beforeEvents);
      const localEvents = afterEvents.slice(beforeEvents.length).map(item => item.event);
      assert.equal(localEvents.length, 1, "Only the real local save may publish an event");
      assert.equal(localEvents[0].type, "artifact.operation");
      assert.equal(localEvents[0].operationId, (await saved.json()).data.operation_id);
      assert.equal(localEvents[0].outcome, "committed");
      assert.deepEqual(localEvents[0].changedPaths, kind === "chart" ? ["target.html"] : [".burnguard-three/LICENSE", "target.html"]);
      assert.equal((await request(`/api/projects/${project.id}/session`)).status, "idle");
      await writeFile(path.join(evidence, `${kind}-saved.html`), await readFile(path.join(project.dir, "target.html")));
      await record(`${kind}-mocked503-persistence`, { selectedTarget, selected, sent, persisted, saveReceipt: (await saved.json()).data, errorText, activeFileAfterSave, requestRetained, providerExecuted: false });
      await shot(`ai-${kind}-mocked503-recoverable-error`);
      await errorToast.getByRole("button").click();
      await textarea().fill("BG_RECOVERABLE_DRAFT_ONLY_NO_SEND");
      assert.equal(await composer().getByRole("button", { name: "Send (Cmd/Ctrl+Enter)", exact: true }).isEnabled(), true);
      await textarea().fill("");
      await page.reload({ waitUntil: "domcontentloaded" }); await readyCanvas("index.html");
      await button("Design files").click();
      await page.getByRole("navigation", { name: "Browse project files", exact: true }).getByRole("button", { name: /^target\.html(?:\s|$)/ }).click();
      await readyCanvas("target.html");
      await button(kind === "chart" ? "Chart" : "3D scene").click();
      if (kind === "chart") {
        await enabled(editor.getByLabel("Saved charts", { exact: true }));
        await editor.getByLabel("Saved charts", { exact: true }).selectOption(selectedTarget);
        assert.equal(await editor.getByLabel("Chart title", { exact: true }).inputValue(), "BG_CHART_LOCAL_EDIT");
      } else {
        await editor.getByLabel("3D object color", { exact: true }).waitFor(); await enabled(editor.getByLabel("3D object color", { exact: true }));
        assert.equal(await editor.getByLabel("3D object color", { exact: true }).inputValue(), "#cc3344");
      }
      expectedMock = null;
      return { selectedTarget, selected, sent, saveReceipt: (await saved.json()).data, persisted, errorText, activeFileAfterSave, requestRetained, localEditSurvivesReload: true, composerRecovered: true, decoyUnchanged: true, providerExecuted: false, scope: kind === "three" ? "Managed scene request; selected object is local inspector state, not an AI object-target claim" : "Selected chart request" };
    });

    await row("ai-existing-typographic-graphic-one-live-codex-edit-undo", "L-authenticated-Codex-graphic-edit-not-image-synthesis", async () => {
      const priorBudget = await readFile(path.join(evidence, "live-turn-budget.json"), "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; });
      assert.equal(priorBudget, null, "One-turn budget already consumed/reserved; existing live evidence retained, no additional paid turn permitted");
      await execute("codex", ["login", "status"], { timeout: 30_000 }); // Never retain account/credential output.
      assert.equal(codex.authenticated, true, "App must detect authenticated Codex");
      const project = fixtures.graphic;
      await open(project);
      const selected = await selectOptions(codex.models);
      const identity = await request(`/api/projects/${project.id}`);
      assert.equal(identity.type, "graphic");
      const before = await readFile(path.join(project.dir, "index.html"), "utf8");
      assert.equal(before, graphicHtml);
      const dimensions = () => frame().locator("[data-graphic-artboard]").evaluate(element => ({ width: Number.parseFloat(getComputedStyle(element).width), height: Number.parseFloat(getComputedStyle(element).height) }));
      assert.deepEqual(await dimensions(), { width: 640, height: 480 });
      assert.equal(await frame().locator("#qa-heading").textContent(), baseline);
      await shot("ai-existing-graphic-before");
      await writeFile(path.join(evidence, "graphic-before.html"), before);
      const prompt = `Edit the EXISTING owned typographic graphic, not a new design or fresh image. In the current operation stage, edit ONLY index.html: replace the one literal heading text ${baseline} in h1#qa-heading with exactly ${replacement}. Preserve every other byte of index.html and every other file, including existing assets/type.css and assets/mark.svg. Preserve the 640x480 artboard dimensions. No fresh images, image synthesis, network tools, installs, deployment, servers, or external writes. Read the local file, make this deterministic heading-only edit, and finish with ${replacement}.`;
      await textarea().fill(prompt);
      // Durable, exclusive budget prevents an accidental second paid turn when this module is rerun.
      await writeFile(path.join(evidence, "live-turn-budget.json"), JSON.stringify({ maximumPaidTurns: 1, projectId: project.id, session: activeSession, prompt, selected, classification: "existing graphic heading edit; no image synthesis" }, null, 2), { flag: "wx" });
      allowedLive = { session: activeSession, prompt };
      const session = activeSession;
      const start = stream.length;
      const running = arm(item => item.url.includes(`/sessions/${session}/stream`) && item.event?.type === "status.running");
      const idle = arm(item => item.url.includes(`/sessions/${session}/stream`) && item.event?.type === "status.idle");
      const responsePromise = page.waitForResponse(response => response.url() === `${base}/api/sessions/${session}/events` && response.request().method() === "POST");
      const oldKey = await readyCanvas("index.html");
      await composer().getByRole("button", { name: "Send (Cmd/Ctrl+Enter)", exact: true }).click();
      const response = await responsePromise;
      allowedLive = null;
      assert.equal(response.status(), 200, await response.text());
      assert.deepEqual(response.request().postDataJSON().generation, selected);
      const receipt = (await response.json()).data;
      await record("graphic-live-receipt", receipt);
      await running.promise;
      const terminal = await idle.promise;
      const events = stream.slice(start).filter(item => item.url.includes(`/sessions/${session}/stream`)).map(item => item.event);
      await record("graphic-live-events", events);
      assert.notEqual(terminal.event.stopReason, "error", JSON.stringify(events.filter(item => ["status.error", "chat.delta"].includes(item.type))));
      const committed = events.find(item => item.type === "artifact.operation" && item.outcome === "committed");
      assert.deepEqual(committed?.changedPaths, ["index.html"]);
      assert.ok(events.some(item => item.type === "chat.delta" && item.text.length > 0));
      const after = await readFile(path.join(project.dir, "index.html"), "utf8");
      await writeFile(path.join(evidence, "graphic-after.html"), after);
      assert.equal(after, before.replace(baseline, replacement));
      assert.equal(await readFile(path.join(project.dir, "assets/type.css"), "utf8"), css);
      assert.equal(await readFile(path.join(project.dir, "assets/mark.svg"), "utf8"), mark);
      await readyCanvas("index.html", oldKey);
      await frame().getByRole("heading", { name: replacement, exact: true }).waitFor();
      assert.deepEqual(await dimensions(), { width: 640, height: 480 });
      const image = frame().getByRole("img", { name: "Owned mark", exact: true });
      await image.evaluate(element => new Promise((resolve, reject) => {
        if (element.complete) return element.naturalWidth ? resolve() : reject(new Error("Existing asset failed to decode"));
        const timer = setTimeout(() => { clean(); reject(new Error("Existing asset load deadline")); }, 15_000);
        const clean = () => { clearTimeout(timer); element.removeEventListener("load", loaded); element.removeEventListener("error", failed); };
        const loaded = () => { clean(); resolve(); }, failed = () => { clean(); reject(new Error("Existing asset failed")); };
        element.addEventListener("load", loaded); element.addEventListener("error", failed);
      }));
      await shot("ai-existing-graphic-live-canvas");
      await page.reload({ waitUntil: "domcontentloaded" }); await readyCanvas("index.html");
      await frame().getByRole("heading", { name: replacement, exact: true }).waitFor();
      await page.locator(".chat-scroll").getByText(prompt, { exact: true }).waitFor();
      const transcript = await request(`/api/sessions/${session}/events`);
      const snapshot = await request(`/api/sessions/${session}/snapshot`);
      await record("graphic-transcript", { transcript, snapshot });
      assert.ok(transcript.some(item => item.event?.type === "chat.user_message"));
      assert.ok(transcript.some(item => item.event?.type === "chat.delta" && item.event.text.length > 0));
      await shot("ai-existing-graphic-transcript-reloaded");
      const restoredResponse = page.waitForResponse(response => response.url().endsWith(`/checkpoints/${receipt.turn_id}/restore`) && response.request().method() === "POST");
      const restoreKey = await readyCanvas("index.html");
      page.once("dialog", dialog => dialog.accept());
      await page.locator(".chat-scroll").getByRole("button", { name: "Revert this turn", exact: true }).last().click();
      const restored = await restoredResponse;
      assert.equal(restored.status(), 200, await restored.text());
      const restoration = (await restored.json()).data;
      assert.equal(restoration.result_digest, identity.current_digest, "Exact full canonical tree checkpoint undo");
      assert.equal(await readFile(path.join(project.dir, "index.html"), "utf8"), before);
      assert.equal(await readFile(path.join(project.dir, "assets/type.css"), "utf8"), css);
      assert.equal(await readFile(path.join(project.dir, "assets/mark.svg"), "utf8"), mark);
      await writeFile(path.join(evidence, "graphic-restored.html"), await readFile(path.join(project.dir, "index.html")));
      await readyCanvas("index.html", restoreKey);
      await frame().getByRole("heading", { name: baseline, exact: true }).waitFor();
      assert.deepEqual(await dimensions(), { width: 640, height: 480 });
      await page.locator(".chat-scroll").getByText(prompt, { exact: true }).waitFor();
      assert.equal(liveForwarded, 1);
      return { projectId: project.id, turnId: receipt.turn_id, selected, stopReason: terminal.event.stopReason, committed, beforeSha256: hash(before), afterSha256: hash(after), assets: { css: hash(css), mark: hash(mark) }, dimensions: { width: 640, height: 480 }, exactHeadingOnlyEdit: true, actualCanvas: true, persistedTranscript: true, restoration, exactCheckpointUndo: true, paidTurns: liveForwarded, imageSynthesis: false, scope: "Authenticated Codex editing an owned existing typographic graphic, not authenticated creation or fresh image synthesis" };
    });
    assert.ok(intercepted.every(item => item.expected), "An unexpected provider send was blocked");
  } catch (error) {
    failures.push({ name: "setup-or-fatal", error: String(error.stack ?? error) });
    await shot("ai-entrypoints-fatal");
    await record("ai-entrypoints-fatal", { error: String(error.stack ?? error), url: page.url(), body: await page.locator("body").innerText() });
  } finally {
    allowedLive = null; expectedMock = null;
    if (fixtures && headers) for (const project of Object.values(fixtures)) {
      const session = await request(`/api/projects/${project.id}/session`);
      if (session.status === "running") {
        const stopped = arm(item => item.url.includes(`/sessions/${session.id}/stream`) && item.event?.type === "status.idle", 30_000);
        await request(`/api/sessions/${session.id}/interrupt`, "POST");
        await stopped.promise;
      }
    }
    for (const cancel of [...pending]) cancel();
    await page.unroute(routePattern, routeHandler);
    page.off("pageerror", onError);
    await record("ai-entrypoints-all-stream-events", stream);
    await persist();
    // Driver owns browser/backend/isolated profile and removes them in its finally block.
  }
  if (failures.length) throw new Error(`${failures.length} AI entrypoint cases blocked/failed; see ai-entrypoints-observations.json`);
}

// One executable module; reuse the existing resource-owning driver unchanged.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = process.argv.slice(2);
  // A separate process avoids a top-level-await import cycle when the driver imports run().
  const child = spawn(process.execPath, [path.join(root, "scripts/qa/full-feature-runner.mjs"), "--module", "scripts/qa/full-ai-entrypoints.mjs", "--port", "14214", "--evidence", "/tmp/burnguard-ai-entrypoints", ...options], { cwd: root, stdio: "inherit" });
  process.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => resolve(code ?? 1)); });
}
