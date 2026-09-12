import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAttachmentFixtures } from "./fixtures/full-settings-attachments/documents.mjs";
import { captureClipboard, restoreClipboard } from "./clipboard-paste-fixtures.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "packages/backend/package.json"));
const JSZip = require("jszip");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Real local settings and attachment intake; only labeled failure rows intercept HTTP. */
export async function run({ page, context, base, home, check, shot, evidence }) {
  const observations = [];
  const failures = [];
  const defects = [];
  const blockers = [];
  const requests = [];
  const browserErrors = [];
  let fixture;
  let headers;
  let project;
  let session;
  let expectedMalformedEventPosts = 0;
  let unexpectedEventPosts = 0;
  let clipboardSnapshot = null;
  page.setDefaultTimeout(45_000);
  page.on("pageerror", (error) => browserErrors.push(String(error)));

  const report = async () => writeFile(path.join(evidence, "settings-attachments-report.json"), JSON.stringify({
    observations, failures, defects, blockers, requests, browserErrors,
    resources: { fixtureDirectory: fixture?.directory, projectId: project?.id, sessionId: session?.id, cleanup: "Owned fixture/profile files are under runner home and removed by the driver." },
  }, null, 2));
  const scenario = async (name, action, mode = "live-local") => {
    try {
      await check(`settings-attachments-${name}`, async () => {
        const result = await action();
        observations.push({ name, mode, result });
        await report();
        return result;
      }, mode);
    } catch (error) {
      failures.push({ name, mode, error: String(error.stack ?? error) });
      await report();
      console.error(`[settings/attachments defect] ${name}: ${error.message}`);
    }
  };
  const guard = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== base && !["blob:", "data:"].includes(url.protocol)) {
      requests.push({ blocked: true, kind: "external", method: request.method(), url: url.origin + url.pathname });
      return route.abort("blockedbyclient");
    }
    if (url.origin === base && request.method() === "POST" && /^\/api\/sessions\/[^/]+\/events$/.test(url.pathname)) {
      const expectedMalformed = expectedMalformedEventPosts > 0;
      if (expectedMalformed) expectedMalformedEventPosts -= 1;
      else unexpectedEventPosts += 1;
      requests.push({ blocked: !expectedMalformed, kind: "model-turn", method: request.method(), path: url.pathname, expectedMalformed });
      if (expectedMalformed) return route.continue();
      return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ error: { code: "qa_model_turn_blocked", message: "Unexpected provider turn blocked by QA" } }) });
    }
    if (url.origin === base && request.method() === "POST" && /^\/api\/settings\/(?:playwright\/install|python\/install|updates\/(?:check|apply))$/.test(url.pathname)) {
      requests.push({ blocked: true, kind: "host-side-effect", method: request.method(), path: url.pathname });
      return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ error: { code: "qa_side_effect_blocked", message: "Host-wide action blocked by QA" } }) });
    }
    if (url.origin === base && request.method() === "POST" && /^\/api\/sessions\/[^/]+\/documents$/.test(url.pathname)) {
      requests.push({ blocked: false, kind: "document-persistence", method: request.method(), path: url.pathname });
    }
    return route.continue();
  };

  const request = async (suffix, method = "GET", data) => {
    const response = await page.request.fetch(`${base}${suffix}`, { method, headers, ...(data === undefined ? {} : { data }) });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    return { response, body };
  };
  const okData = async (suffix, method = "GET", data) => {
    const { response, body } = await request(suffix, method, data);
    assert.ok(response.ok(), `${method} ${suffix}: ${response.status()} ${JSON.stringify(body)}`);
    return body.data;
  };
  const settingsApi = () => okData("/api/settings");
  const composer = () => page.locator('[data-qa="composer"]');
  const textarea = () => composer().locator("textarea");
  const attachmentList = () => composer().locator(":scope > ul");
  const attachmentRows = () => attachmentList().locator(":scope > li");
  const fileInput = () => composer().locator('input[type="file"]');
  const waitComposerReady = async () => {
    await textarea().waitFor({ state: "visible" });
    await textarea().evaluate((node) => new Promise((resolve, reject) => {
      if (!node.disabled) return resolve();
      const observer = new MutationObserver(() => { if (!node.disabled) { clearTimeout(timer); observer.disconnect(); resolve(); } });
      const timer = setTimeout(() => { observer.disconnect(); reject(new Error("Composer draft did not become ready")); }, 15_000);
      observer.observe(node, { attributes: true, attributeFilter: ["disabled"] });
    }));
    assert.equal(await textarea().isEnabled(), true);
  };
  const openSettings = async () => {
    await page.goto(`${base}/settings`, { waitUntil: "domcontentloaded" });
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    await dialog.locator("#display-name").waitFor({ state: "visible" });
    return dialog;
  };
  const closeSettings = async (dialog, label = "Cancel") => {
    await dialog.getByRole("button", { name: label, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  };
  const saveSettings = async (dialog, label = "Save") => {
    const pending = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/settings" && response.request().method() === "PATCH");
    await dialog.getByRole("button", { name: label, exact: true }).last().click();
    const response = await pending;
    assert.equal(response.status(), 200, await response.text());
    await dialog.waitFor({ state: "hidden" });
    return (await response.json()).data;
  };
  const waitDraft = async (expectedText, expectedNames) => {
    const stored = await page.evaluate(async ({ id }) => {
      const db = await new Promise((resolve, reject) => {
        const opened = indexedDB.open("burnguard-composer", 1);
        opened.onsuccess = () => resolve(opened.result);
        opened.onerror = () => reject(opened.error);
      });
      try {
        const value = await new Promise((resolve, reject) => {
          const get = db.transaction("drafts").objectStore("drafts").get(id);
          get.onsuccess = () => resolve(get.result ?? null);
          get.onerror = () => reject(get.error);
        });
        return value === null ? null : { text: value.text, items: value.items.map((item) => ({ name: item.file.name, size: item.file.size, role: item.role, status: item.status })) };
      } finally { db.close(); }
    }, { id: session.id });
    assert.equal(stored?.text, expectedText);
    assert.deepEqual((stored?.items ?? []).map((item) => item.name), expectedNames);
    return stored;
  };
  const resetDraft = async () => {
    await page.evaluate(async ({ id }) => {
      const db = await new Promise((resolve, reject) => {
        const opened = indexedDB.open("burnguard-composer", 1);
        opened.onsuccess = () => resolve(opened.result);
        opened.onerror = () => reject(opened.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction("drafts", "readwrite");
          tx.objectStore("drafts").delete(id);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally { db.close(); }
    }, { id: session.id });
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitComposerReady();
    assert.equal(await textarea().inputValue(), "");
  };
  const documentResponse = () => page.waitForResponse((response) => new URL(response.url()).pathname === `/api/sessions/${session.id}/documents` && response.request().method() === "POST");
  const addPicker = async (paths) => {
    const pending = documentResponse();
    await fileInput().setInputFiles(paths);
    const response = await pending;
    assert.equal(response.status(), 200, await response.text());
    return (await response.json()).data.paths;
  };
  const addDrop = async (names) => {
    const payload = await Promise.all(names.map(async (name) => ({ name, bytes: [...fixture.bytes[name]], type: name.endsWith(".webp") ? "image/webp" : "image/jpeg" })));
    const pending = documentResponse();
    await composer().evaluate((node, files) => {
      const transfer = new DataTransfer();
      for (const item of files) transfer.items.add(new File([Uint8Array.from(item.bytes)], item.name, { type: item.type }));
      node.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, payload);
    const response = await pending;
    assert.equal(response.status(), 200, await response.text());
    return (await response.json()).data.paths;
  };
  const waitDisabled = async (locator, expected) => locator.evaluate((node, value) => new Promise((resolve, reject) => {
    const matches = () => node.disabled === value;
    if (matches()) return resolve();
    const observer = new MutationObserver(() => { if (matches()) { clearTimeout(timer); observer.disconnect(); resolve(); } });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error(`Disabled state did not become ${value}`)); }, 15_000);
    observer.observe(node, { attributes: true, attributeFilter: ["disabled"] });
  }), expected);
  const localized = {
    ko: { settings: "설정", cancel: "취소", home: "무엇을 만들어 볼까요?", designFiles: "디자인 파일", input: "메시지 입력", openSettings: "설정 열기", chat: "AI 대화" },
    en: { settings: "Settings", cancel: "Cancel", home: "What would you like to create?", designFiles: "Design files", input: "Message input", openSettings: "Open settings", chat: "AI chat" },
    "zh-CN": { settings: "设置", cancel: "取消", home: "想创作什么？", designFiles: "设计文件", input: "输入消息", openSettings: "打开设置", chat: "AI 对话" },
  };

  await context.addInitScript(() => { if (window === window.top && localStorage.getItem("burnguard.locale") === null) localStorage.setItem("burnguard.locale", "en"); });
  await context.route("**/*", guard);
  try {
    fixture = await createAttachmentFixtures(path.join(home, "full-settings-attachments-fixtures"));
    await page.goto(base, { waitUntil: "domcontentloaded" });
    const bootstrap = await page.evaluate(async () => (await (await fetch("/api/bootstrap")).json()).data);
    headers = { "x-burnguard-capability": bootstrap.capability, origin: base };

    const zip = new JSZip();
    zip.file("index.html", '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Attachment locale fixture</title></head><body><h1 id="source-sentinel">QA_SOURCE_DO_NOT_TRANSLATE · 한글 · 中文</h1><p>Original project artifact.</p></body></html>');
    zip.file("assets/existing-source.png", fixture.bytes["reference.png"]);
    zip.file("assets/existing-source.webp", fixture.bytes["reference.webp"]);
    const imported = await page.request.post(`${base}/api/projects/import`, { headers, multipart: { name: "Settings attachments locale QA", source: "zip", files: { name: "settings-attachments.zip", mimeType: "application/zip", buffer: await zip.generateAsync({ type: "nodebuffer" }) } } });
    assert.equal(imported.status(), 201, await imported.text());
    project = (await imported.json()).data;
    session = await okData(`/api/projects/${project.id}/session`);
    const ownedProject = await realpath(path.join(home, ".burnguard/data/projects", project.id));
    assert.ok(ownedProject.startsWith(`${home}${path.sep}`));

    await scenario("source-mode-capabilities-and-cli-status", async () => {
      const [settings, detection, updates, playwright, python] = await Promise.all([
        settingsApi(), okData("/api/backends/detect"), okData("/api/settings/updates"), okData("/api/settings/playwright"), okData("/api/settings/python"),
      ]);
      assert.equal(updates.supported, false, "source runner must not expose package self-update");
      assert.ok(["idle", "installing", "success", "error"].includes(playwright.state));
      assert.equal(typeof python.health.python.found, "boolean");
      assert.equal(settings.chat_abort_threshold_ms, 300_000);
      const dialog = await openSettings();
      await dialog.getByText("Automatic updates are available in installed packages", { exact: true }).waitFor();
      for (const backend of detection.backends) {
        const button = dialog.getByRole("button", { name: new RegExp(`^${backend.id === "claude-code" ? "Claude Code" : "Codex"}`) });
        assert.equal(await button.isDisabled(), !backend.found);
      }
      assert.equal(requests.some((entry) => entry.kind === "host-side-effect"), false);
      await closeSettings(dialog);
      return { sourceUpdate: updates, playwright, python, backends: detection.backends.map(({ id, found, authenticated, version }) => ({ id, found, authenticated, version })) };
    });

    await scenario("general-cancel-save-reopen-theme-native-model-effort-context", async () => {
      const baseline = await settingsApi();
      let dialog = await openSettings();
      await dialog.locator("#display-name").fill("DISCARDED SETTINGS NAME");
      await dialog.getByRole("button", { name: "Light", exact: true }).click();
      await dialog.getByRole("button", { name: baseline.chat_context_mode === "full" ? "Compact" : "Full", exact: true }).click();
      await dialog.getByRole("note").waitFor();
      await closeSettings(dialog);
      assert.deepEqual(await settingsApi(), baseline);

      dialog = await openSettings();
      await dialog.locator("#display-name").fill("Settings Attachment QA");
      const claude = dialog.getByRole("button", { name: /^Claude Code/ });
      if (await claude.isEnabled()) await claude.click();
      const connection = dialog.getByRole("combobox", { name: "Model connection", exact: true });
      await connection.selectOption("native");
      const model = dialog.getByRole("combobox", { name: "Generation model", exact: true });
      const modelValues = await model.locator("option").evaluateAll((options) => options.map((option) => option.value).filter(Boolean));
      assert.ok(modelValues.length > 0);
      const chosenModel = modelValues.find((value) => value === "opus") ?? modelValues.at(-1);
      await model.selectOption(chosenModel);
      const effort = dialog.getByRole("combobox", { name: "Reasoning effort", exact: true });
      const effortValues = await effort.locator("option").evaluateAll((options) => options.map((option) => option.value));
      const chosenEffort = effortValues.includes("high") ? "high" : effortValues.at(-1);
      await effort.selectOption(chosenEffort);
      await dialog.getByRole("checkbox").check();
      await dialog.getByRole("button", { name: "Full", exact: true }).click();
      await dialog.getByRole("button", { name: "Dark", exact: true }).click();
      const saved = await saveSettings(dialog);
      assert.equal(saved.user.display_name, "Settings Attachment QA");
      assert.equal(saved.theme, "dark");
      assert.equal(saved.chat_context_mode, "full");
      assert.equal(saved.chat_abort_threshold_ms, baseline.chat_abort_threshold_ms, "general settings must preserve the legacy stored preference");
      assert.equal(saved.generation_defaults[saved.default_backend].provider, "native");
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
      dialog = await openSettings();
      assert.equal(await dialog.locator("#display-name").inputValue(), "Settings Attachment QA");
      await dialog.getByRole("note").waitFor();
      assert.equal(await dialog.getByRole("button", { name: "Dark", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(await dialog.getByRole("button", { name: "Full", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(await connection.inputValue(), "native");
      await closeSettings(dialog);
      return { canceledWithoutMutation: true, saved: { name: saved.user.display_name, theme: saved.theme, backend: saved.default_backend, generation: saved.generation_defaults[saved.default_backend], context: saved.chat_context_mode, configuredDelayMs: saved.chat_abort_threshold_ms }, reloaded: true };
    });

    await scenario("theme-auto-os-and-cancel", async () => {
      let dialog = await openSettings();
      await dialog.getByRole("button", { name: "System", exact: true }).click();
      await saveSettings(dialog);
      await page.emulateMedia({ colorScheme: "light" });
      await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      dialog = await openSettings();
      await dialog.getByRole("button", { name: "Light", exact: true }).click();
      await closeSettings(dialog);
      assert.equal((await settingsApi()).theme, "auto");
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
      await page.emulateMedia({ colorScheme: "no-preference" });
      return { autoPersisted: true, actualMediaChangesApplied: ["light", "dark"], canceledLightDiscarded: true };
    });

    await scenario("commandcode-write-only-status-draft-and-generation-default", async () => {
      const secret = `cc_${crypto.randomUUID()}`;
      let dialog = await openSettings();
      await dialog.locator("#display-name").fill("UNSAVED COMMANDCODE GENERAL DRAFT");
      await dialog.locator("#commandcode-api-key").fill(secret);
      const savedResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/settings" && response.request().method() === "PATCH");
      await dialog.locator("#commandcode-api-key").locator("..").getByRole("button", { name: "Save key", exact: true }).click();
      assert.equal((await savedResponse).status(), 200);
      await dialog.getByText("A key is saved.", { exact: false }).first().waitFor();
      assert.equal(await dialog.locator("#display-name").inputValue(), "UNSAVED COMMANDCODE GENERAL DRAFT");
      assert.equal(await dialog.locator("#commandcode-api-key").inputValue(), "");
      assert.equal((await dialog.locator("body").count()), 0);
      assert.equal((await dialog.textContent()).includes(secret), false);
      const summary = await settingsApi();
      assert.equal(summary.commandcode_api_key_set, true);
      assert.equal(JSON.stringify(summary).includes(secret), false);
      const connection = dialog.getByRole("combobox", { name: "Model connection", exact: true });
      assert.equal(await connection.locator('option[value="commandcode"]').isDisabled(), false);
      await connection.selectOption("commandcode");
      const model = dialog.getByRole("combobox", { name: "Generation model", exact: true });
      await model.selectOption("claude-opus-4-6");
      await dialog.getByRole("combobox", { name: "Reasoning effort", exact: true }).selectOption("medium");
      await dialog.getByRole("button", { name: "Compact", exact: true }).click();
      const saved = await saveSettings(dialog);
      assert.equal(saved.generation_defaults["claude-code"].provider, "commandcode");
      assert.equal(saved.generation_defaults["claude-code"].model, "claude-opus-4-6");
      assert.equal(saved.generation_defaults["claude-code"].effort, "medium");
      assert.equal(saved.chat_context_mode, "compact");
      dialog = await openSettings();
      assert.equal(await connection.inputValue(), "commandcode");
      await connection.selectOption("native");
      await model.selectOption("sonnet");
      await dialog.getByRole("combobox", { name: "Reasoning effort", exact: true }).selectOption("medium");
      await saveSettings(dialog);
      dialog = await openSettings();
      await dialog.locator("#display-name").fill("UNSAVED COMMANDCODE DELETE DRAFT");
      const deleted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/settings" && response.request().method() === "PATCH");
      await dialog.locator("#commandcode-api-key").locator("..").getByRole("button", { name: "Delete key", exact: true }).click();
      assert.equal((await deleted).status(), 200);
      assert.equal(await dialog.locator("#display-name").inputValue(), "UNSAVED COMMANDCODE DELETE DRAFT");
      assert.equal((await settingsApi()).commandcode_api_key_set, false);
      const commandcodeOption = connection.locator('option[value="commandcode"]');
      await waitDisabled(commandcodeOption, true);
      assert.equal(await commandcodeOption.evaluate((option) => option.disabled), true);
      await closeSettings(dialog);
      return { writeOnly: true, generalDraftPreservedOnSaveDelete: true, commandcodeSelectionEnabledOnlyWithKey: true, commandcodeDefaultReopened: true, finalProvider: "native", finalKeySet: false };
    });

    await scenario("figma-gemini-deepseek-grok-write-only-status-and-drafts", async () => {
      const dialog = await openSettings();
      const exercised = [];
      const figmaSecret = `figd_${crypto.randomUUID()}`;
      await dialog.locator("#display-name").fill("UNSAVED FIGMA GENERAL DRAFT");
      await dialog.locator("#figma-token").fill(figmaSecret);
      let pending = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/settings" && response.request().method() === "PATCH");
      await dialog.locator("#figma-token").locator("..").getByRole("button", { name: "Save", exact: true }).click();
      assert.equal((await pending).status(), 200);
      assert.equal(await dialog.locator("#display-name").inputValue(), "UNSAVED FIGMA GENERAL DRAFT");
      assert.equal((await dialog.textContent()).includes(figmaSecret), false);
      assert.equal((await settingsApi()).figma_token_set, true);
      await dialog.locator("#display-name").fill("UNSAVED FIGMA DELETE DRAFT");
      pending = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/settings" && response.request().method() === "PATCH");
      await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
      assert.equal((await pending).status(), 200);
      assert.equal(await dialog.locator("#display-name").inputValue(), "UNSAVED FIGMA DELETE DRAFT");
      assert.equal((await settingsApi()).figma_token_set, false);
      exercised.push("Figma");

      for (const [id, name] of [["gemini", "Gemini"], ["deepseek", "DeepSeek"], ["xai", "Grok"]]) {
        const secret = `${id}_${crypto.randomUUID()}`;
        const input = dialog.locator(`#llm-key-${id}`);
        const card = input.locator("..");
        await dialog.locator("#display-name").fill(`UNSAVED ${name.toUpperCase()} SAVE DRAFT`);
        await input.fill(secret);
        pending = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/settings" && response.request().method() === "PATCH");
        await card.getByRole("button", { name: "Save key", exact: true }).click();
        assert.equal((await pending).status(), 200);
        assert.equal(await dialog.locator("#display-name").inputValue(), `UNSAVED ${name.toUpperCase()} SAVE DRAFT`);
        assert.equal(await input.inputValue(), "");
        assert.equal((await dialog.textContent()).includes(secret), false);
        let summary = await settingsApi();
        assert.equal(summary.llm_connections.find((item) => item.id === id).api_key_set, true);
        assert.equal(summary.llm_connections.find((item) => item.id === id).generation_status, "not_implemented");
        assert.equal(JSON.stringify(summary).includes(secret), false);
        await dialog.locator("#display-name").fill(`UNSAVED ${name.toUpperCase()} DELETE DRAFT`);
        pending = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/settings" && response.request().method() === "PATCH");
        await card.getByRole("button", { name: "Delete key", exact: true }).click();
        assert.equal((await pending).status(), 200);
        assert.equal(await dialog.locator("#display-name").inputValue(), `UNSAVED ${name.toUpperCase()} DELETE DRAFT`);
        summary = await settingsApi();
        assert.equal(summary.llm_connections.find((item) => item.id === id).api_key_set, false);
        exercised.push(name);
      }
      await dialog.getByText("Generation is not implemented, and these keys are not used to call models.", { exact: false }).waitFor();
      await closeSettings(dialog);
      assert.equal(unexpectedEventPosts, 0);
      return { exercised, allWriteOnly: true, allDeleted: true, unsavedGeneralDraftPreserved: true, generationStatuses: "not_implemented", providerCalls: 0 };
    });

    await scenario("backend-missing-and-retry-explicit-fixture", async () => {
      let phase = "error";
      const detectionRoute = async (route) => {
        if (phase === "error") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "qa_detection_failure", message: "Controlled detection failure" } }) });
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { backends: [
          { id: "claude-code", found: true, version: "qa-installed", binary_path: "/owned/qa/claude", models: [{ id: "sonnet", label: "Sonnet", efforts: ["low", "medium", "high"] }] },
          { id: "codex", found: false, install_hint: "Install: https://github.com/openai/codex", models: [] },
        ] } }) });
      };
      await context.route("**/api/backends/detect", detectionRoute);
      try {
        await page.goto(`${base}/settings`, { waitUntil: "domcontentloaded" });
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({ state: "visible" });
        const alert = dialog.getByRole("alert").filter({ hasText: "Could not check backend status" });
        await alert.waitFor({ state: "visible", timeout: 60_000 });
        phase = "missing";
        const retried = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/backends/detect" && response.status() === 200);
        await alert.getByRole("button", { name: "Try again", exact: true }).click();
        await retried;
        const codex = dialog.getByRole("button", { name: /^Codex/ });
        await codex.waitFor();
        assert.equal(await codex.isDisabled(), true);
        assert.match(await codex.textContent(), /Install Codex.*https:\/\/github\.com\/openai\/codex/s);
        await closeSettings(dialog);
        return { fixture: "explicit browser HTTP fixture", failureSurfaced: true, retryRecovered: true, missingCodexDisabled: true, installerNotInvoked: true };
      } finally {
        await context.unroute("**/api/backends/detect", detectionRoute);
        await page.reload({ waitUntil: "domcontentloaded" });
      }
    }, "explicit-http-fixture");

    await page.goto(`${base}/projects/${project.id}`, { waitUntil: "domcontentloaded" });
    await waitComposerReady();
    await page.frameLocator("iframe[title]").locator("#source-sentinel").waitFor();

    await scenario("valid-picker-drop-original-preservation-roles-reload-download", async () => {
      const picked = fixture.names.slice(0, 4);
      const dropped = fixture.names.slice(4);
      await addPicker(picked.map((name) => fixture.paths[name]));
      await addDrop(dropped);
      await page.getByText("The originals were saved to docs/attachments.", { exact: false }).waitFor();
      assert.equal(await attachmentRows().count(), 7);
      for (const name of fixture.names) await attachmentRows().filter({ hasText: name }).waitFor();
      const role = attachmentRows().filter({ hasText: "reference.pptx" }).getByRole("combobox");
      await role.selectOption("immutable_reference");
      await textarea().fill("ATTACHMENT_DRAFT_PRESERVE");
      let stored = await waitDraft("ATTACHMENT_DRAFT_PRESERVE", fixture.names);
      assert.equal(stored.items.find((item) => item.name === "reference.pptx").role, "immutable_reference");
      await page.reload({ waitUntil: "domcontentloaded" });
      await textarea().waitFor();
      assert.equal(await textarea().inputValue(), "ATTACHMENT_DRAFT_PRESERVE");
      assert.equal(await attachmentRows().count(), 7);
      assert.equal(await attachmentRows().filter({ hasText: "reference.pptx" }).getByRole("combobox").inputValue(), "immutable_reference");

      const files = await okData(`/api/projects/${project.id}/files`);
      const documents = files.filter((file) => file.rel_path.startsWith("docs/attachments/") && fixture.names.some((name) => file.rel_path.endsWith(`-${name}`)));
      assert.equal(documents.length, 7);
      await page.getByRole("button", { name: "Design files", exact: true }).click();
      const verified = [];
      for (const name of fixture.names) {
        const file = documents.find((item) => item.rel_path.endsWith(`-${name}`));
        assert.ok(file, name);
        await page.locator(`button[title=${JSON.stringify(file.rel_path)}]`).click();
        const anchor = page.getByRole("link", { name: "Download original", exact: true });
        await anchor.waitFor();
        const download = page.waitForEvent("download");
        await anchor.click();
        const downloaded = await download;
        const downloadedPath = await downloaded.path();
        assert.ok(downloadedPath);
        assert.deepEqual(await readFile(downloadedPath), fixture.bytes[name]);
        const served = await page.request.get(`${base}/api/projects/${project.id}/fs/${file.rel_path.split("/").map(encodeURIComponent).join("/")}`);
        assert.equal(served.status(), 200);
        assert.deepEqual(await served.body(), fixture.bytes[name]);
        assert.equal(served.headers().etag, `"${sha256(fixture.bytes[name])}"`);
        verified.push({ name, bytes: fixture.bytes[name].length, sha256: sha256(fixture.bytes[name]), contentDisposition: served.headers()["content-disposition"] });
      }
      await page.getByRole("button", { name: "Design files", exact: true }).click();
      const beforeFiles = await okData(`/api/projects/${project.id}/files`);
      await attachmentRows().filter({ hasText: "reference.pdf" }).getByRole("button", { name: "Remove attachment reference.pdf", exact: true }).click();
      stored = await waitDraft("ATTACHMENT_DRAFT_PRESERVE", fixture.names.slice(1));
      assert.equal(stored.items.length, 6);
      await page.reload({ waitUntil: "domcontentloaded" });
      await attachmentRows().first().waitFor();
      assert.equal(await attachmentRows().count(), 6);
      const afterFiles = await okData(`/api/projects/${project.id}/files`);
      assert.deepEqual(afterFiles.filter((file) => file.rel_path.startsWith("docs/attachments/")).map((file) => file.rel_path).sort(), beforeFiles.filter((file) => file.rel_path.startsWith("docs/attachments/")).map((file) => file.rel_path).sort());
      return { picker: picked, drop: dropped, validFormats: 7, roleReloaded: "immutable_reference", exactOriginalsDownloadedAndServed: verified, queueRemovalKeptOriginal: true };
    });

    await scenario("existing-source-candidates", async () => {
      const details = composer().locator("details").filter({ hasText: "existing files" });
      await details.locator("summary").click();
      await details.getByText("assets/existing-source.png", { exact: true }).waitFor();
      await details.getByText("assets/existing-source.webp", { exact: true }).waitFor();
      assert.equal(await details.getByText("Editable", { exact: true }).count(), 2);
      await details.getByText("URLs, web images, and stock images cannot be attached.", { exact: false }).waitFor();
      return { indexedCandidates: ["assets/existing-source.png", "assets/existing-source.webp"], status: "editable-only", unsupportedExplanation: true };
    });

    await scenario("native-clipboard-image-and-text-with-restore", async () => {
      await resetDraft();
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      try {
        clipboardSnapshot = await captureClipboard(page);
        await page.evaluate(async () => {
          const canvas = document.createElement("canvas");
          canvas.width = 3; canvas.height = 2;
          const drawing = canvas.getContext("2d");
          drawing.fillStyle = "#0B57D0"; drawing.fillRect(0, 0, 3, 2);
          const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
          await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
        });
        const preserved = documentResponse();
        await textarea().focus();
        await page.keyboard.press(process.platform === "darwin" ? "Meta+v" : "Control+v");
        assert.equal((await preserved).status(), 200);
        await attachmentRows().first().waitFor();
        assert.equal(await attachmentRows().count(), 1);
        assert.equal(await attachmentRows().first().getByRole("combobox").count(), 1);
        await page.evaluate(() => navigator.clipboard.writeText("clipboard text regression"));
        await textarea().fill("");
        await page.keyboard.press(process.platform === "darwin" ? "Meta+v" : "Control+v");
        assert.equal(await textarea().inputValue(), "clipboard text regression");
        assert.equal(await attachmentRows().count(), 1);
        return { imagePaste: "native browser clipboard and platform shortcut", textPaste: "native text unchanged", documentPreserved: true, priorClipboardCaptured: true };
      } finally {
        if (clipboardSnapshot) await restoreClipboard(page, clipboardSnapshot);
        clipboardSnapshot = null;
        await context.clearPermissions();
      }
    });

    await scenario("count-limit-over-eight", async () => {
      await resetDraft();
      const before = requests.filter((item) => item.kind === "model-turn").length;
      const pending = documentResponse();
      await fileInput().setInputFiles(Array.from({ length: 9 }, (_, index) => path.join(fixture.directory, `count-${index + 1}.png`)));
      assert.equal((await pending).status(), 200);
      assert.equal(await attachmentRows().count(), 9);
      assert.equal(await attachmentRows().filter({ hasText: "Maximum of 8 files" }).count(), 1);
      assert.equal(await attachmentRows().locator("select").count(), 8);
      assert.equal(requests.filter((item) => item.kind === "model-turn").length, before);
      return { ready: 8, rejected: 1, rejectedReason: "count_exceeded", modelTurns: 0 };
    });

    await scenario("per-file-limit-over-ten-mib", async () => {
      await resetDraft();
      const documentsBefore = requests.filter((item) => item.path === `/api/sessions/${session.id}/documents`).length;
      await fileInput().setInputFiles(path.join(fixture.directory, "over-10MiB.pdf"));
      await attachmentRows().first().waitFor();
      assert.equal(await attachmentRows().first().getByText("Exceeds 10 MB per file", { exact: true }).isVisible(), true);
      assert.equal(await attachmentRows().locator("select").count(), 0);
      assert.equal(requests.filter((item) => item.path === `/api/sessions/${session.id}/documents`).length, documentsBefore);
      return { bytes: 10 * 1024 * 1024 + 1, rejectedBeforeUpload: true, reason: "too_large" };
    });

    await scenario("total-limit-over-twenty-five-mib", async () => {
      await resetDraft();
      const pending = documentResponse();
      await fileInput().setInputFiles(["total-a.pdf", "total-b.pdf", "total-c.pdf"].map((name) => path.join(fixture.directory, name)));
      assert.equal((await pending).status(), 200);
      assert.equal(await attachmentRows().count(), 3);
      assert.equal(await attachmentRows().locator("select").count(), 2);
      assert.equal(await attachmentRows().filter({ hasText: "Exceeds 25 MB total" }).count(), 1);
      return { readyBytes: 18 * 1024 * 1024, rejectedThirdAtBytes: 27 * 1024 * 1024, reason: "total_exceeded" };
    });

    await scenario("text-attachments-preserve-originals", async () => {
      await resetDraft();
      const files = [
        { name: "notes.txt", mimeType: "text/plain", buffer: await readFile(path.join(fixture.directory, "notes.txt")) },
        { name: "brief.md", mimeType: "text/markdown", buffer: Buffer.from("# Owned brief\nText attachment E2E") },
        { name: "data.csv", mimeType: "text/csv", buffer: Buffer.from("name,value\nA,1\nB,2") },
      ];
      const saved = documentResponse();
      await fileInput().setInputFiles(files);
      const response = await saved;
      assert.equal(response.status(), 200, await response.text());
      const paths = (await response.json()).data.paths;
      assert.equal(paths.length, files.length);
      assert.equal(await attachmentRows().locator("select").count(), files.length);
      for (const [index, file] of files.entries()) {
        const served = await page.request.get(`${base}/api/projects/${project.id}/fs/${paths[index].split("/").map(encodeURIComponent).join("/")}`);
        assert.equal(served.status(), 200);
        assert.deepEqual(await served.body(), file.buffer);
      }
      return { accepted: files.map((file) => file.name), storedPaths: paths, exactOriginalBytes: true };
    });

    await scenario("malformed-supported-source-fails-before-provider-and-keeps-original", async () => {
      await resetDraft();
      const docs = await addPicker([path.join(fixture.directory, "malformed.pdf")]);
      await textarea().fill("Do not run a provider; malformed extraction must fail first.");
      const before = await okData(`/api/sessions/${session.id}/events`);
      expectedMalformedEventPosts = 1;
      const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/sessions/${session.id}/events` && response.request().method() === "POST");
      await composer().getByRole("button", { name: "Send (Cmd/Ctrl+Enter)", exact: true }).click();
      const response = await responsePromise;
      assert.equal(response.status(), 422, await response.text());
      assert.equal((await response.json()).error.code, "pdf_invalid");
      await composer().getByRole("button", { name: "Send again (Cmd/Ctrl+Enter)", exact: true }).waitFor();
      assert.equal(await textarea().inputValue(), "Do not run a provider; malformed extraction must fail first.");
      assert.equal(await attachmentRows().count(), 1);
      assert.deepEqual(await okData(`/api/sessions/${session.id}/events`), before);
      const original = await page.request.get(`${base}/api/projects/${project.id}/fs/${docs[0].split("/").map(encodeURIComponent).join("/")}`);
      assert.equal(original.status(), 200);
      assert.deepEqual(await original.body(), await readFile(path.join(fixture.directory, "malformed.pdf")));
      return { eventAttempt: "expected and guarded", status: 422, code: "pdf_invalid", providerEvents: 0, retryState: true, originalPreserved: true };
    });

    await scenario("failed-original-persistence-blocks-send-and-real-retry", async () => {
      await resetDraft();
      const pattern = `**/api/sessions/${session.id}/documents`;
      const fault = (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "qa_document_fault", message: "Controlled original persistence failure" } }) });
      await page.route(pattern, fault);
      try {
        const failed = documentResponse();
        await fileInput().setInputFiles(fixture.paths["reference.png"]);
        assert.equal((await failed).status(), 503);
        await page.getByText("The originals couldn't be saved.", { exact: false }).waitFor();
        await textarea().fill("DRAFT MUST REMAIN WHILE ORIGINAL SAVE FAILS");
        assert.equal(await composer().getByRole("button", { name: "Send (Cmd/Ctrl+Enter)", exact: true }).isDisabled(), true);
        assert.equal(unexpectedEventPosts, 0);
        await page.unroute(pattern, fault);
        const retried = documentResponse();
        await composer().getByRole("button", { name: "Save again", exact: true }).click();
        assert.equal((await retried).status(), 200);
        await page.getByText("The originals were saved to docs/attachments.", { exact: false }).waitFor();
        assert.equal(await textarea().inputValue(), "DRAFT MUST REMAIN WHILE ORIGINAL SAVE FAILS");
        assert.equal(await composer().getByRole("button", { name: "Send (Cmd/Ctrl+Enter)", exact: true }).isEnabled(), true);
        return { fault: "explicit one-endpoint HTTP 503", sendBlocked: true, realBackendRetry: 200, draftRetained: true, modelTurns: 0 };
      } finally { await page.unroute(pattern, fault); }
    }, "explicit-http-fault-real-recovery");

    await scenario("locales-settings-home-project-reload-preserve-source-and-draft", async () => {
      await textarea().fill("LOCALE_DRAFT_한글_English_中文");
      await attachmentRows().first().getByRole("combobox").selectOption("immutable_reference");
      await waitDraft("LOCALE_DRAFT_한글_English_中文", ["reference.png"]);
      const results = [];
      for (const locale of ["ko", "en", "zh-CN"]) {
        const dialog = await openSettings();
        await dialog.getByRole("button", { name: locale === "ko" ? "한국어" : locale === "en" ? "English" : "简体中文", exact: true }).click();
        await dialog.getByRole("heading", { name: localized[locale].settings, exact: true }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.lang), locale);
        assert.equal(await page.evaluate(() => localStorage.getItem("burnguard.locale")), locale);
        await closeSettings(dialog, localized[locale].cancel);
        await page.goto(base, { waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: localized[locale].home, exact: true }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.lang), locale);
        await page.goto(`${base}/projects/${project.id}`, { waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: localized[locale].designFiles, exact: true }).waitFor();
        await waitComposerReady();
        assert.equal(await textarea().inputValue(), "LOCALE_DRAFT_한글_English_中文");
        await attachmentRows().first().waitFor();
        const attachmentCount = await attachmentRows().count();
        assert.equal(attachmentCount, 1);
        await waitDraft("LOCALE_DRAFT_한글_English_中文", ["reference.png"]);
        assert.equal(await attachmentRows().first().getByRole("combobox").inputValue(), "immutable_reference");
        assert.equal(await page.frameLocator("iframe[title]").locator("#source-sentinel").textContent(), "QA_SOURCE_DO_NOT_TRANSLATE · 한글 · 中文");
        await page.reload({ waitUntil: "domcontentloaded" });
        await waitComposerReady();
        assert.equal(await page.evaluate(() => document.documentElement.lang), locale);
        assert.equal(await textarea().inputValue(), "LOCALE_DRAFT_한글_English_中文");
        assert.equal(await page.frameLocator("iframe[title]").locator("#source-sentinel").textContent(), "QA_SOURCE_DO_NOT_TRANSLATE · 한글 · 中文");
        results.push({ locale, htmlLang: locale, settings: true, home: true, project: true, reload: true, sourceUntranslated: true, textDraftUnchanged: true, attachmentDraftRendered: attachmentCount === 1 });
      }
      return results;
    });

    await scenario("mobile-focus-wrapping-settings-and-project", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${base}/projects/${project.id}`, { waitUntil: "domcontentloaded" });
      const chatSwitch = page.getByRole("button", { name: /^(AI chat|AI 대화|AI 对话)$/ });
      await chatSwitch.waitFor({ state: "visible" });
      await chatSwitch.click();
      await waitComposerReady();
      if (await attachmentRows().count() === 0) await addPicker([fixture.paths["reference.png"]]);
      await attachmentRows().first().waitFor();
      await attachmentRows().first().getByRole("combobox").selectOption("immutable_reference");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.equal((await attachmentRows().first().boundingBox()).width <= 390, true);
      const roleBox = await attachmentRows().first().getByRole("combobox").boundingBox();
      assert.ok(roleBox && roleBox.height >= 44);
      await page.getByRole("button", { name: /^(Open settings|설정 열기|打开设置)$/ }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      const currentLocale = await page.evaluate(() => localStorage.getItem("burnguard.locale"));
      const firstSection = dialog.getByRole("button", { name: currentLocale === "ko" ? "사용자" : currentLocale === "zh-CN" ? "用户" : "User", exact: true });
      await firstSection.focus();
      assert.equal(await firstSection.evaluate((node) => node === document.activeElement), true);
      await page.keyboard.press("Tab");
      assert.equal(await dialog.evaluate((node) => node.contains(document.activeElement)), true);
      const geometry = await dialog.evaluate((node) => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, viewport: innerWidth }));
      assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, JSON.stringify(geometry));
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewport + 1, JSON.stringify(geometry));
      await closeSettings(dialog, currentLocale === "ko" ? "취소" : currentLocale === "zh-CN" ? "取消" : "Cancel");
      return { viewport: "390x844", projectHorizontalOverflow: false, attachmentRoleTargetAtLeast44: true, settingsKeyboardFocusContained: true, settingsNoHorizontalClipping: true };
    });

    assert.equal(expectedMalformedEventPosts, 0);
    assert.equal(unexpectedEventPosts, 0, "No unplanned POST /api/sessions/*/events may reach a provider");
    assert.equal(requests.some((entry) => entry.kind === "host-side-effect"), false, "No install/update action should be attempted");
  } catch (error) {
    await shot("settings-attachments-setup-or-fatal-failure");
    await writeFile(path.join(evidence, "settings-attachments-fatal.json"), JSON.stringify({ error: String(error.stack ?? error), url: page.url(), body: await page.locator("body").innerText().catch(() => ""), browserErrors }, null, 2));
    throw error;
  } finally {
    if (clipboardSnapshot) {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await restoreClipboard(page, clipboardSnapshot);
      await context.clearPermissions();
    }
    await context.unroute("**/*", guard);
    await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
    await report();
  }
  assert.equal(failures.length, 0, `${failures.length} settings/attachment checks failed; see settings-attachments-report.json`);
}
