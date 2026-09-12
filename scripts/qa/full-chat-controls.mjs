import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

// Run: node scripts/qa/full-feature-runner.mjs --module scripts/qa/full-chat-controls.mjs --port 14220 --evidence /tmp/burnguard-chat-controls
// M = synthetic session/project HTTP + real open SSE transport, real built frontend,
// and native browser input. No provider is invoked. This does not prove model output
// or checkpoint filesystem rollback (the latter is only a UI transport assertion).
const MODE = "M";
const PROJECT = "m-chat-controls-owned-project";
const SESSION = "m-chat-controls-owned-session";
const SYSTEM = "m-chat-controls-owned-system";
const AUTHORITY = "m-chat-controls-authority";
const AT = 1_700_000_000_000;
const DIGEST = "a".repeat(64);
const THOUGHT = "M_THOUGHT_BEGIN\nInspect the local fixture only.\nM_THOUGHT_END";
const MARKDOWN = '# M_MARKDOWN_HEADING\n\n**M_BOLD** and `M_INLINE_CODE`\n\n- M_LIST_ITEM\n\n```javascript\nconst M_CODE = "<safe>";\nconsole.log(M_CODE);\n```\n\n[M_LINK](https://example.invalid/m-chat)\n\n<script>window.M_CHAT_EXECUTED = true</script>\n<img src=x onerror="window.M_CHAT_EXECUTED=true">';

