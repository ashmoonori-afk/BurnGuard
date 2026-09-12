import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Run with full-feature-runner.mjs --port 14221 --evidence /tmp/burnguard-runtime-settings.
// L = actual source backend. M = only the named runtime HTTP transport is simulated;
// real shipped Settings UI, native controls and query/refetch behavior remain intact.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = await readFile(path.join(root, "packages/frontend/src/i18n/messages/settings.ts"), "utf8");
// Compare rendered labels with shipped copy, not a second pinned prose specification.
const copy = vm.runInNewContext(`(${source.slice(source.indexOf("defineMessages({") + "defineMessages(".length, source.lastIndexOf(");"))})`);
const label = (key, values = {}) => copy[`settings.${key}`].en.replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
const endpoint = (name) => `/api/settings/${name}`;
const stamp = 1_800_000_000_000;
const install = (state = "idle") => ({ state, started_at: state === "idle" ? null : stamp, finished_at: ["error", "success"].includes(state) ? stamp + 1 : null, exit_code: state === "success" ? 0 : state === "error" ? 1 : null, error: state === "error" ? "QA_PRIVATE_INSTALL_ERROR" : null, tail: state === "idle" ? [] : ["QA_PRIVATE_INSTALL_LOG"] });
const python = ({ found = true, version = null, supported = false, state = "idle" } = {}) => ({ health: { python: { found, executable: found ? ["python3"] : null, version: found ? "Python 3.13.5" : null }, pypdf: { found: version !== null, version, supported, required_version: "6.18.0" }, checked_at: stamp }, install: install(state) });
const update = (overrides = {}) => ({ supported: true, unsupported_reason: null, state: "idle", current_version: "0.5.8", available_version: null, progress: null, checked_at: null, error: null, ...overrides });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

