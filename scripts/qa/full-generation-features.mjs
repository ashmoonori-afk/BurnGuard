import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { watch } from "node:fs";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "packages/backend/package.json"));
const JSZip = require("jszip");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const initialHeading = "BG_GENERATION_BASELINE";
const initialHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Owned generation fixture</title><style>body{font:24px Arial;margin:48px;background:#f5f7ff}h1{color:#14254d}</style></head><body><h1 id="qa-heading" data-bg-node-id="qa-heading">${initialHeading}</h1><p>Disposable local generation fixture. No external resources.</p></body></html>`;

/** Live providers and real local API. Only the failed-send row injects a labeled HTTP failure. */
export async function run({ page, context, base, home, check, shot, evidence }) {
  const observations = [];
  const bus = new EventEmitter();
  const failures = [];
  const blockers = [];
  let fixture;
  let headers;
  let modelsByBackend;
  let barrierWatcher;
  let barrierPid;
  const streamEvents = [];
  const pendingObservations = new Set();
  const browserErrors = [];
  const canvasNetwork = [];
  const pendingNetwork = new Set();
  const observeResponse = (response) => {
    const pathname = new URL(response.url()).pathname;
    if (!/\/api\/projects\/[^/]+\/(?:files|artifacts|fs\/index\.html)$/.test(pathname) && !pathname.includes("/preview/")) return;
    const contentType = response.headers()["content-type"] ?? "";
    if (!/json|html|css|text/.test(contentType)) return;
    const reading = response.text().then(
      (body) => canvasNetwork.push({ url: response.url(), status: response.status(), method: response.request().method(), body, failure: response.request().failure() }),
      (error) => canvasNetwork.push({ url: response.url(), status: response.status(), error: String(error) }),
    ).finally(() => pendingNetwork.delete(reading));
    pendingNetwork.add(reading);
  };
  page.on("response", observeResponse);
  page.on("pageerror", (error) => browserErrors.push(String(error)));
  const persist = () => writeFile(path.join(evidence, "generation-observations.json"), JSON.stringify({ observations, failures, blockers }, null, 2));
  const row = async (name, action, mode = "live-local") => {
    try { await check(name, async () => { const result = await action(); observations.push({ name, mode, ...result }); await persist(); return result; }, mode); }
    catch (error) { failures.push({ name, error: String(error.stack ?? error) }); await persist(); console.error(`[generation defect/blocker] ${name}: ${error.message}`); }
  };
  const arm = (predicate, timeout = 180_000) => {
    let listener;
    let timer;
    let rejectWait;
    const promise = new Promise((resolve, reject) => {
      rejectWait = reject;
      listener = (event) => { if (predicate(event)) { clearTimeout(timer); bus.off("event", listener); pendingObservations.delete(cancel); resolve(event); } };
      bus.on("event", listener);
      timer = setTimeout(() => { bus.off("event", listener); pendingObservations.delete(cancel); reject(new Error("Exact generation event deadline exceeded")); }, timeout);
    });
    promise.catch(() => {}); // The owner awaits/reports this promise; prevent early unhandled rejection.
    const cancel = () => { clearTimeout(timer); bus.off("event", listener); pendingObservations.delete(cancel); rejectWait(new Error("Observation cancelled by owner")); };
    pendingObservations.add(cancel);
    return { promise, cancel };
  };
  const request = async (suffix, method = "GET", data) => {
    const response = await page.request.fetch(`${base}${suffix}`, { method, headers, ...(data === undefined ? {} : { data }) });
    const body = await response.json();
    assert.ok(response.ok(), `${method} ${suffix}: ${response.status()} ${JSON.stringify(body)}`);
    return body.data;
  };
  const composer = () => page.locator('[data-qa="composer"]');
  const textarea = () => composer().locator("textarea");
  const send = () => composer().getByRole("button", { name: /^Send(?: again)? \(Cmd\/Ctrl\+Enter\)$/ });
  const backendButton = (id) => page.getByRole("button", { name: id === "codex" ? "Codex" : "Claude Code", exact: true });
  const canvas = () => page.frameLocator("iframe[title]").locator("#qa-heading");
  const source = () => readFile(path.join(fixture.dir, "index.html"), "utf8");
  const waitEnabled = async () => {
    await textarea().waitFor({ state: "visible" });
    await textarea().evaluate((element) => new Promise((resolve) => {
      if (!element.disabled) return resolve();
      const observer = new MutationObserver(() => { if (!element.disabled) { observer.disconnect(); clearTimeout(timer); resolve(); } });
      const timer = setTimeout(() => { observer.disconnect(); resolve(); }, 15_000);
      observer.observe(element, { attributes: true, attributeFilter: ["disabled"] });
    }));
    assert.equal(await textarea().isEnabled(), true, "composer must be unlocked");
  };
  const reload = async () => {
    const opened = arm((event) => event.kind === "subscribe" && event.url.includes(`/sessions/${fixture.session}/stream`), 20_000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await opened.promise;
    await canvas().waitFor();
    await waitEnabled();
  };
  const waitModels = async (backend) => {
    const model = composer().getByRole("combobox", { name: "Generation model", exact: true });
    const values = modelsByBackend[backend];
    assert.ok(values?.length, `${backend} must expose an explicit model`);
    await model.locator(`option[value="${values[0]}"]`).waitFor({ state: "attached", timeout: 30_000 });
    return { model, values };
  };
  const options = async () => {
    const backend = await backendButton("codex").getAttribute("aria-pressed") === "true" ? "codex" : "claude-code";
    const { model } = await waitModels(backend);
    return {
      model: await model.inputValue(),
      effort: await composer().getByRole("combobox", { name: "Reasoning effort", exact: true }).inputValue(),
      vanilla: await composer().locator('input[type="checkbox"]').isChecked(),
    };
  };
  const selectBackend = async (backend) => {
    if (await backendButton(backend).getAttribute("aria-pressed") !== "true") {
      const switched = page.waitForResponse((response) => response.url().endsWith(`/sessions/${fixture.session}/backend`) && response.request().method() === "PATCH");
      await backendButton(backend).click();
      assert.equal((await switched).status(), 200);
      await backendButton(backend).and(page.locator('[aria-pressed="true"]')).waitFor();
    }
    await waitEnabled();
    const { model, values } = await waitModels(backend);
    const details = composer().locator("fieldset details");
    if (await details.getAttribute("open") === null) await details.locator("summary").click();
    await composer().getByRole("checkbox").check();
    if (backend === "claude-code") await composer().getByRole("combobox", { name: "Model connection", exact: true }).selectOption("native");
    // Connection changes intentionally reset model and LOW; choose the explicit model afterwards.
    const chosen = backend === "claude-code" ? values.find((value) => value.includes("sonnet")) ?? values[0] : values[0];
    await model.selectOption(chosen);
    await composer().getByRole("combobox", { name: "Reasoning effort", exact: true }).selectOption("low");
    const selected = await options();
    assert.equal(selected.model, chosen);
    return selected;
  };
  const waitCanvas = async (heading) => {
    try {
      await page.frameLocator("iframe[title]").getByRole("heading", { name: heading, exact: true }).waitFor({ timeout: 30_000 });
      assert.equal(await canvas().textContent(), heading);
    } catch (error) {
      await Promise.all([...pendingNetwork]);
      const frameAttributes = await page.locator("iframe").evaluateAll((frames) => frames.map((frame) => ({
        title: frame.title, src: frame.getAttribute("src"), srcdoc: frame.getAttribute("srcdoc"),
      })));
      const frameDocuments = await Promise.all(page.frames().filter((frame) => frame.parentFrame()).map(async (frame) => ({
        url: frame.url(), document: await frame.evaluate(() => ({ html: document.documentElement.outerHTML, text: document.body?.innerText })),
      })));
      await writeFile(path.join(evidence, "canvas-failure-diagnostics.json"), JSON.stringify({ heading, frameAttributes, frameDocuments, canvasNetwork, browserErrors }, null, 2));
      throw error;
    }
  };
  const submit = async (text, { cancel = false } = {}) => {
    await textarea().fill(text);
    const startIndex = streamEvents.length;
    const running = arm((item) => item.event?.type === "status.running");
    const idle = arm((item) => item.event?.type === "status.idle", cancel ? 120_000 : 240_000);
    const accepted = page.waitForResponse((response) => response.url().endsWith(`/sessions/${fixture.session}/events`) && response.request().method() === "POST");
    await send().click();
    const response = await accepted;
    assert.equal(response.status(), 200, `live send: ${await response.text()}`);
    const sent = response.request().postDataJSON();
    const receipt = (await response.json()).data;
    await running.promise;
    return { idle, sent, receipt, startIndex };
  };
  try {
    await page.exposeBinding("__generationObserved", (_source, event) => { if (event.event) streamEvents.push(event); bus.emit("event", event); });
    await context.addInitScript(() => {
      if (window !== window.top) return;
      localStorage.setItem("burnguard.locale", "en");
      const Native = window.EventSource;
      window.EventSource = class extends Native {
        constructor(url, config) {
          super(url, config);
          window.__generationObserved({ kind: "subscribe", url: String(url) });
          this.addEventListener("open", () => window.__generationObserved({ kind: "open", url: String(url) }));
          this.addEventListener("message", (message) => {
            const envelope = JSON.parse(message.data);
            window.__generationObserved({ kind: "message", url: String(url), ...envelope });
          });
        }
      };
    });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    const bootstrap = await page.evaluate(async () => { const response = await fetch("/api/bootstrap"); if (!response.ok) throw new Error(`Bootstrap HTTP ${response.status}`); return (await response.json()).data; });
    headers = { "x-burnguard-capability": bootstrap.capability, origin: base };
    const authentication = {};
    for (const backend of ["claude-code", "codex"]) {
      try {
        if (backend === "claude-code") {
          const status = JSON.parse(execFileSync("claude", ["auth", "status"], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }));
          authentication[backend] = { authenticated: status.loggedIn === true, authMethod: status.authMethod };
        } else {
          // login status may be printed on stderr; retain only the boolean, never account details.
          execFileSync("codex", ["login", "status"], { timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
          authentication[backend] = { authenticated: true };
        }
      } catch (error) { authentication[backend] = { authenticated: false, reason: error.code ?? "auth_probe_failed" }; }
    }
    const detection = await request("/api/backends/detect");
    modelsByBackend = Object.fromEntries(detection.backends.map((backend) => [backend.id, (backend.models ?? []).map((model) => model.id)]));
    observations.push({ name: "provider-authentication", authentication, detected: detection.backends.map(({ id, found, version, authenticated }) => ({ id, found, version, authenticated })) });
    await persist();
    const zip = new JSZip();
    zip.file("index.html", initialHtml);
    zip.file("qa-barrier.cjs", await readFile(path.join(root, "scripts/qa/fixtures/full-generation-barrier.cjs")));
    const imported = await page.request.post(`${base}/api/projects/import`, { headers, multipart: { name: "Owned authenticated generation QA", source: "zip", files: { name: "generation.zip", mimeType: "application/zip", buffer: await zip.generateAsync({ type: "nodebuffer" }) } } });
    assert.equal(imported.status(), 201, await imported.text());
    const project = (await imported.json()).data;
    const dir = await realpath(path.join(home, ".burnguard/data/projects", project.id));
    assert.ok(dir.startsWith(`${home}${path.sep}`), "only owned profile projects may be exercised");
    const session = await request(`/api/projects/${project.id}/session`);
    fixture = { id: project.id, session: session.id, dir };
    const opened = arm((event) => event.kind === "subscribe" && event.url.includes(`/sessions/${session.id}/stream`), 30_000);
    await page.goto(`${base}/projects/${project.id}`, { waitUntil: "domcontentloaded" });
    await opened.promise;
    await waitCanvas(initialHeading);
    await waitEnabled();
    await row("generation-empty-send", async () => {
      assert.equal(await textarea().inputValue(), "");
      assert.equal(await send().isDisabled(), true);
      await textarea().fill("  \n  ");
      assert.equal(await send().isDisabled(), true);
      await textarea().press("Control+Enter");
      assert.equal((await request(`/api/sessions/${session.id}/events`)).filter((item) => item.event?.type === "chat.user_message").length, 0);
      await textarea().fill("");
      return { emptyAndWhitespaceDisabled: true, shortcutCreatesNoTurn: true };
    });

    for (const backend of ["claude-code", "codex"]) {
      let selected;
      await row(`generation-${backend}-selection-retained`, async () => {
        selected = await selectBackend(backend);
        await textarea().fill(`Draft for ${backend}`);
        await reload();
        assert.equal(await backendButton(backend).getAttribute("aria-pressed"), "true");
        assert.deepEqual(await options(), selected);
        assert.equal(await textarea().inputValue(), `Draft for ${backend}`);
        assert.equal((await request(`/api/projects/${project.id}/session`)).backend_id, backend);
        return { backend, selected, retainedAcrossReload: true };
      });
      if (!selected) continue;
      let successfulTurn;
      let failedTerminal;
      const before = await source();
      const beforeIdentity = await request(`/api/projects/${project.id}`);
      const heading = `BG_LIVE_${backend === "codex" ? "CODEX" : "CLAUDE"}_${project.id}`;
      const prompt = `In the current owned operation stage, edit ONLY index.html. Replace the text content of h1#qa-heading with exactly ${heading}. Preserve every other byte in index.html and every other file. Do not generate images, use network tools, install anything, deploy, or start a server. Read the file, make this one bounded local edit, and finish with the sentinel ${heading}.`;
      await row(`generation-${backend}-failed-send-retains-draft`, async () => {
        const routePattern = `${base}/api/sessions/${session.id}/events`;
        const failOnce = async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "generation_qa_transport_failure", message: "Controlled QA send failure" } }) });
        };
        const beforeEvents = (await request(`/api/sessions/${session.id}/events`)).length;
        await page.route(routePattern, failOnce);
        try {
          await textarea().fill(prompt);
          const failed = page.waitForResponse((response) => response.url() === routePattern && response.request().method() === "POST");
          await send().click();
          assert.equal((await failed).status(), 503);
          await composer().getByRole("button", { name: "Send again (Cmd/Ctrl+Enter)", exact: true }).waitFor();
          assert.equal(await textarea().inputValue(), prompt);
          assert.deepEqual(await options(), selected);
          assert.equal((await request(`/api/sessions/${session.id}/events`)).length, beforeEvents);
          return { fixture: "one HTTP 503; no provider or generation events simulated", draftAndOptionsRetained: true };
        } finally { await page.unroute(routePattern, failOnce); }
      }, "controlled-transport");
      if (!authentication[backend].authenticated) {
        blockers.push({ name: `generation-${backend}`, reason: "CLI authentication unavailable; no live generation attempted" });
        await persist();
        continue;
      }
      await row(`generation-${backend}-live`, async () => {
        const turn = await submit(prompt);
        assert.equal(turn.sent.generation.model, selected.model);
        assert.equal(turn.sent.generation.effort, "low");
        assert.equal(turn.sent.generation.vanilla, true);
        const terminal = await turn.idle.promise;
        const events = streamEvents.slice(turn.startIndex).map((item) => item.event);
        await writeFile(path.join(evidence, `${backend}-events.json`), JSON.stringify(events, null, 2));
        await waitEnabled();
        if (terminal.event.stopReason === "error") {
          failedTerminal = terminal.event;
          const authenticationError = events.find((item) => item.type === "chat.delta" && /OAuth session expired|Failed to authenticate/.test(item.text));
          if (authenticationError) blockers.push({ name: `generation-${backend}-live`, reason: authenticationError.text, authStatusIsNotLiveReadiness: true });
        }
        assert.notEqual(terminal.event.stopReason, "error", `${backend} streamed error: ${JSON.stringify(events.filter((item) => item.type === "status.error" || item.type === "chat.delta"))}`);
        assert.ok(events.some((item) => item.type === "chat.delta" && item.text.length), "actual provider text must reach SSE");
        const committed = events.find((item) => item.type === "artifact.operation" && item.outcome === "committed");
        assert.deepEqual(committed?.changedPaths, ["index.html"], "only the canonical heading file may change");
        const after = await source();
        assert.equal(after, before.replace(/(?<=data-bg-node-id="qa-heading">)[^<]+/, heading), "provider must change only the known heading");
        successfulTurn = turn.receipt.turn_id;
        await writeFile(path.join(evidence, `${backend}-before.html`), before);
        await writeFile(path.join(evidence, `${backend}-after.html`), after);
        return { backend, turnId: successfulTurn, selected, running: true, providerDelta: true, stopReason: terminal.event.stopReason, beforeSha256: hash(before), afterSha256: hash(after), exactHeadingOnlyChange: true };
      }, "live-authenticated-provider");
      if (failedTerminal) await row(`generation-${backend}-streamed-error-recovery`, async () => {
        assert.equal(await source(), before);
        await waitEnabled();
        assert.equal(await backendButton("codex").isEnabled(), true);
        assert.deepEqual(await options(), selected);
        return { stopReason: failedTerminal.stopReason, stableSha256: hash(before), composerUnlocked: true, backendSwitchUnlocked: true, optionsRetained: true };
      }, "live-provider-error");
      if (successfulTurn) {
        await row(`generation-${backend}-live-canvas`, async () => {
          await waitCanvas(heading);
          return { heading, canonicalAndCanvasChanged: true };
        }, "live-authenticated-provider");
        await row(`generation-${backend}-transcript-reload`, async () => {
          await reload();
          await waitCanvas(heading);
          await page.locator(".chat-scroll").getByText(prompt, { exact: true }).waitFor();
          const snapshot = await request(`/api/sessions/${session.id}/snapshot`);
          await writeFile(path.join(evidence, `${backend}-snapshot.json`), JSON.stringify(snapshot, null, 2));
          assert.deepEqual(await options(), selected);
          return { transcriptReloaded: true, selected, canvasAfterReload: heading };
        });
      }
      if (successfulTurn) await row(`generation-${backend}-checkpoint-revert`, async () => {
        const revert = page.locator(".chat-scroll").getByRole("button", { name: "Revert this turn", exact: true }).last();
        const beforeCancel = await source();
        page.once("dialog", (dialog) => dialog.dismiss());
        await revert.click();
        assert.equal(await source(), beforeCancel);
        const restored = page.waitForResponse((response) => response.url().endsWith(`/checkpoints/${successfulTurn}/restore`) && response.request().method() === "POST");
        page.once("dialog", (dialog) => dialog.accept());
        await revert.click();
        const response = await restored;
        assert.equal(response.status(), 200, await response.text());
        assert.equal((await response.json()).data.result_digest, beforeIdentity.current_digest, "checkpoint must restore the exact complete canonical tree");
        assert.equal(await source(), before);
        await writeFile(path.join(evidence, `${backend}-restored.html`), await source());
        await reload();
        await waitCanvas(initialHeading);
        await page.locator(".chat-scroll").getByText(prompt, { exact: true }).waitFor();
        assert.equal(await source(), before);
        return { turnId: successfulTurn, cancelPreservedArtifact: true, exactRestorationSha256: hash(before), conversationRetained: true, restoration: (await response.json()).data };
      });
      else blockers.push({ name: `generation-${backend}-checkpoint-revert`, reason: "No successful provider change to restore; see live row failure" });
    }

    if (authentication.codex.authenticated) await row("generation-live-codex-interrupt-barrier", async () => {
      await selectBackend("codex");
      const before = await source();
      const settings = await request("/api/settings");
      const stopAvailable = arm((item) => item.kind === "stop-enabled", 30_000);
      await composer().evaluate((element) => {
        const observer = new MutationObserver(() => {
          const stop = [...element.querySelectorAll("button")].find((button) => /^Stop/.test(button.textContent.trim()) && !button.disabled);
          if (stop) { observer.disconnect(); window.__generationObserved({ kind: "stop-enabled", label: stop.textContent, observedAt: Date.now() }); }
        });
        observer.observe(element, { subtree: true, childList: true, characterData: true, attributes: true });
      });
      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { barrierWatcher.close(); reject(new Error("Live provider did not reach the owned FIFO barrier within 90s")); }, 90_000);
        barrierWatcher = watch(fixture.dir, { recursive: true }, async (_event, filename) => {
          if (!filename?.endsWith("qa-barrier-ready.json")) return;
          try {
            const marker = JSON.parse(await readFile(path.join(fixture.dir, filename), "utf8"));
            clearTimeout(timer); barrierWatcher.close(); resolve(marker);
          } catch (error) { if (error.code !== "ENOENT") { clearTimeout(timer); barrierWatcher.close(); reject(error); } }
        });
      });
      ready.catch(() => {});
      const turn = await submit("Controlled cancellation QA. Do not edit any file or generate any output. Execute exactly `node qa-barrier.cjs` in the current operation stage as a FOREGROUND shell command. It deliberately blocks on an owned FIFO until the user interrupts this turn. Do not background it, wrap it with a timeout, release the FIFO, or work around the block. No images, public network, installs, deployments, or server creation.", { cancel: true });
      const firstStop = await stopAvailable.promise;
      const marker = await ready;
      barrierPid = marker.pid;
      assert.ok(marker.cwd.startsWith(`${fixture.dir}/.meta/artifact-operations/`) && marker.cwd.endsWith("/stage"));
      process.kill(barrierPid, 0);
      assert.equal(await textarea().isDisabled(), true);
      assert.equal(await backendButton("claude-code").isDisabled(), true);
      assert.equal(await backendButton("codex").isDisabled(), true);
      const stop = composer().getByRole("button", { name: /^Stop/ });
      await stop.waitFor({ state: "visible", timeout: 15_000 });
      assert.equal(await stop.isEnabled(), true);
      const stopLabel = await stop.textContent();
      const processAtBarrier = execFileSync("ps", ["-p", String(barrierPid), "-o", "pid=,ppid=,pgid=,stat=,comm="], { encoding: "utf8" }).trim();
      observations.push({ name: "interrupt-barrier-reached", marker, processAtBarrier, stopLabel, firstStop, configuredDelayMs: settings.chat_abort_threshold_ms });
      await shot("live-codex-barrier-stop-available");
      await persist();
      const busy = await page.request.post(`${base}/api/sessions/${session.id}/events`, { headers, data: { type: "user.message", text: "Must be rejected while the owned barrier runs", generation: turn.sent.generation } });
      assert.equal(busy.status(), 409);
      assert.equal((await busy.json()).error.code, "session_busy");
      const switchBusy = await page.request.patch(`${base}/api/sessions/${session.id}/backend`, { headers, data: { backend_id: "claude-code" } });
      assert.equal(switchBusy.status(), 409);
      const interrupt = page.waitForResponse((response) => response.url().endsWith(`/sessions/${session.id}/interrupt`) && response.request().method() === "POST");
      await stop.click();
      assert.equal((await interrupt).status(), 200);
      const terminal = await turn.idle.promise;
      assert.equal(terminal.event.stopReason, "interrupted");
      await waitEnabled();
      const events = streamEvents.slice(turn.startIndex).map((item) => item.event);
      await writeFile(path.join(evidence, "interrupt-events.json"), JSON.stringify(events, null, 2));
      let childExited = false;
      let survivingProcess;
      try {
        process.kill(barrierPid, 0);
        survivingProcess = execFileSync("ps", ["-p", String(barrierPid), "-o", "pid=,ppid=,pgid=,stat=,comm="], { encoding: "utf8" }).trim();
      } catch (error) { if (error.code === "ESRCH") childExited = true; else throw error; }
      observations.push({ name: "interrupt-terminal", childExited, survivingProcess, stopReason: terminal.event.stopReason, busySend: busy.status(), busyBackendSwitch: switchBusy.status(), stableArtifact: (await source()) === before, composerRecovered: await textarea().isEnabled() });
      await persist();
      assert.equal(await source(), before);
      await reload();
      assert.equal(await source(), before);
      assert.equal(await backendButton("claude-code").isEnabled(), true);
      assert.ok(childExited, `Barrier child survived interrupted idle: ${survivingProcess}`);
      barrierPid = undefined;
      return { liveProvider: "codex", barrierReached: marker, busySend: 409, busyBackendSwitch: 409, stopLabel, configuredDelayMs: settings.chat_abort_threshold_ms, stopReason: terminal.event.stopReason, childExited: true, stableSha256: hash(before), composerRecovered: true };
    }, "live-authenticated-provider");
    else blockers.push({ name: "generation-live-codex-interrupt-barrier", reason: "Codex is unauthenticated; live interruption not simulated" });
  } catch (error) {
    await shot("generation-setup-or-fatal-failure");
    await writeFile(path.join(evidence, "generation-fatal.json"), JSON.stringify({ error: String(error.stack ?? error), browserErrors, url: page.url(), body: await page.locator("body").innerText(), streamEvents }, null, 2));
    throw error;
  } finally {
    barrierWatcher?.close();
    if (fixture && headers) {
      const current = await request(`/api/projects/${fixture.id}/session`);
      if (current.status === "running") {
        const idle = arm((item) => item.event?.type === "status.idle", 30_000);
        await request(`/api/sessions/${fixture.session}/interrupt`, "POST");
        await idle.promise;
      }
    }
    if (barrierPid) {
      try { process.kill(barrierPid, 0); failures.push({ name: "cleanup-orphan", error: `Owned barrier process ${barrierPid} survived interrupt` }); process.kill(barrierPid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") failures.push({ name: "cleanup-process-check", error: String(error) }); }
    }
    for (const cancel of pendingObservations) cancel();
    page.off("response", observeResponse);
    await Promise.all([...pendingNetwork]);
    await writeFile(path.join(evidence, "canvas-network.json"), JSON.stringify({ canvasNetwork, browserErrors }, null, 2));
    await persist();
  }
  if (failures.length) throw new Error(`${failures.length} generation rows failed; see generation-observations.json`);
}
