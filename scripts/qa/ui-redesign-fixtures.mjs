// Real UI and API checks against e2e-smoke's owned temporary profile.
// Node 22.13+ provides the read-only SQLite inspector; no provider is invoked.
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";

export async function runUiRedesignFixtures(page, base, runScenario, { home, shot, fixtureProjectName }) {
  const blockedPosts = [];
  let preservingDocuments = false;
  const scenario = (name, check) => runScenario(name, async () => {
    blockedPosts.length = 0;
    preservingDocuments = name === "redesign-create-project-persists";
    try { await check(); } finally { preservingDocuments = false; }
  });
  let homeFlowPassed = false;
  const localApi = `${base}/api/**`;
  const guard = async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const documentSave = preservingDocuments && /^\/api\/sessions\/[^/]+\/documents$/.test(pathname);
    if (request.method() === "POST" && pathname !== "/api/projects" && !documentSave) {
      blockedPosts.push(new URL(request.url()).pathname);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  };
  await page.route(localApi, guard);
  try {
    await scenario("redesign-home-url-and-keyboard", async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${base}/?view=mine`, { waitUntil: "domcontentloaded" });
      const mine = page.getByRole("tab", { name: "내 프로젝트", exact: true });
      await mine.waitFor();
      assert.equal(await mine.getAttribute("aria-selected"), "true");
      await page.getByRole("tab", { name: "예제", exact: true }).click();
      await page.waitForURL((url) => url.searchParams.get("view") === "examples");
      await page.goBack({ waitUntil: "domcontentloaded" });
      await page.waitForURL((url) => url.searchParams.get("view") === "mine");
      assert.equal(await mine.getAttribute("aria-selected"), "true");
      const create = page.getByRole("button", { name: "새 프로젝트", exact: true });
      await create.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "새 프로젝트 만들기" });
      await dialog.waitFor();
      await page.waitForURL((url) => url.searchParams.get("create") === "slide_deck");
      await dialog.getByLabel("프로젝트 이름", { exact: true }).waitFor();
      await page.waitForFunction(() => document.activeElement?.id === "project-name");
      await page.goBack({ waitUntil: "domcontentloaded" });
      await dialog.waitFor({ state: "hidden" });
      await page.waitForURL((url) => url.searchParams.get("view") === "mine" && !url.searchParams.has("create"));
      await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "새 프로젝트");
      assert.equal(blockedPosts.length, 0, "navigation unexpectedly tried a POST");
      homeFlowPassed = true;
    });

    // Documentation capture readiness is separate from URL/keyboard behavior.
    // Missing render output remains the real fallback and is reported by ID.
    if (homeFlowPassed) {
      try {
        console.log(JSON.stringify({ kind: "readme-thumbnail-capture", ...await waitForRenderedHomeThumbnails(page, base, home) }));
      } catch {
        console.log(JSON.stringify({ kind: "readme-thumbnail-capture", ready: [], unavailable: [{ code: "thumbnail_capture_unavailable" }] }));
      }
      await shot(page, "redesign-home");
    }

    await scenario("redesign-create-project-persists", async () => {
      await page.setViewportSize({ width: 390, height: 740 });
      await page.goto(`${base}/?view=mine&create=prototype`, { waitUntil: "domcontentloaded" });
      const dialog = page.getByRole("dialog", { name: "새 프로젝트 만들기" });
      await dialog.waitFor();
      await dialog.getByLabel("프로젝트 이름", { exact: true }).fill("브랜드 캠페인 웹디자인");
      await dialog.getByLabel("누가 보게 되나요?", { exact: true }).fill("새 제품을 기다리는 고객");
      await dialog.getByLabel("무엇을 얻고 싶나요?", { exact: true }).fill("제품 출시 소식을 알리고 행사 참여를 안내해요.");
      await dialog.getByLabel("세로 섹션 수", { exact: true }).fill("8");
      await dialog.getByLabel("AI 도구", { exact: true }).selectOption("claude-code");
      const model = dialog.getByLabel("생성 모델", { exact: true });
      await page.waitForFunction(() => document.querySelector('[aria-label="생성 모델"]')?.querySelectorAll("option").length > 1, null, { timeout: 10_000 });
      const modelId = await model.locator("option").nth(1).getAttribute("value");
      await model.selectOption(modelId);
      assert.equal(await dialog.getByLabel("추론 강도", { exact: true }).inputValue(), "low");
      assert.equal(await dialog.getByRole("checkbox", { name: /바닐라 모드/ }).isChecked(), true);
      await dialog.getByLabel("참고 자료 첨부", { exact: true }).setInputFiles({ name: "campaign-reference.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% Local unsent intake fixture\n%%EOF") });
      await dialog.getByLabel("campaign-reference.pdf 역할", { exact: true }).selectOption("immutable_reference", { timeout: 10_000 });
      await dialog.locator("summary").click();
      await dialog.getByLabel("분위기", { exact: true }).selectOption("friendly");
      assert.equal(await dialog.evaluate((element) => element.scrollHeight > element.clientHeight), true, "narrow dialog should contain its scrolling");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "narrow dialog overflowed the viewport");
      const bounds = await dialog.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391, "dialog is clipped horizontally");
      await page.waitForFunction(() => {
        const select = document.getElementById("design-system");
        return select instanceof HTMLSelectElement && !select.disabled && select.options.length > 1;
      }, null, { timeout: 30_000 });
      await dialog.evaluate((element) => { element.scrollTop = 0; });
      await shot(page, "redesign-create-mobile");
      await page.setViewportSize({ width: 1440, height: 900 });
      await waitForVisibleThumbnails(page);
      await shot(page, "redesign-create");
      await page.setViewportSize({ width: 390, height: 740 });
      const create = dialog.getByRole("button", { name: "프로젝트 만들기", exact: true });
      await create.scrollIntoViewIfNeeded();
      const buttonBounds = await create.boundingBox();
      assert.ok(buttonBounds && buttonBounds.y >= 0 && buttonBounds.y + buttonBounds.height <= 740, "create action cannot be reached in dialog scrollport");
      const createdResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/projects");
      const documentsSaved = page.waitForResponse((response) => response.request().method() === "POST" && /\/api\/sessions\/[^/]+\/documents$/.test(new URL(response.url()).pathname));
      void documentsSaved.catch(() => {});
      await create.click();
      const response = await createdResponse;
      assert.equal(response.status(), 201, "project creation must succeed on the real backend");
      const { data: created } = await response.json();
      assert.match(created.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
      await page.waitForURL((url) => url.pathname === `/projects/${created.id}`);
      await page.getByRole("heading", { name: "브랜드 캠페인 웹디자인", exact: true }).waitFor();
      const headers = { "x-burnguard-capability": response.request().headers()["x-burnguard-capability"] };
      assert.ok(headers["x-burnguard-capability"], "creation must carry bootstrapped authority");
      const detailResponse = await page.request.get(`${base}/api/projects/${created.id}`, { headers });
      assert.equal(detailResponse.status(), 200);
      const { data: detail } = await detailResponse.json();
      assert.equal(detail.name, "브랜드 캠페인 웹디자인");
      assert.equal(detail.type, "prototype");
      const options = JSON.parse(detail.options_json);
      assert.equal(options.design_brief.section_count, 8);
      assert.equal(options.design_brief.content_source, "attached");
      assert.equal(options.design_brief.visual_mood, "friendly");
      const ownedHome = await realpath(home);
      assert.ok(path.basename(ownedHome).startsWith("burnguard-e2e-home-"), "only an owned E2E profile can be inspected");
      const projectDir = path.join(ownedHome, ".burnguard", "data", "projects", created.id);
      const documentResponse = await documentsSaved;
      assert.equal(new URL(documentResponse.url()).pathname, `/api/sessions/${created.session_id}/documents`);
      assert.equal(documentResponse.status(), 200, "original-document persistence must succeed without starting a model turn");
      const { data: documents } = await documentResponse.json();
      assert.equal(documents.paths.length, 1);
      assert.match(documents.paths[0], /^docs\/attachments\/[a-f0-9]{64}-campaign-reference\.pdf$/);
      assert.equal(await readFile(path.join(projectDir, documents.paths[0]), "utf8"), "%PDF-1.4\n% Local unsent intake fixture\n%%EOF");
      const html = await readFile(path.join(projectDir, "index.html"), "utf8");
      assert.ok(html.includes("브랜드 캠페인 웹디자인"), "created artifact must exist on disk");
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(path.join(ownedHome, ".burnguard", "burnguard.db"), { readOnly: true });
      try {
        const row = db.prepare("SELECT p.name, p.type, p.dir_path, s.id AS session_id, s.status, s.last_turn_id, s.usage_input_tokens, s.usage_output_tokens FROM projects p JOIN sessions s ON s.project_id = p.id WHERE p.id = ?").get(created.id);
        assert.equal(row?.name, detail.name);
        assert.equal(row.type, "prototype");
        assert.equal(path.resolve(row.dir_path), projectDir);
        assert.equal(row.session_id, created.session_id);
        assert.equal(row.status, "idle");
        assert.equal(row.last_turn_id, null);
        assert.equal(row.usage_input_tokens + row.usage_output_tokens, 0);
        assert.equal(db.prepare("SELECT COUNT(*) AS total FROM events WHERE session_id = ? AND type = 'user.message'").get(created.session_id).total, 0, "creating a project must not start a model turn");
      } finally { db.close(); }
      assert.deepEqual(blockedPosts, [], "project creation unexpectedly tried another POST");
      await page.setViewportSize({ width: 1440, height: 900 });
      const composer = page.getByRole("textbox", { name: "메시지 입력", exact: true });
      await composer.waitFor();
      assert.equal(await composer.inputValue(), "제품 출시 소식을 알리고 행사 참여를 안내해요.");
      assert.equal(await page.getByLabel("campaign-reference.pdf 역할", { exact: true }).inputValue(), "immutable_reference");
      const stored = await page.evaluate(async (sessionId) => {
        const db = await new Promise((resolve, reject) => { const request = indexedDB.open("burnguard-composer", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        try { return await new Promise((resolve, reject) => { const request = db.transaction("drafts").objectStore("drafts").get(sessionId); request.onsuccess = async () => { const draft = request.result; resolve({ text: draft.text, generation: draft.generation, items: await Promise.all(draft.items.map(async (item) => ({ role: item.role, name: item.file.name, bytes: await item.file.text() }))) }); }; request.onerror = () => reject(request.error); }); } finally { db.close(); }
      }, created.session_id);
      assert.equal(stored.generation.model, modelId);
      assert.equal(stored.generation.effort, "low");
      assert.equal(stored.items[0].role, "immutable_reference");
      assert.equal(stored.items[0].bytes, "%PDF-1.4\n% Local unsent intake fixture\n%%EOF");
      const restoredDocuments = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/sessions/${created.session_id}/documents`);
      void restoredDocuments.catch(() => {});
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByLabel("campaign-reference.pdf 역할", { exact: true }).waitFor({ timeout: 10_000 });
      assert.equal(await page.getByLabel("campaign-reference.pdf 역할", { exact: true }).inputValue(), "immutable_reference");
      assert.equal(await composer.inputValue(), stored.text);
      const restoredResponse = await restoredDocuments;
      assert.equal(restoredResponse.status(), 200);
      assert.deepEqual((await restoredResponse.json()).data.paths, documents.paths, "restoration must preserve the same original, not duplicate it");
      assert.equal(blockedPosts.length, 0, "restoring attachments must not start a model turn");
      await shot(page, "redesign-created-workspace");
    });

    await scenario("redesign-graphic-auth-locked", async () => {
      await page.goto(`${base}/?create=graphic`, { waitUntil: "domcontentloaded" });
      const dialog = page.getByRole("dialog", { name: "새 프로젝트 만들기" });
      await dialog.getByLabel("프로젝트 이름", { exact: true }).waitFor();
      assert.equal(await dialog.getByRole("button", { name: "그래픽", exact: true }).isDisabled(), true);
      await dialog.getByText("그래픽을 만들려면 설정에서 Codex를 연결하고 로그인해 주세요.", { exact: true }).waitFor();
      assert.equal(await dialog.getByRole("button", { name: "프로젝트 만들기", exact: true }).isDisabled(), true);
      const detection = await page.request.get(`${base}/api/backends/detect`);
      assert.equal(detection.status(), 200);
      const { data } = await detection.json();
      assert.equal(data.backends.some((backend) => backend.id === "codex" && backend.found && backend.authenticated === true), false, "owned CODEX_HOME must be unauthenticated");
      const bootstrapResponse = await page.request.get(`${base}/api/bootstrap`, { headers: { origin: base }, timeout: 10_000 });
      assert.equal(bootstrapResponse.status(), 200, "bootstrap requires same-origin authority");
      const bootstrap = await bootstrapResponse.json();
      const rejected = await page.request.post(`${base}/api/projects`, { headers: { "x-burnguard-capability": bootstrap.data.capability, origin: base }, data: { name: "Blocked graphic", type: "graphic", design_system_id: null, backend_id: "codex", options: { graphic_canvas: { schema_version: 1, width: 1080, height: 1080 } } } });
      assert.equal(rejected.status(), 409, "direct creation must also enforce Codex authentication");
      await shot(page, "redesign-graphic-locked");
    });

    await scenario("redesign-pinterest-dialog", async () => {
      await page.goto(`${base}/?view=systems`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Pinterest 무드 가져오기", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Pinterest에서 무드 가져오기", exact: true });
      await dialog.waitFor();
      const submit = dialog.getByRole("button", { name: "무드 초안 만들기", exact: true });
      assert.equal(await submit.isDisabled(), true);
      await dialog.getByLabel("핀 주소 (한 줄에 하나)", { exact: true }).fill("https://www.pinterest.com/pin/123/");
      assert.equal(await submit.isEnabled(), true);
      await dialog.getByText(/원본 이미지가 저장되지는 않아요/).waitFor();
      await shot(page, "redesign-pinterest-dialog");
      await dialog.getByRole("button", { name: "취소", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.deepEqual(blockedPosts, [], "opening Pinterest intake must not fetch or publish a mood");
    });

    await scenario("redesign-mobile-workspace-switch", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await page.locator("a[href^='/projects/']").filter({ hasText: fixtureProjectName }).first().click();
      await page.waitForURL(/\/projects\/[^/?]+/);
      const workspace = page.locator("#project-workspace-pane");
      const chat = page.locator("#project-chat-pane");
      await workspace.waitFor({ state: "visible" });
      await chat.waitFor({ state: "hidden" });
      const chatButton = page.getByRole("button", { name: "AI 대화", exact: true });
      await chatButton.focus();
      await page.keyboard.press("Enter");
      await chat.waitFor({ state: "visible" });
      await workspace.waitFor({ state: "hidden" });
      assert.equal(await chatButton.getAttribute("aria-pressed"), "true");
      const composer = chat.getByRole("textbox", { name: "메시지 입력", exact: true });
      await composer.fill("전송하지 않은 모바일 작업 메모");
      await page.getByRole("button", { name: "작업 화면", exact: true }).click();
      await workspace.waitFor({ state: "visible" });
      await chat.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "AI 대화", exact: true }).click();
      await composer.waitFor();
      assert.equal(await composer.inputValue(), "전송하지 않은 모바일 작업 메모", "switching panes must retain the unsent draft");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "mobile workspace overflowed the viewport");
      await shot(page, "redesign-mobile-chat");
      await page.getByRole("button", { name: "작업 화면", exact: true }).click();
      await workspace.waitFor({ state: "visible" });
      await shot(page, "redesign-mobile-workspace");
      assert.deepEqual(blockedPosts, [], "switching panes must not send a model request");
      await page.setViewportSize({ width: 1440, height: 900 });
    });

    await scenario("redesign-thumbnail-manual-retry", async () => {
      let targetUrl = null;
      let attempts = 0;
      const thumbnailRoute = `${base}/api/projects/*/thumbnail**`;
      const intercept = async (route) => {
        targetUrl ??= route.request().url();
        if (route.request().url() !== targetUrl) return route.continue();
        attempts += 1;
        // Current cards exhaust five bounded cold-render retries before manual recovery.
        if (attempts <= 6) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "thumbnail_unavailable", message: "Thumbnail could not be rendered" } }) });
        return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
      };
      await page.route(thumbnailRoute, intercept);
      try {
        await page.goto(`${base}/?view=mine`, { waitUntil: "domcontentloaded" });
        const retry = page.getByRole("button", { name: /미리보기 다시 불러오기$/ }).first();
        await retry.waitFor({ timeout: 90_000 });
        assert.equal(attempts, 6, "manual recovery must follow the initial request and five bounded automatic retries");
        assert.ok(targetUrl, "a real card must request a thumbnail");
        const targetId = new URL(targetUrl).pathname.split("/")[3];
        const card = page.locator(`a[href='/projects/${targetId}']`).locator("..");
        await card.getByText("미리보기를 불러오지 못했어요", { exact: true }).waitFor();
        const before = page.url();
        await card.getByRole("button", { name: /미리보기 다시 불러오기$/ }).click();
        await page.waitForFunction((id) => {
          const image = document.querySelector(`a[href='/projects/${id}'] img`);
          return image instanceof HTMLImageElement && image.complete && image.naturalWidth === 1;
        }, targetId, { timeout: 15_000 });
        assert.equal(attempts, 7, "one explicit retry must issue one new image request");
        assert.equal(page.url(), before, "thumbnail retry must not open the project");
        assert.equal(await card.locator("a").evaluate((element) => document.activeElement === element), true, "retry must leave keyboard focus on the project card");
        assert.equal(await card.getByRole("button", { name: /미리보기 다시 불러오기$/ }).count(), 0);
        assert.equal(blockedPosts.length, 0);
      } finally { await page.unroute(thumbnailRoute, intercept); }
    });
  } finally {
    await page.unroute(localApi, guard);
    await page.setViewportSize({ width: 1440, height: 900 });
  }
}

