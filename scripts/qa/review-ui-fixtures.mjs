import assert from "node:assert/strict";
import { createServer } from "node:http";

const PROJECT_A = "review-ui-project-a";
const PROJECT_B = "review-ui-project-b";
const SESSION_A = "review-ui-session-a";
const SESSION_B = "review-ui-session-b";
const SYSTEM_A = "review-ui-system-a";
const SYSTEM_B = "review-ui-system-b";
const AT = 1_700_000_000_000;
const PRIVATE_ERROR = "PRIVATE_REVIEW_ERROR";
const AUTHORITY = "review-ui-fixture-authority";
const digest = "a".repeat(64);

/** Real DOM/storage/media/EventSource tests with explicitly synthetic HTTP data. */
export async function runReviewUiFixtures(page, context, base, scenario) {
  const receipts = [];
  const state = {
    bootstrapFails: false, settingsFails: false, playwrightFails: false, systemBExists: false,
    settings: settingsFixture(), snapshotSequence: 10, usage: { input: 100, output: 20, cached: 5, cache_write: 0 },
    pending: [], history: historyFixture(), stream: [], decisions: [], sent: [], snapshots: 0, streams: [],
  };
  const sse = await startSseFixture(state, base);
  const routePattern = `${base}/api/**`;
  const routeHandler = async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();
    const ok = (data) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) });
    const fail = (status, code) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: { code, message: PRIVATE_ERROR } }) });
    if (pathname === "/api/bootstrap") return state.bootstrapFails ? fail(500, "bootstrap_failed") : ok({ capability: AUTHORITY });
    if (pathname === "/api/settings") {
      if (method === "PATCH") {
        assert.equal(request.headers()["x-burnguard-capability"], AUTHORITY, "settings fixture mutation lost launch authority");
        const body = request.postDataJSON();
        if ("figma_personal_access_token" in body) state.settings.figma_token_set = body.figma_personal_access_token !== null;
        for (const key of ["user", "theme", "default_backend", "chat_abort_threshold_ms", "chat_context_mode"]) {
          if (key in body) state.settings[key] = body[key];
        }
        return ok(state.settings);
      }
      return state.settingsFails ? fail(500, "settings_read_failed") : ok(state.settings);
    }
    if (pathname === "/api/backends/detect") return ok({ backends: [
      { id: "claude-code", found: true, version: "fixture" }, { id: "codex", found: true, version: "fixture" },
    ] });
    if (pathname === "/api/settings/playwright") return state.playwrightFails ? fail(500, "playwright_status_failed") : ok(installFixture());
    if (pathname === "/api/settings/python") return ok({
      health: { python: { found: true, executable: ["fixture-python"], version: "Python fixture" }, pypdf: { found: true, version: "fixture" }, checked_at: AT },
      install: installFixture(),
    });
    if (pathname === "/api/projects") return ok([projectFixture(PROJECT_A), projectFixture(PROJECT_B)]);
    if (pathname === "/api/design-systems") {
      const status = new URL(request.url()).searchParams.get("status");
      return ok(status === "published" ? [systemFixture(SYSTEM_A)] : []);
    }
    const system = pathname.match(/^\/api\/design-systems\/([^/]+)(.*)$/);
    if (system) {
      const [, id, suffix] = system;
      if (id === SYSTEM_B && !state.systemBExists) return fail(404, "design_system_not_found");
      if (!suffix) return ok(systemFixture(id));
      if (suffix === "/tokens") return ok({ system_id: id, colors: [], token_file_path: null });
      if (suffix === "/previews") return ok([]);
      return fail(404, "design_system_file_not_found");
    }
    const project = pathname.match(/^\/api\/projects\/([^/]+)(.*)$/);
    if (project) {
      const [, id, suffix] = project;
      const sessionId = id === PROJECT_B ? SESSION_B : SESSION_A;
      if (!suffix) return ok(projectFixture(id));
      if (suffix === "/session") return ok(sessionFixture(sessionId, id, state.usage));
      if (suffix === "/artifacts") return ok({ project_id: id, entrypoint: "", entrypoint_url: null, design_system_id: SYSTEM_A, design_system_url: null, file_count: 0, current_revision: 0, current_digest: digest, updated_at: AT });
      if (["/files", "/comments", "/exports"].includes(suffix)) return ok([]);
      if (["/design-directions", "/design-audit"].includes(suffix)) return ok(null);
      return fail(404, "fixture_project_route_missing");
    }
    const session = pathname.match(/^\/api\/sessions\/([^/]+)(.*)$/);
    if (session) {
      const [, id, suffix] = session;
      const projectId = id === SESSION_B ? PROJECT_B : PROJECT_A;
      if (suffix === "/snapshot") {
        state.snapshots += 1;
        return ok({ session: sessionFixture(id, projectId, state.usage), sequence: state.snapshotSequence, pending_permissions: id === SESSION_A ? state.pending : [] });
      }
      if (suffix === "/events" && method === "GET") return ok(id === SESSION_A ? state.history : []);
      if (suffix === "/stream") {
        // A fulfilled finite body closes EventSource and disables the composer.
        // Continue the actual browser request to an owned, open SSE response.
        const original = new URL(request.url());
        return route.continue({ url: `${sse.base}${original.pathname}${original.search}` });
      }
      if (suffix === "/tool-decision" && method === "POST") {
        const body = request.postDataJSON();
        state.decisions.push({ sessionId: id, body, authority: request.headers()["x-burnguard-capability"] });
        state.pending = [];
        state.snapshotSequence += 1;
        state.history.push(envelope(state.snapshotSequence, { type: "tool.permission_decided", toolCallId: body.toolCallId, decision: body.decision }));
        return ok({ accepted: true, decision: body.decision });
      }
      if (suffix === "/events" && method === "POST") {
        const contentType = request.headers()["content-type"] ?? "";
        if (contentType.startsWith("multipart/form-data")) {
          const form = await new Response(request.postDataBuffer(), { headers: { "content-type": contentType } }).formData();
          const files = await Promise.all(form.getAll("files").map(async (file) => ({ name: file.name, bytes: await file.text() })));
          state.sent.push({ sessionId: id, text: form.get("text"), visualSources: JSON.parse(String(form.get("visual_sources"))), files });
        } else state.sent.push({ sessionId: id, ...request.postDataJSON() });
        return ok({ accepted: true });
      }
      return fail(404, "fixture_session_route_missing");
    }
    return fail(404, "fixture_route_missing");
  };
  const run = async (name, callback) => {
    const check = async () => {
      await callback();
      receipts.push({ name, ok: true, evidence: "real-browser-with-synthetic-api" });
    };
    if (scenario) await scenario(name, check);
    else await check();
  };
  const openHome = async () => {
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "최근", exact: true }).waitFor();
  };
  const openSettings = async () => {
    await page.getByRole("button", { name: "설정", exact: true }).click();
    return page.getByRole("dialog", { name: "설정", exact: true });
  };
  const openProject = async (id = PROJECT_A) => {
    await page.goto(`${base}/projects/${id}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: "메시지 입력", exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('textarea[aria-label="메시지 입력"]')?.disabled);
  };

  let routeRegistered = false;
  try {
    await page.route(routePattern, routeHandler);
    routeRegistered = true;
    await run("review-R32-bootstrap-failure-retry", async () => {
      state.bootstrapFails = true;
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "다시 연결", exact: true }).waitFor();
      assert.equal(await page.getByRole("tab", { name: "최근", exact: true }).count(), 0);
      assert.equal((await page.locator("body").innerText()).includes(PRIVATE_ERROR), false);
      state.bootstrapFails = false;
      await page.getByRole("button", { name: "다시 연결", exact: true }).click();
      await page.getByRole("tab", { name: "최근", exact: true }).waitFor();
    });

    await run("review-R28-R29-settings-draft-and-partial-failure", async () => {
      state.bootstrapFails = false;
      state.settingsFails = true;
      state.playwrightFails = true;
      await openHome();
      const dialog = await openSettings();
      await dialog.getByText("설정을 불러오지 못했어요", { exact: true }).waitFor();
      state.settingsFails = false;
      await dialog.getByRole("button", { name: "다시 시도", exact: true }).click();
      await dialog.getByLabel("표시 이름", { exact: true }).waitFor();
      await dialog.getByText("Chromium 상태 조회 실패", { exact: true }).waitFor();
      await dialog.getByLabel("표시 이름", { exact: true }).fill("검토 초안 이름");
      await dialog.getByLabel("Figma 연동", { exact: true }).fill("fixture-token-value");
      await dialog.getByRole("button", { name: "저장", exact: true }).first().click();
      await dialog.getByRole("button", { name: "연결 해제", exact: true }).waitFor();
      assert.equal(await dialog.getByLabel("표시 이름", { exact: true }).inputValue(), "검토 초안 이름");
      await dialog.getByRole("button", { name: "연결 해제", exact: true }).click();
      await dialog.getByLabel("Figma 연동", { exact: true }).waitFor();
      assert.equal(await dialog.getByLabel("표시 이름", { exact: true }).inputValue(), "검토 초안 이름");
      assert.equal((await dialog.innerText()).includes(PRIVATE_ERROR), false);
      state.playwrightFails = false;
      await dialog.getByRole("button", { name: "Chromium 상태 다시 확인", exact: true }).click();
      await dialog.getByText("Chromium 설치를 마쳤어요.", { exact: true }).waitFor();
      await dialog.getByRole("button", { name: "저장", exact: true }).last().click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(state.settings.user.display_name, "검토 초안 이름");
    });

    await run("review-R30-system-route-404-and-retry", async () => {
      state.settingsFails = false;
      state.playwrightFails = false;
      state.systemBExists = false;
      await page.goto(`${base}/systems/${SYSTEM_A}`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "검토 시스템 A", exact: true }).waitFor();
      await page.evaluate((target) => { history.pushState({}, "", target); dispatchEvent(new PopStateEvent("popstate")); }, `/systems/${SYSTEM_B}`);
      await page.getByRole("heading", { name: "디자인 시스템을 찾을 수 없어요", exact: true }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "검토 시스템 A", exact: true }).count(), 0);
      state.systemBExists = true;
      await page.getByRole("button", { name: "다시 시도", exact: true }).click();
      await page.getByRole("heading", { name: "검토 시스템 B", exact: true }).waitFor();
      assert.equal((await page.locator("body").innerText()).includes(PRIVATE_ERROR), false);
    });

    await run("review-R21-R22-session-snapshot-replay-deduplication", async () => {
      const increment = envelope(11, { type: "usage.delta", input: 7, output: 3, cached: 2 });
      state.stream = [increment, increment, envelope(12, { type: "chat.delta", text: "실시간 복구 확인" }), envelope(13, { type: "chat.message_end" })];
      await openProject();
      await page.getByText("실시간 복구 확인", { exact: true }).waitFor();
      await waitUsage(page, 107, 23, 7);
      assert.equal(await page.getByRole("dialog", { name: "이 도구 실행을 허용할까요?", exact: true }).count(), 0, "historical resolved permission reopened");
      assert.ok(state.streams.some((item) => item.sessionId === SESSION_A && item.after === 10), "stream did not resume from snapshot/history cursor");
      state.history.push(increment, envelope(12, { type: "chat.delta", text: "실시간 복구 확인" }), envelope(13, { type: "chat.message_end" }));
      state.snapshotSequence = 13;
      state.usage = { input: 107, output: 23, cached: 7, cache_write: 0 };
      state.stream = [increment];
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitUsage(page, 107, 23, 7);
      assert.equal(await page.getByRole("dialog", { name: "이 도구 실행을 허용할까요?", exact: true }).count(), 0);
    });

    await run("review-R08-R22-current-permission-session-authority", async () => {
      state.stream = [];
      state.history = historyFixture();
      state.snapshotSequence = 13;
      state.usage = { input: 107, output: 23, cached: 7, cache_write: 0 };
      for (const decision of ["allow", "deny"]) {
        const toolCallId = `review-current-${decision}`;
        state.snapshotSequence += 1;
        const pending = envelope(state.snapshotSequence, { type: "tool.permission_required", toolCallId, tool: "FixtureTool", input: { action: "local fixture" } });
        state.history.push(pending);
        state.pending = [pending.event];
        await page.goto(`${base}/projects/${PROJECT_A}`, { waitUntil: "domcontentloaded" });
        const dialog = page.getByRole("dialog", { name: "이 도구 실행을 허용할까요?", exact: true });
        await dialog.getByText(toolCallId, { exact: true }).waitFor();
        await dialog.getByRole("button", { name: decision === "allow" ? "허용" : "거부하고 중단", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        const recorded = state.decisions.at(-1);
        assert.equal(recorded.sessionId, SESSION_A);
        assert.notEqual(recorded.sessionId, PROJECT_A);
        assert.deepEqual(recorded.body, { toolCallId, decision });
        assert.equal(recorded.authority, AUTHORITY);
        await page.reload({ waitUntil: "domcontentloaded" });
        await waitUsage(page, 107, 23, 7);
        assert.equal(await page.getByRole("dialog", { name: "이 도구 실행을 허용할까요?", exact: true }).count(), 0);
      }
    });

    await run("review-R23-indexeddb-draft-files-roles-tab-and-reload", async () => {
      state.pending = [];
      state.stream = [];
      state.snapshotSequence = 10;
      state.history = historyFixture();
      await openProject();
      const draftText = "탭 전환과 새로고침 뒤에도 남아야 하는 초안";
      const fileName = "review-reference.pdf";
      const fileBytes = "%PDF-1.4\nREVIEW_FIXTURE_PDF_BYTES\n%%EOF";
      await page.getByRole("textbox", { name: "메시지 입력", exact: true }).fill(draftText);
      await page.getByLabel("자료 파일 선택 (PDF, PPTX)", { exact: true }).setInputFiles({ name: fileName, mimeType: "application/pdf", buffer: Buffer.from(fileBytes) });
      await page.getByRole("combobox", { name: `${fileName} 역할`, exact: true }).selectOption("immutable_reference");
      await waitDraft(page, SESSION_A, draftText, fileName, "immutable_reference");
      await page.getByRole("button", { name: "코멘트", exact: true }).click();
      await page.getByRole("textbox", { name: "메시지 입력", exact: true }).waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "채팅", exact: true }).click();
      assert.equal(await page.getByRole("textbox", { name: "메시지 입력", exact: true }).inputValue(), draftText);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("combobox", { name: `${fileName} 역할`, exact: true }).waitFor();
      assert.equal(await page.getByRole("textbox", { name: "메시지 입력", exact: true }).inputValue(), draftText);
      assert.equal(await page.getByRole("combobox", { name: `${fileName} 역할`, exact: true }).inputValue(), "immutable_reference");
      await openProject(PROJECT_B);
      assert.equal(await page.getByRole("textbox", { name: "메시지 입력", exact: true }).inputValue(), "");
      assert.equal(await page.getByRole("combobox", { name: `${fileName} 역할`, exact: true }).count(), 0);
      await openProject();
      await page.getByRole("combobox", { name: `${fileName} 역할`, exact: true }).waitFor();
      await page.getByRole("textbox", { name: "메시지 입력", exact: true }).press("Control+Enter");
      await page.waitForFunction(() => document.querySelector('textarea[aria-label="메시지 입력"]')?.value === "");
      const sent = state.sent.at(-1);
      assert.equal(sent.sessionId, SESSION_A);
      assert.equal(sent.text, draftText);
      assert.equal(sent.visualSources.sources[0].role, "immutable_reference");
      assert.deepEqual(sent.files, [{ name: fileName, bytes: fileBytes }]);
      await waitDraft(page, SESSION_A, "", null, null);
    });

    await run("review-R33-theme-save-reload-and-system-change", async () => {
      await page.emulateMedia({ colorScheme: "light" });
      await openHome();
      let dialog = await openSettings();
      await dialog.getByRole("button", { name: "어둡게", exact: true }).click();
      await dialog.getByRole("button", { name: "저장", exact: true }).last().click();
      await dialog.waitFor({ state: "hidden" });
      await waitTheme(page, "dark");
      assert.equal(state.settings.theme, "dark");
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitTheme(page, "dark");
      await page.getByRole("tab", { name: "최근", exact: true }).waitFor();
      dialog = await openSettings();
      await dialog.getByRole("button", { name: "시스템 설정", exact: true }).click();
      await dialog.getByRole("button", { name: "저장", exact: true }).last().click();
      await dialog.waitFor({ state: "hidden" });
      await waitTheme(page, "light");
      assert.equal(state.settings.theme, "auto");
      await page.emulateMedia({ colorScheme: "dark" });
      await waitTheme(page, "dark");
      await page.emulateMedia({ colorScheme: "light" });
      await waitTheme(page, "light");
    });
  } finally {
    await page.goto("about:blank").catch(() => {});
    try {
      if (routeRegistered) await page.unroute(routePattern, routeHandler);
      await page.emulateMedia({ colorScheme: null });
    } finally { await sse.close(); }
  }
  return receipts;
}

async function startSseFixture(state, base) {
  const sockets = new Set();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/stream$/);
    if (!match || request.method !== "GET") { response.writeHead(404); response.end(); return; }
    const id = match[1];
    state.streams.push({ sessionId: id, after: Number(url.searchParams.get("after_sequence")) });
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": new URL(base).origin,
      "Access-Control-Allow-Credentials": "true",
    });
    response.flushHeaders();
    response.write(": review fixture connected\n\n");
    for (const frame of id === SESSION_A ? state.stream : []) {
      response.write(`id: ${frame.sequence}\ndata: ${JSON.stringify(frame)}\n\n`);
    }
    // Keep this response open until page navigation or final cleanup closes it.
    // No timer, fake EventSource, or premature EOF changes the UI connection state.
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    server.close();
    throw error;
  }
  const address = server.address();
  assert.ok(address && typeof address !== "string", "SSE fixture did not bind a loopback port");
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function settingsFixture() {
  return { user: { id: "local", display_name: "검토 사용자" }, app_version: "fixture", default_backend: "claude-code", theme: "light", chat_abort_threshold_ms: 300_000, chat_context_mode: "compact", figma_token_set: false };
}
function installFixture() { return { state: "success", started_at: null, finished_at: AT, exit_code: 0, error: null, tail: [] }; }
function projectFixture(id) {
  return { id, name: id === PROJECT_B ? "검토 프로젝트 B" : "검토 프로젝트 A", type: "prototype", design_system_id: SYSTEM_A, design_system_name: "검토 시스템 A", thumbnail_path: null, updated_at: AT, archived_at: null, dir_path: "fixture-project", entrypoint: "", backend_id: "claude-code", options_json: null, current_revision: 0, current_digest: digest };
}
function sessionFixture(id, projectId, usage) { return { id, project_id: projectId, backend_id: "claude-code", status: "idle", usage, updated_at: AT, last_active_at: AT }; }
function systemFixture(id) {
  return { id, name: id === SYSTEM_B ? "검토 시스템 B" : "검토 시스템 A", description: "브라우저 검증용 자료", status: "published", source_type: "manual", source_uri: null, dir_path: "fixture-system", skill_md_path: null, tokens_css_path: null, readme_md_path: null, archived_at: null, is_template: false, thumbnail_path: null, kind: "design-system", owner: "local", lifecycle: "active", provenance: "observed", license: "unknown", tags: [], metadata_revision: 1, content: { revision: 1, receipt_id: null, digest }, lineage: null, preview: null, usage: [], warning: null, created_at: AT, updated_at: AT };
}
function envelope(sequence, event) { return { sequence, event: { id: `review-event-${sequence}`, ts: AT + sequence, turnId: "review-turn", ...event } }; }
function historyFixture() {
  return [
    envelope(1, { type: "usage.delta", input: 100, output: 20, cached: 5 }),
    envelope(2, { type: "tool.permission_required", toolCallId: "review-already-resolved", tool: "OldFixtureTool", input: {} }),
    envelope(3, { type: "tool.permission_decided", toolCallId: "review-already-resolved", decision: "allow" }),
    envelope(10, { type: "status.idle", stopReason: "end_turn" }),
  ];
}
async function waitTheme(page, theme) {
  await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, theme);
}
async function waitUsage(page, input, output, cached) {
  await page.waitForFunction(({ input, output, cached }) => document.querySelector('[data-qa="usage-footer"]')?.getAttribute("title") === `입력 ${input.toLocaleString()} · 출력 ${output.toLocaleString()} · 캐시 ${cached.toLocaleString()} 토큰`, { input, output, cached });
}
async function waitDraft(page, sessionId, text, fileName, role) {
  await page.waitForFunction(async ({ sessionId, text, fileName, role }) => {
    const request = indexedDB.open("burnguard-composer", 1);
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const read = db.transaction("drafts").objectStore("drafts").get(sessionId);
      const value = await new Promise((resolve, reject) => { read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error); });
      if (!text && !fileName) return value === undefined;
      return value?.text === text && value.items?.length === 1 && value.items[0].file?.name === fileName && value.items[0].role === role;
    } finally { db.close(); }
  }, { sessionId, text, fileName, role });
}