export async function run({ page, base, home, check, shot, evidence }) {
  const state = { history: [], sequence: 0, streams: [], responses: new Set(), mutations: [], unexpected: [], browserErrors: [], failures: [], observations: [], restores: [], revision: 0, pendingRestore: null };
  const session = () => ({ id: SESSION, project_id: PROJECT, backend_id: "claude-code", status: "idle", usage: { input: 0, output: 0, cached: 0, cache_write: 0 }, updated_at: AT, last_active_at: AT });
  const envelope = (event) => ({ sequence: ++state.sequence, event: { id: `m-chat-event-${state.sequence}`, ts: AT + state.sequence, ...event } });
  const add = (event) => { const frame = envelope(event); state.history.push(frame); return frame; };
  const emit = (...events) => {
    assert.ok(state.responses.size > 0, "No actual open EventSource response");
    for (const event of events) {
      const frame = add(event);
      for (const response of state.responses) response.write(`id: ${frame.sequence}\ndata: ${JSON.stringify(frame)}\n\n`);
    }
  };
  add({ type: "chat.user_message", text: "M_USER_REQUEST", turnId: "m-chat-turn-1", attachmentCount: 2 });
  add({ type: "chat.delta", text: MARKDOWN.slice(0, 70), turnId: "m-chat-turn-1" });
  add({ type: "chat.delta", text: MARKDOWN.slice(70), turnId: "m-chat-turn-1" });
  add({ type: "chat.message_end", turnId: "m-chat-turn-1" });
  add({ type: "chat.thinking", text: THOUGHT, turnId: "m-chat-turn-1" });
  add({ type: "status.idle", stopReason: "end_turn", turnId: "m-chat-turn-1" });
  const sse = await startSse(state, base);
  const report = async () => writeFile(path.join(evidence, "chat-controls-report.json"), JSON.stringify({
    mode: MODE, explanation: "All provider/session/project data are explicitly synthetic M. Browser DOM, EventSource and input are real; no paid turns.",
    observations: state.observations, failures: state.failures, streams: state.streams, mutations: state.mutations,
    unexpectedRequests: state.unexpected, browserErrors: state.browserErrors,
    resources: { profile: home, project: PROJECT, session: SESSION, projectStorage: "M HTTP state only", cleanup: "SSE sockets and routes closed by module; isolated Chrome/backend/profile removed by runner" },
    boundaries: ["Markdown/code syntax is displayed literally; no markdown/code-copy control is implemented in AgentMessage.tsx.", "FileRefCard is not mounted by MessageStream; file.changed intentionally does not create transcript navigation.", "Restore validates UI confirmation, request identity and refresh only, not real disk rollback."],
  }, null, 2));
  const scenario = async (name, action) => {
    try {
      await check(`chat-controls-${name}`, async () => { const result = await action(); state.observations.push({ name, result }); await report(); return result; }, MODE);
    } catch (error) {
      state.failures.push({ name, error: String(error.stack ?? error) });
      await report();
      console.error(`[chat-controls] ${name}: ${error.message}`);
    }
  };
  const routeHandler = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const method = request.method();
    const ok = (data) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) });
    const fail = () => route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ error: { code: "m_unexpected_request", message: "M QA blocked unimplemented transport" } }) });
    if (url.origin !== base) { state.unexpected.push({ method, url: request.url() }); return route.abort("blockedbyclient"); }
    if (!pathname.startsWith("/api/")) return route.continue();
    if (method !== "GET") state.mutations.push({ method, pathname, body: request.postData(), authority: request.headers()["x-burnguard-capability"] });
    if (pathname === "/api/bootstrap") return ok({ capability: AUTHORITY });
    if (pathname === "/api/settings") return ok({ user: { id: "local", display_name: "M chat QA" }, app_version: "M", default_backend: "claude-code", theme: "light", chat_abort_threshold_ms: 300_000, chat_context_mode: "compact", figma_token_set: false });
    if (pathname === "/api/backends/detect") return ok({ backends: [{ id: "claude-code", found: true, version: "M" }, { id: "codex", found: true, version: "M" }] });
    const project = { id: PROJECT, name: "M Chat Controls", type: "prototype", design_system_id: SYSTEM, design_system_name: "M Chat System", thumbnail_path: null, updated_at: AT, archived_at: null, dir_path: "M-memory-only", entrypoint: "", backend_id: "claude-code", options_json: null, current_revision: state.revision, current_digest: DIGEST };
    if (pathname === "/api/projects") return ok([project]);
    const system = { id: SYSTEM, name: "M Chat System", description: "M transport fixture", status: "published", source_type: "manual", source_uri: null, dir_path: "M-memory-only", skill_md_path: null, tokens_css_path: null, readme_md_path: null, archived_at: null, is_template: false, thumbnail_path: null, kind: "design-system", owner: "local", lifecycle: "active", provenance: "observed", license: "unknown", tags: [], metadata_revision: 1, content: { revision: 1, receipt_id: null, digest: DIGEST }, lineage: null, preview: null, usage: [], warning: null, created_at: AT, updated_at: AT };
    if (pathname === "/api/design-systems") return ok([system]);
    if (pathname === `/api/design-systems/${SYSTEM}`) return ok(system);
    if (pathname === `/api/design-systems/${SYSTEM}/tokens`) return ok({ system_id: SYSTEM, colors: [], token_file_path: null });
    if (pathname === `/api/design-systems/${SYSTEM}/previews`) return ok([]);
    if (pathname === `/api/design-systems/${SYSTEM}/files/uploads/extraction-report.json`) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "design_system_file_not_found", message: "M manual system has no extraction report" } }) });
    if (pathname === `/api/projects/${PROJECT}`) return ok(project);
    if (pathname === `/api/projects/${PROJECT}/session`) return ok(session());
    if (pathname === `/api/projects/${PROJECT}/artifacts`) return ok({ project_id: PROJECT, entrypoint: "", entrypoint_url: null, pages: [], site_overflow: false, design_system_id: SYSTEM, design_system_url: null, file_count: 0, current_revision: state.revision, current_digest: DIGEST, updated_at: AT });
    if (["files", "comments", "exports"].some((suffix) => pathname === `/api/projects/${PROJECT}/${suffix}`)) return ok([]);
    if (["design-directions", "design-audit"].some((suffix) => pathname === `/api/projects/${PROJECT}/${suffix}`)) return ok(null);
    if (pathname === `/api/sessions/${SESSION}/snapshot`) return ok({ session: session(), sequence: state.sequence, pending_permissions: [] });
    if (pathname === `/api/sessions/${SESSION}/events` && method === "GET") return ok(state.history);
    if (pathname === `/api/sessions/${SESSION}/stream` && method === "GET") return route.continue({ url: `${sse.base}${pathname}${url.search}` });
    if (pathname === `/api/projects/${PROJECT}/checkpoints/m-chat-turn-1/restore` && method === "POST") {
      assert.equal(request.headers()["x-burnguard-capability"], AUTHORITY);
      assert.deepEqual(request.postDataJSON(), { expected_revision: state.revision, expected_artifact_digest: DIGEST });
      state.restores.push(request.postDataJSON());
      assert.ok(state.pendingRestore, "Unarmed M restore request");
      await state.pendingRestore.promise;
      const previous = state.revision++;
      return ok({ operation_id: "m-chat-restore", status: "committed", base_revision: previous, base_digest: DIGEST, result_revision: state.revision, result_digest: DIGEST, diff: [] });
    }
    state.unexpected.push({ method, pathname });
    return fail();
  };
  const stream = () => page.locator(".chat-scroll");
  const composer = () => page.getByRole("textbox", { name: "Message input", exact: true });
  const jump = () => page.getByRole("button", { name: "New message", exact: true });
  const thinking = () => page.getByRole("button", { name: "Thinking", exact: true });
  const open = async () => {
    await page.goto(`${base}/projects/${PROJECT}`, { waitUntil: "domcontentloaded" });
    await composer().waitFor();
    await observe(page, { kind: "enabled" });
  };
  const scrollUp = async () => {
    await stream().hover();
    const signal = await arm(page, { kind: "scrollend", position: "away" });
    await page.mouse.wheel(0, -12000);
    return wait(page, signal);
  };
  page.on("pageerror", (error) => state.browserErrors.push(String(error)));
  await page.addInitScript((origin) => { if (location.origin === origin) localStorage.setItem("burnguard.locale", "en"); }, base);
  await page.route("**/*", routeHandler);
  try {
    await scenario("inspect-literal-markdown-and-code", async () => {
      await open();
      const message = stream().locator("div").filter({ hasText: "M_MARKDOWN_HEADING" }).first();
      assert.equal(await message.textContent(), MARKDOWN, "SSE history chunks must retain all text in order");
      assert.equal(await stream().locator("pre, code, h1, strong, a, script, img").count(), 0, "Current literal renderer must not interpret markup or execute HTML");
      assert.equal(await page.evaluate(() => window.M_CHAT_EXECUTED), undefined);
      assert.equal(await stream().getByRole("button", { name: /copy/i }).count(), 0);
      assert.equal(await stream().getByText("2 attachments", { exact: true }).count(), 1);
      const style = await message.evaluate((node) => ({ whiteSpace: getComputedStyle(node).whiteSpace, overflowWrap: getComputedStyle(node).overflowWrap }));
      assert.equal(style.whiteSpace, "pre-wrap");
      assert.equal(style.overflowWrap, "break-word");
      return { textPreserved: true, chunksMerged: 2, literalHtmlSafe: true, markdownRendering: "not implemented", codeCopy: "not implemented", style };
    });
    await scenario("thinking-pointer-keyboard-and-tabs", async () => {
      assert.equal(await stream().getByText(THOUGHT, { exact: true }).count(), 0);
      await thinking().click();
      await stream().getByText(THOUGHT, { exact: true }).waitFor();
      await stream().getByText(THOUGHT, { exact: true }).scrollIntoViewIfNeeded();
      await shot("chat-controls-thinking-expanded");
      await thinking().press("Enter");
      await stream().getByText(THOUGHT, { exact: true }).waitFor({ state: "hidden" });
      await thinking().press("Space");
      await stream().getByText(THOUGHT, { exact: true }).waitFor();
      const pane = page.getByRole("complementary", { name: "AI chat and comments", exact: true });
      await pane.getByRole("button", { name: "Comments", exact: true }).click();
      await composer().waitFor({ state: "hidden" });
      assert.equal(await pane.getByRole("button", { name: "Comments", exact: true }).getAttribute("aria-pressed"), "true");
      await pane.getByRole("button", { name: "Chat", exact: true }).click();
      await stream().getByText(THOUGHT, { exact: true }).waitFor();
      assert.equal(await pane.getByRole("button", { name: "Chat", exact: true }).getAttribute("aria-pressed"), "true");
      await thinking().click();
      await stream().getByText(THOUGHT, { exact: true }).waitFor({ state: "hidden" });
      return { pointerToggle: true, enterAndSpaceToggle: true, disclosureStatePreservedAcrossTabs: true };
    });
    await scenario("thinking-accessible-disclosure-state", async () => {
      assert.equal(await thinking().getAttribute("aria-expanded"), "false", "Thinking disclosure must expose its collapsed state to assistive technology");
      await thinking().click();
      assert.equal(await thinking().getAttribute("aria-expanded"), "true");
      const id = await thinking().getAttribute("aria-controls");
      assert.ok(id, "Thinking disclosure must identify its controlled panel");
      assert.equal(await page.locator(`[id=${JSON.stringify(id)}]`).textContent(), THOUGHT);
      await thinking().click();
      return { expandedStateAndPanelRelationship: true };
    });
    await scenario("sticky-stream-scroll-away-and-jump", async () => {
      const chunks = Array.from({ length: 32 }, (_, index) => ({ type: "chat.delta", text: `M_LONG_${index.toString().padStart(2, "0")}\nLine one\nLine two\n\n` }));
      const ready = await arm(page, { kind: "bottom", text: "M_LONG_31" });
      emit(...chunks, { type: "chat.message_end" });
      await wait(page, ready);
      assert.equal(await jump().count(), 0);
      const before = await scrollUp();
      assert.ok(before.distance > 80);
      assert.equal(await jump().count(), 0, "Current UI reveals jump on new events, not merely on scroll-away");
      const incoming = await arm(page, { kind: "jump", text: "M_NEW_WHILE_AWAY" });
      emit({ type: "chat.delta", text: "M_NEW_WHILE_AWAY\nNew synthetic message\n" }, { type: "chat.message_end" });
      const away = await wait(page, incoming);
      assert.ok(Math.abs(away.top - before.top) < 2, "Incoming output must not steal the reader's scroll position");
      assert.equal(await jump().getAttribute("title"), "Jump to latest");
      await shot("chat-controls-new-message-while-away");
      const jumped = await arm(page, { kind: "bottom", text: "M_NEW_WHILE_AWAY" });
      await jump().click();
      await wait(page, jumped);
      await jump().waitFor({ state: "hidden" });
      const following = await arm(page, { kind: "bottom", text: "M_FOLLOW_AFTER_JUMP" });
      emit({ type: "chat.delta", text: "M_FOLLOW_AFTER_JUMP\nContinuation\n" }, { type: "chat.message_end" });
      await wait(page, following);
      return { stickyBottom: true, scrollAwayPreserved: true, clickJump: true, followingRestored: true, before, away };
    });
    await scenario("manual-return-and-keyboard-jump", async () => {
      await scrollUp();
      const incoming = await arm(page, { kind: "jump", text: "M_MANUAL_RETURN" });
      emit({ type: "chat.delta", text: "M_MANUAL_RETURN\n" }, { type: "chat.message_end" });
      await wait(page, incoming);
      await stream().hover();
      const bottom = await arm(page, { kind: "scrollend", position: "bottom" });
      await page.mouse.wheel(0, 30000);
      await wait(page, bottom);
      await jump().waitFor({ state: "hidden" });
      const following = await arm(page, { kind: "bottom", text: "M_MANUAL_FOLLOW" });
      emit({ type: "chat.delta", text: "M_MANUAL_FOLLOW\n" }, { type: "chat.message_end" });
      await wait(page, following);
      await scrollUp();
      const again = await arm(page, { kind: "jump", text: "M_KEYBOARD_JUMP" });
      emit({ type: "chat.delta", text: "M_KEYBOARD_JUMP\n" }, { type: "chat.message_end" });
      await wait(page, again);
      const keyed = await arm(page, { kind: "bottom", text: "M_KEYBOARD_JUMP" });
      await jump().press("Enter");
      await wait(page, keyed);
      await jump().waitFor({ state: "hidden" });
      return { manualReturnRestoresFollowing: true, keyboardJump: true };
    });
    await scenario("recoverable-error-focuses-composer-without-turn", async () => {
      const ready = await arm(page, { kind: "text", text: "Go to message input" });
      emit({ type: "status.error", code: "turn_failed", message: "M_PRIVATE_PROVIDER_ERROR", recoverable: true });
      await wait(page, ready);
      assert.equal((await stream().innerText()).includes("M_PRIVATE_PROVIDER_ERROR"), false);
      await page.getByRole("button", { name: "Go to message input", exact: true }).click();
      assert.equal(await composer().evaluate((node) => node === document.activeElement), true);
      assert.equal(state.mutations.length, 0, "Navigation must not submit any provider turn");
      return { composerFocused: true, providerErrorRedacted: true, submittedTurns: 0 };
    });
    await scenario("turn-restore-cancel-confirm-pending-refresh", async () => {
      const revert = page.getByRole("button", { name: "Revert this turn", exact: true });
      const cancelled = page.waitForEvent("dialog").then(async (dialog) => { assert.equal(dialog.type(), "confirm"); await dialog.dismiss(); });
      await revert.click();
      await cancelled;
      assert.equal(state.restores.length, 0);
      assert.equal(state.mutations.length, 0);
      let release;
      state.pendingRestore = { promise: new Promise((resolve) => { release = resolve; }) };
      const accepted = page.waitForEvent("dialog").then(async (dialog) => { assert.equal(dialog.type(), "confirm"); await dialog.accept(); });
      const response = page.waitForResponse((res) => new URL(res.url()).pathname.endsWith("/checkpoints/m-chat-turn-1/restore") && res.request().method() === "POST");
      response.catch(() => {});
      try {
        await revert.click();
        await accepted;
        const pending = page.getByRole("button", { name: "Reverting…", exact: true });
        await pending.waitFor();
        assert.equal(await pending.isDisabled(), true);
        const refreshed = page.waitForResponse((res) => new URL(res.url()).pathname === `/api/projects/${PROJECT}/artifacts`);
        release();
        assert.equal((await response).status(), 200);
        assert.equal((await refreshed).status(), 200);
        await page.getByText("The previous turn was restored", { exact: true }).waitFor();
        await revert.waitFor();
        assert.equal(await revert.isEnabled(), true);
        assert.equal(state.restores.length, 1);
        assert.equal(state.mutations.length, 1);
      } finally { release(); state.pendingRestore = null; }
      return { cancelWrites: 0, confirmWrites: 1, disabledWhilePending: true, artifactRefreshed: true, transportOnly: true };
    });
    await scenario("reload-replays-once-and-starts-at-latest", async () => {
      await open();
      await observe(page, { kind: "bottom", text: "M_KEYBOARD_JUMP" });
      // User bubble includes its attachment badge, so exact aggregate text is not
      // just the sentinel. Count the actual UserMessage wrapper, not a text-only node.
      const userMessages = stream().locator(":scope > .group").filter({ hasText: "M_USER_REQUEST" });
      assert.equal(await userMessages.count(), 1);
      assert.equal(await userMessages.locator(":scope > div").evaluate((node) => node.firstChild.textContent), "M_USER_REQUEST");
      assert.equal(await thinking().count(), 1);
      assert.equal(await stream().getByText(THOUGHT, { exact: true }).count(), 0);
      assert.equal(await jump().count(), 0);
      assert.equal(state.streams.at(-1).after, state.sequence);
      assert.ok(state.streams.length >= 2);
      assert.equal(state.unexpected.length, 0, JSON.stringify(state.unexpected));
      assert.deepEqual(state.browserErrors, []);
      assert.equal(state.mutations.filter((request) => request.pathname.endsWith("/events")).length, 0);
      return { historicalUserMessages: 1, thinkingBlocks: 1, disclosureResetOnReload: true, replayCursor: state.sequence, providerTurns: 0 };
    });
  } finally {
    await page.goto("about:blank");
    await page.unroute("**/*", routeHandler);
    await sse.close();
    await report();
  }
  if (state.failures.length) throw new Error(`${state.failures.length} chat control assertion(s) failed; see chat-controls-report.json`);
}