async function waitForRenderedHomeThumbnails(page, base, home) {
  const response = await page.request.get(`${base}/api/projects?tab=mine`);
  assert.equal(response.status(), 200);
  const { data: projects } = await response.json();
  const ownedHome = await realpath(home);
  assert.ok(path.basename(ownedHome).startsWith("burnguard-e2e-home-"));
  const renderedProjects = projects.filter((project) => project.thumbnail_path);
  const results = await Promise.allSettled(renderedProjects.map(async (project) => {
    assert.match(project.id, /^[a-zA-Z0-9_-]+$/);
    const identity = new URL(project.thumbnail_path, base).searchParams.get("v");
    assert.match(identity, /^[a-f0-9]{64}$/);
    const metadata = path.join(ownedHome, ".burnguard", "data", "projects", project.id, ".meta");
    const filename = path.join(metadata, "thumbnails", `${identity}.png`);
    await waitForPublishedPng(metadata, filename);
  }));
  const ready = [];
  const unavailable = [];
  for (const [index, project] of renderedProjects.entries()) {
    if (results[index].status === "rejected") {
      unavailable.push({ project_id: project.id, code: results[index].reason?.code === "thumbnail_publication_timeout" ? "thumbnail_publication_timeout" : "thumbnail_read_failed" });
      continue;
    }
    try {
    const card = page.locator(`a[href='/projects/${project.id}']`).locator("..");
    await page.waitForFunction((id) => {
      const thumbnail = document.querySelector(`a[href='/projects/${id}'] [data-qa='project-thumbnail']`);
      const image = thumbnail?.querySelector("img");
      return thumbnail?.getAttribute("data-state") === "fallback" || image?.complete && image.naturalWidth > 0;
    }, project.id, { timeout: 5_000 });
    const retry = card.getByRole("button", { name: /미리보기 다시 불러오기$/ });
    if (await retry.count()) await retry.click();
    await page.waitForFunction((id) => {
      const image = document.querySelector(`a[href='/projects/${id}'] img`);
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth === 640;
    }, project.id, { timeout: 5_000 });
    ready.push(project.id);
    } catch {
      unavailable.push({ project_id: project.id, code: "thumbnail_retry_failed" });
    }
  }
  return { ready, unavailable };
}