export async function run({ page, context, base, check, evidence }) {
  const requests = [], observations = [], failures = [], browserErrors = [], boundaries = [];
  const fixtures = new Map();
  const gates = new Set();
  let sequence = 0;
  let currentScenario;
  let headers;
  page.on("pageerror", (error) => browserErrors.push(String(error)));
  const report = () => writeFile(path.join(evidence, "runtime-settings-report.json"), JSON.stringify({ observations, failures, browserErrors, boundaries, requests, nativeInstalls: 0, nativeApplyOrRestart: false }, null, 2));
  const scenario = async (name, action, mode = "M-transport-fixture") => {
    currentScenario = name;
    try {
      await check(`runtime-${name}`, async () => {
        const result = await action();
        observations.push({ name, mode, result });
        await report();
        return result;
      }, mode);
    } catch (error) {
      failures.push({ name, mode, error: String(error.stack ?? error) });
      await report();
      // A failed scenario does not erase coverage of independent runtime cards.
      console.error(`[runtime-settings] ${name}: ${error.message}`);
    }
  };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const guard = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== base && !["data:", "blob:"].includes(url.protocol)) {
      requests.push({ mode: "blocked", method: request.method(), path: url.origin + url.pathname });
      return route.abort("blockedbyclient");
    }
    const fixture = fixtures.get(url.pathname);
    if (fixture) {
      const method = request.method();
      requests.push({ mode: "M", method, path: url.pathname });
      const gate = fixture.gate;
      if (gate) await gate.promise;
      if (fixture.error) return json(route, { error: { code: fixture.error, message: "QA_PRIVATE_TRANSPORT_ERROR" } }, fixture.status ?? 503);
      return json(route, { data: fixture.data }, fixture.status ?? 200);
    }
    if (request.method() !== "GET" && /^\/api\/(?:settings\/(?:python|playwright|updates)(?:\/|$)|sessions\/.*\/events$)/.test(url.pathname)) {
      requests.push({ mode: "BLOCKED_UNEXPECTED_SIDE_EFFECT", method: request.method(), path: url.pathname });
      return json(route, { error: { code: "qa_host_action_blocked", message: "Host mutation refused by runtime QA" } }, 599);
    }
    if (/^\/api\/settings\/(python|playwright|updates)$/.test(url.pathname)) requests.push({ mode: "L", method: request.method(), path: url.pathname });
    return route.continue();
  };
  const hold = (fixture) => { const gate = deferred(); gates.add(gate); fixture.gate = gate; return () => { fixture.gate = null; gate.resolve(); gates.delete(gate); }; };
  const clearFixtures = () => { for (const gate of gates) gate.resolve(); gates.clear(); fixtures.clear(); };
  const dialog = () => page.getByRole("dialog");
  const card = (name) => name === "updates" ? dialog().locator('section[aria-labelledby="settings-updates-title"]') : dialog().locator("#settings-files > div").filter({ has: page.locator("label", { hasText: label(name === "python" ? "python" : "chromium") }) });
  const action = (name) => name === "updates" ? card(name).getByRole("button", { name: label("updateCheck"), exact: true }) : card(name).getByRole("button").nth(1);
  const refresh = (name) => card(name).getByRole("button", { name: label(name === "python" ? "pythonRefresh" : "chromiumRefresh"), exact: true });
  const responseFor = (name, method = "GET") => page.waitForResponse((response) => new URL(response.url()).pathname === endpoint(name) && response.request().method() === method);
  // Subscribe to the exact DOM state before triggering the action. No test polling/sleeps.
  const arm = async (locator, expected) => {
    const id = `runtime-state-${++sequence}`;
    await locator.evaluate((node, { id, expected }) => {
      window.__runtimeQaSignals ??= new Map();
      const promise = new Promise((resolve, reject) => {
        const matches = () => (expected.text === undefined || node.textContent.trim() === expected.text) && (expected.disabled === undefined || node.disabled === expected.disabled);
        const complete = () => { if (!matches()) return; clearTimeout(timer); observer.disconnect(); resolve(); };
        const observer = new MutationObserver(complete);
        const timer = setTimeout(() => { observer.disconnect(); reject(new Error(`State ${id} not reached: ${JSON.stringify(expected)}; actual=${node.textContent}, disabled=${node.disabled}`)); }, 15_000);
        observer.observe(node, { childList: true, subtree: true, characterData: true, attributes: true });
        complete();
      });
      promise.catch(() => {}); // The test awaits and reports this same rejection below.
      window.__runtimeQaSignals.set(id, promise);
    }, { id, expected });
    return async () => page.evaluate(async (id) => { try { await window.__runtimeQaSignals.get(id); } finally { window.__runtimeQaSignals.delete(id); } }, id);
  };
  const state = async (name, key, values = {}) => {
    const expected = label(key, values);
    await (await arm(card(name).getByRole("status"), { text: expected }))();
    assert.equal((await card(name).getByRole("status").textContent()).trim(), expected);
  };
  const open = async () => {
    const loaded = ["python", "playwright", "updates"].map((name) => responseFor(name));
    await page.goto(`${base}/settings`, { waitUntil: "domcontentloaded" });
    await dialog().locator("#display-name").waitFor({ state: "visible" });
    await Promise.all(loaded);
    await dialog().getByRole("button", { name: label("files"), exact: true }).click();
  };
  const close = async () => {
    await page.screenshot({ path: path.join(evidence, `${currentScenario}-controls.png`), animations: "disabled" });
    await dialog().getByRole("button", { name: label("cancel"), exact: true }).click();
    await dialog().waitFor({ state: "hidden" });
  };
  const refreshTo = async (name, fixture, data, key, values = {}) => {
    fixture.data = data;
    const rendered = await arm(card(name).getByRole("status"), { text: label(key, values) });
    const response = responseFor(name);
    await refresh(name).click();
    assert.equal((await response).status(), 200);
    await rendered();
    await state(name, key, values);
  };
  const rawStatus = async (name) => {
    const response = await page.request.get(`${base}${endpoint(name)}`, { headers });
    assert.equal(response.status(), 200);
    return (await response.json()).data;
  };
  const pyLabel = (data) => !data.health.python.found ? ["pythonMissing"] : data.health.pypdf.found ? data.health.pypdf.supported ? ["pypdfReady", { version: ` ${data.health.pypdf.version}`, python: data.health.python.version }] : ["pypdfUnsupported", { version: data.health.pypdf.version, required: data.health.pypdf.required_version }] : ["pypdfMissing"];

  await context.addInitScript(() => localStorage.setItem("burnguard.locale", "en"));
  await context.route("**/*", guard);
  try {
    await scenario("source-status-refresh-and-update-boundary", async () => {
      await page.goto(base, { waitUntil: "domcontentloaded" });
      const bootstrap = await page.evaluate(async () => (await (await fetch("/api/bootstrap")).json()).data);
      headers = { "x-burnguard-capability": bootstrap.capability, origin: base };
      const [py, pw, updates] = await Promise.all([rawStatus("python"), rawStatus("playwright"), rawStatus("updates")]);
      assert.equal(updates.supported, false);
      assert.equal(updates.state, "unsupported");
      assert.equal(updates.unsupported_reason, process.platform === "darwin" ? "not_installed" : "platform");
      assert.ok(["idle", "success"].includes(pw.state));
      assert.equal(py.install.state, "idle");
      await open();
      await state("updates", "updateUnsupported");
      assert.equal(await action("updates").isDisabled(), true);
      assert.equal(await card("updates").getByRole("button", { name: label("updateApply"), exact: true }).count(), 0);
      await state("playwright", pw.state === "success" ? "chromiumInstalled" : "notInstalled");
      await state("python", ...pyLabel(py));
      assert.equal(await action("python").isDisabled(), !py.health.python.found);
      assert.equal(await action("playwright").isEnabled(), true);
      const refreshed = {};
      for (const name of ["python", "playwright"]) {
        const pending = responseFor(name);
        await refresh(name).click();
        const response = await pending;
        assert.equal(response.status(), 200);
        refreshed[name] = (await response.json()).data;
      }
      assert.deepEqual(refreshed.python.health.python, py.health.python);
      assert.deepEqual(refreshed.python.health.pypdf, py.health.pypdf);
      assert.equal(refreshed.playwright.state, pw.state);
      // Safe real backend negative boundary, only after supported=false was proven.
      const refused = [];
      for (const verb of ["check", "apply"]) {
        const response = await page.request.post(`${base}${endpoint(`updates/${verb}`)}`, { headers });
        assert.equal(response.status(), 409);
        assert.equal((await response.json()).error.code, "update_unsupported");
        refused.push({ method: "POST", path: endpoint(`updates/${verb}`), status: 409, code: "update_unsupported" });
      }
      boundaries.push({ mode: "L", feature: "native-update-apply-restart", evidence: updates, refused, reason: "Source process has no packaged UpdateMac. Windows shell controls are external to this web UI." });
      boundaries.push({ mode: "source-inspection", feature: "native-runtime-install", reason: "full-feature-runner isolates BG_APP_ROOT, not HOME/PYTHONUSERBASE/PLAYWRIGHT_BROWSERS_PATH. python-health uses pip --user and playwright-install inherits process.env. No install is authorized against host caches." });
      await close();
      return { python: py, chromium: pw, updates, refreshed, refused, hostInstalls: 0 };
    }, "L-live-source");

    for (const name of ["python", "playwright", "updates"]) {
      await scenario(`${name}-status-load-error-retry`, async () => {
        clearFixtures();
        const fixture = { error: "qa_runtime_status_unavailable" };
        fixtures.set(endpoint(name), fixture);
        await open();
        const errorKey = name === "python" ? "pythonFailed" : name === "playwright" ? "chromiumFailed" : "updateStatusFailed";
        const alert = card(name).getByRole("alert").filter({ hasText: label(errorKey) });
        await alert.waitFor({ state: "visible" });
        assert.equal(await action(name).isDisabled(), true);
        assert.equal((await card(name).textContent()).includes("QA_PRIVATE_TRANSPORT_ERROR"), false);
        fixture.error = null;
        fixture.data = name === "python" ? python() : name === "playwright" ? install() : update();
        const release = hold(fixture);
        const pending = responseFor(name);
        const loading = await arm(card(name).getByRole("status"), { text: label("loading") });
        await alert.getByRole("button", { name: label("retry"), exact: true }).click();
        await loading();
        assert.equal(await alert.count(), 0, "Refetch with no cached data replaces the error with loading");
        assert.equal(await action(name).isDisabled(), true);
        if (name !== "updates") assert.equal(await refresh(name).isDisabled(), true);
        release();
        assert.equal((await pending).status(), 200);
        await alert.waitFor({ state: "hidden" });
        await state(name, name === "python" ? "pypdfMissing" : name === "playwright" ? "notInstalled" : "updateIdle");
        assert.equal(await action(name).isEnabled(), true);
        await close();
        return { initialStatus: 503, nativeRetry: 200, pendingLoading: true, installOrCheckDisabledWhileLoading: true, actionRecovered: true, internalErrorHidden: true };
      });
    }

    await scenario("python-missing-unsupported-ready-and-refresh-pending", async () => {
      clearFixtures();
      const fixture = { data: python({ found: false }) };
      fixtures.set(endpoint("python"), fixture);
      await open();
      await state("python", "pythonMissing");
      assert.equal(await action("python").isDisabled(), true);
      assert.equal(await action("python").getAttribute("title"), label("pythonRequired"));
      await refreshTo("python", fixture, python({ version: "6.13.3" }), "pypdfUnsupported", { version: "6.13.3", required: "6.18.0" });
      assert.equal((await action("python").textContent()).trim(), label("pypdfUpdate"));
      assert.equal(await action("python").isEnabled(), true);
      fixture.data = python({ version: "6.18.0", supported: true });
      const release = hold(fixture);
      const response = responseFor("python");
      const refreshing = await arm(refresh("python"), { disabled: true });
      await refresh("python").click();
      await refreshing();
      assert.equal(await refresh("python").isDisabled(), true);
      release();
      assert.equal((await response).status(), 200);
      await state("python", "pypdfReady", { version: " 6.18.0", python: "Python 3.13.5" });
      assert.equal((await action("python").textContent()).trim(), label("pypdfReinstall"));
      await close();
      return { missingPythonDisabled: true, outdated: "6.13.3", required: "6.18.0", supported: "6.18.0", refreshPendingDisabled: true };
    });

    for (const name of ["python", "playwright"]) {
      await scenario(`${name}-install-error-retry-progress-success-reinstall`, async () => {
        clearFixtures();
        const statusFixture = { data: name === "python" ? python() : install() };
        const postFixture = { error: "install_in_progress", status: 409 };
        fixtures.set(endpoint(name), statusFixture);
        fixtures.set(endpoint(`${name}/install`), postFixture);
        await open();
        await state(name, name === "python" ? "pypdfMissing" : "notInstalled");
        await dialog().locator("#display-name").fill("QA_UNSAVED_RUNTIME_DRAFT");
        const startError = responseFor(`${name}/install`, "POST");
        await action(name).click();
        assert.equal((await startError).status(), 409);
        await page.getByText(label(name === "python" ? "pypdfStartFailed" : "playwrightStartFailed"), { exact: true }).waitFor({ state: "visible" });
        assert.equal(await action(name).isEnabled(), true);
        assert.equal((await page.locator("body").textContent()).includes("QA_PRIVATE_TRANSPORT_ERROR"), false);

        for (const terminal of ["error", "success"]) {
          postFixture.error = null;
          postFixture.status = 202;
          postFixture.data = name === "python" ? python({ state: "installing" }) : install("installing");
          statusFixture.data = postFixture.data;
          const releasePost = hold(postFixture);
          const releasePoll = hold(statusFixture);
          const post = responseFor(`${name}/install`, "POST");
          const nextPoll = responseFor(name);
          const installing = await arm(card(name).getByRole("status"), { text: label(name === "python" ? "pypdfInstalling" : "chromiumInstalling") });
          await action(name).click();
          assert.equal(await action(name).isDisabled(), true, "starting POST must disable duplicate install");
          releasePost();
          assert.equal((await post).status(), 202);
          await installing();
          assert.equal(await action(name).isDisabled(), true);
          assert.equal((await action(name).textContent()).trim(), label("installing"));
          statusFixture.data = name === "python" ? python({ state: terminal, ...(terminal === "success" ? { version: "6.18.0", supported: true } : {}) }) : install(terminal);
          const terminalKey = terminal === "error" ? name === "python" ? "pypdfLastFailed" : "lastInstallFailed" : name === "python" ? "pypdfReady" : "chromiumInstalled";
          const values = name === "python" && terminal === "success" ? { version: " 6.18.0", python: "Python 3.13.5" } : {};
          const done = await arm(card(name).getByRole("status"), { text: label(terminalKey, values) });
          releasePoll();
          assert.equal((await nextPoll).status(), 200);
          await done();
          assert.equal(await action(name).isEnabled(), true);
          if (terminal === "error") {
            const alert = card(name).getByRole("alert");
            assert.equal((await alert.textContent()).trim(), label(name === "python" ? "pythonInstallFailed" : "chromiumInstallFailed"));
          } else assert.equal(await card(name).getByRole("alert").count(), 0);
          assert.equal((await card(name).textContent()).includes("QA_PRIVATE_INSTALL"), false);
          assert.equal(await dialog().locator("#display-name").inputValue(), "QA_UNSAVED_RUNTIME_DRAFT");
          await page.screenshot({ path: path.join(evidence, `${name}-${terminal}.png`), animations: "disabled" });
        }
        assert.equal((await action(name).textContent()).trim(), label(name === "python" ? "pypdfReinstall" : "reinstall"));
        postFixture.data = statusFixture.data;
        const reinstalled = responseFor(`${name}/install`, "POST");
        await action(name).click();
        assert.equal((await reinstalled).status(), 202);
        await close();
        return { installPost: 202, startError: 409, duplicateStartDisabled: true, autoRefetch: ["installing", "error", "installing", "success"], retryAndReinstallClicked: true, unsavedDraftPreserved: true, nativeInstallerInvoked: false };
      });
    }

    await scenario("python-update-outdated-control", async () => {
      clearFixtures();
      fixtures.set(endpoint("python"), { data: python({ version: "6.13.3" }) });
      fixtures.set(endpoint("python/install"), { data: python({ version: "6.18.0", supported: true, state: "success" }), status: 202 });
      await open();
      await state("python", "pypdfUnsupported", { version: "6.13.3", required: "6.18.0" });
      const pending = responseFor("python/install", "POST");
      await card("python").getByRole("button", { name: label("pypdfUpdate"), exact: true }).click();
      assert.equal((await pending).status(), 202);
      await state("python", "pypdfReady", { version: " 6.18.0", python: "Python 3.13.5" });
      await close();
      return { updateControlPostedInstall: true, supportedVersion: "6.18.0", nativePip: false };
    });

    await scenario("updates-check-current-network-error-and-retry", async () => {
      clearFixtures();
      const fixture = { data: update() };
      const postFixture = { error: "update_check_failed", status: 503 };
      fixtures.set(endpoint("updates"), fixture);
      fixtures.set(endpoint("updates/check"), postFixture);
      await open();
      await state("updates", "updateIdle");
      const failed = responseFor("updates/check", "POST");
      await action("updates").click();
      assert.equal((await failed).status(), 503);
      const alert = card("updates").getByRole("alert");
      await alert.waitFor({ state: "visible" });
      assert.equal((await alert.textContent()).trim(), label("updateFailed"));
      assert.equal(await action("updates").isEnabled(), true);
      postFixture.error = null;
      postFixture.status = 200;
      postFixture.data = update({ checked_at: stamp });
      const pending = responseFor("updates/check", "POST");
      await action("updates").click();
      assert.equal((await pending).status(), 200);
      await state("updates", "updateCurrent", { version: "0.5.8" });
      assert.equal(await alert.count(), 0);
      assert.equal(await card("updates").getByRole("button", { name: label("updateApply"), exact: true }).count(), 0);
      await close();
      return { checkError: 503, retry: 200, currentVersion: "0.5.8", applyAbsent: true };
    });

    await scenario("updates-checking-download-progress-ready-apply-error-retry", async () => {
      clearFixtures();
      const fixture = { data: update() };
      const postFixture = { data: update(), status: 200 };
      const applyFixture = { error: "update_not_ready", status: 409 };
      fixtures.set(endpoint("updates"), fixture);
      fixtures.set(endpoint("updates/check"), postFixture);
      fixtures.set(endpoint("updates/apply"), applyFixture);
      await open();
      await state("updates", "updateIdle");
      fixture.data = update({ state: "checking" });
      const releasePost = hold(postFixture);
      const checked = responseFor("updates/check", "POST");
      let polled = responseFor("updates");
      const checking = await arm(card("updates").getByRole("status"), { text: label("updateChecking") });
      await action("updates").click();
      assert.equal(await action("updates").isDisabled(), true);
      assert.equal((await polled).status(), 200);
      await checking();
      const progress = [];
      for (const percent of [0, 42, 100]) {
        const rendered = await arm(card("updates").getByRole("status"), { text: label("updateDownloading", { progress: percent }) });
        polled = responseFor("updates");
        fixture.data = update({ state: "downloading", available_version: "0.5.9", progress: percent });
        assert.equal((await polled).status(), 200);
        await rendered();
        assert.equal(await action("updates").isDisabled(), true);
        assert.equal(await card("updates").getByRole("button", { name: label("updateApply"), exact: true }).count(), 0);
        progress.push(percent);
      }
      fixture.data = update({ state: "ready", available_version: "0.5.9", checked_at: stamp });
      postFixture.data = fixture.data;
      releasePost();
      assert.equal((await checked).status(), 200);
      await state("updates", "updateReady", { version: "0.5.9" });
      const apply = card("updates").getByRole("button", { name: label("updateApply"), exact: true });
      assert.equal(await apply.isEnabled(), true);
      await page.screenshot({ path: path.join(evidence, "updates-ready.png"), animations: "disabled" });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const releaseApply = hold(applyFixture);
        const applied = responseFor("updates/apply", "POST");
        const applying = await arm(card("updates").getByRole("status"), { text: label("updateApplying") });
        await apply.click();
        await applying();
        assert.equal(await apply.isDisabled(), true);
        assert.equal(await action("updates").isDisabled(), true);
        assert.equal(await dialog().getByRole("button", { name: label("cancel"), exact: true }).isDisabled(), true);
        assert.equal(await dialog().getByRole("button", { name: label("save"), exact: true }).last().isDisabled(), true);
        await page.keyboard.press("Escape");
        assert.equal(await dialog().isVisible(), true);
        releaseApply();
        assert.equal((await applied).status(), 409);
        await card("updates").getByRole("alert").waitFor({ state: "visible" });
        assert.equal((await card("updates").getByRole("alert").textContent()).trim(), label("updateScheduleFailed"));
        assert.equal(await apply.isEnabled(), true);
        assert.equal(await dialog().getByRole("button", { name: label("cancel"), exact: true }).isEnabled(), true);
      }
      await close();
      return { checking: true, progress, readyVersion: "0.5.9", applyAttempts: 2, applyResponse: 409, applyLocksDialog: true, nativeApply: false, restartBoundary: "No accepted update response or real process restart was simulated/claimed." };
    });

    await scenario("updates-backend-error-state-recheck", async () => {
      clearFixtures();
      fixtures.set(endpoint("updates"), { data: update({ state: "error", error: "package_digest_mismatch", checked_at: stamp }) });
      fixtures.set(endpoint("updates/check"), { data: update({ checked_at: stamp + 1 }), status: 200 });
      await open();
      await state("updates", "updateFailed");
      assert.equal(await action("updates").isEnabled(), true);
      const pending = responseFor("updates/check", "POST");
      await action("updates").click();
      assert.equal((await pending).status(), 200);
      await state("updates", "updateCurrent", { version: "0.5.8" });
      await close();
      return { backendError: "package_digest_mismatch", recheckRecovered: true };
    });

    await scenario("updates-windows-shell-hidden-boundary", async () => {
      clearFixtures();
      fixtures.set(endpoint("updates"), { data: update({ supported: false, state: "unsupported", unsupported_reason: "windows_shell" }) });
      await open();
      assert.equal(await card("updates").count(), 0);
      assert.equal(await dialog().getByRole("button", { name: label("updateCheck"), exact: true }).count(), 0);
      await close();
      return { windowsShellStatusFixture: true, webControlsAbsent: true, nativeWindowsShell: "External platform boundary, not executed on macOS." };
    });

    clearFixtures();
    await scenario("restored-live-source-no-host-actions", async () => {
      await open();
      await state("updates", "updateUnsupported");
      assert.equal(await action("updates").isDisabled(), true);
      assert.equal((await rawStatus("python")).install.state, "idle");
      const realStatus = await rawStatus("playwright");
      assert.equal(realStatus.started_at, null);
      assert.equal(requests.filter((request) => request.mode === "BLOCKED_UNEXPECTED_SIDE_EFFECT").length, 0);
      assert.deepEqual(browserErrors, []);
      await close();
      return { fixturesRemoved: true, sourceUpdateDisabled: true, nativePipStarted: false, nativeChromiumStarted: false, unexpectedSideEffects: 0, pageErrors: 0 };
    }, "L-live-source");
  } finally {
    clearFixtures();
    await context.unroute("**/*", guard);
    await report();
  }
  assert.equal(failures.length, 0, `${failures.length} runtime settings checks failed; see runtime-settings-report.json`);
}