// Subscribe before the triggering action. DOM mutation/scroll/scrollend events,
// not fixed sleeps or polling, settle every asynchronous browser-state oracle.
async function arm(page, expected) {
  return page.evaluate((expected) => {
    window.__mChatSignals ??= new Map();
    const key = crypto.randomUUID();
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    promise.catch(() => {});
    const node = document.querySelector(".chat-scroll");
    if (!node) throw new Error("Transcript not mounted");
    const finish = (event) => {
      const top = node.scrollTop;
      const distance = node.scrollHeight - top - node.clientHeight;
      const text = !expected.text || node.textContent.includes(expected.text);
      const jump = [...document.querySelectorAll("button")].some((button) => button.title === "Jump to latest");
      const enabled = !document.querySelector('[aria-label="Message input"]')?.disabled;
      const satisfied = expected.kind === "text" ? text
        : expected.kind === "enabled" ? enabled
        : expected.kind === "jump" ? text && jump && distance > 80
        : expected.kind === "bottom" ? text && distance < 2
        : expected.kind === "scrollend" ? event?.type === "scrollend" && (expected.position === "bottom" ? distance < 2 : distance > 80)
        : false;
      if (satisfied) { cleanup(); resolve({ top, distance, height: node.scrollHeight, clientHeight: node.clientHeight }); }
    };
    const observer = new MutationObserver(finish);
    const cleanup = () => { clearTimeout(timer); observer.disconnect(); node.removeEventListener("scroll", finish); node.removeEventListener("scrollend", finish); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`M chat state did not occur: ${JSON.stringify(expected)}`)); }, 15_000);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    node.addEventListener("scroll", finish);
    node.addEventListener("scrollend", finish);
    window.__mChatSignals.set(key, promise);
    finish();
    return key;
  }, expected);
}
async function wait(page, key) {
  return page.evaluate(async (key) => {
    try { return await window.__mChatSignals.get(key); }
    finally { window.__mChatSignals.delete(key); }
  }, key);
}
async function observe(page, expected) { return wait(page, await arm(page, expected)); }

async function startSse(state, base) {
  const sockets = new Set();
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method !== "GET" || url.pathname !== `/api/sessions/${SESSION}/stream`) { response.writeHead(404); response.end(); return; }
    const after = Number(url.searchParams.get("after_sequence"));
    state.streams.push({ sessionId: SESSION, after });
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "Access-Control-Allow-Origin": new URL(base).origin, "Access-Control-Allow-Credentials": "true" });
    response.flushHeaders();
    response.write(": M chat-controls connected\n\n");
    state.responses.add(response);
    response.once("close", () => state.responses.delete(response));
    for (const frame of state.history.filter((frame) => frame.sequence > after)) response.write(`id: ${frame.sequence}\ndata: ${JSON.stringify(frame)}\n\n`);
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { base: `http://127.0.0.1:${address.port}`, close: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } };
}