async function waitForPublishedPng(directory, filename) {
  const exists = async () => {
    try { return (await readFile(filename)).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); }
    catch (error) { if (error.code === "ENOENT") return false; throw error; }
  };
  if (await exists()) return;
  let watcher;
  let deadline;
  try {
    await new Promise((resolve, reject) => {
      const check = () => { void exists().then((ready) => { if (ready) resolve(); }, reject); };
      watcher = watch(directory, { recursive: true }, check);
      watcher.on("error", reject);
      deadline = setTimeout(() => reject(Object.assign(new Error("Real thumbnail publication timed out"), { code: "thumbnail_publication_timeout" })), 15_000);
      check();
    });
  } finally { watcher?.close(); clearTimeout(deadline); }
}

async function waitForVisibleThumbnails(page) {
  await page.locator('[data-qa="project-thumbnail"]').first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => {
    const thumbnails = [...document.querySelectorAll('[data-qa="project-thumbnail"]')].filter((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.top < innerHeight && bounds.right > 0 && bounds.left < innerWidth;
    });
    return thumbnails.length > 0 && thumbnails.every((element) => {
      const image = element.querySelector("img");
      // A failed image only settles after React replaces it with its fallback.
      return element.getAttribute("data-state") === "fallback" ? image === null : image?.complete && image.naturalWidth > 0;
    });
  }, null, { timeout: 60_000 });
}
