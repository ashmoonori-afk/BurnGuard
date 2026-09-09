// Real UI and API checks against e2e-smoke's owned temporary profile.
// Node 22.13+ provides the read-only SQLite inspector; no provider is invoked.
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";

export async function runUiRedesignFixtures(page, base, scenario, { home, shot, fixtureProjectName }) {
  const blockedPosts = [];
  let homeFlowPassed = false;
  const localApi = `${base}/api/**`;
  const guard = async (route) => {
    const request = route.request();
    if (request.method() === "POST" && new URL(request.url()).pathname !== "/api/projects") {
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
      await page.goto(`${base}/?view=mine&create=graphic`, { waitUntil: "domcontentloaded" });
      const dialog = page.getByRole("dialog", { name: "새 프로젝트 만들기" });
      await dialog.waitFor();
      await dialog.getByLabel("프로젝트 이름", { exact: true }).fill("브랜드 캠페인 그래픽");
      await dialog.getByLabel("누가 보게 되나요?", { exact: true }).fill("새 제품을 기다리는 고객");
      await dialog.getByLabel("무엇을 얻고 싶나요?", { exact: true }).fill("제품 출시 소식을 알리고 행사 참여를 안내해요.");
      await dialog.getByRole("button", { name: "SNS 1200×628", exact: true }).click();
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
      await create.click();
      const response = await createdResponse;
      assert.equal(response.status(), 201, "project creation must succeed on the real backend");
      const { data: created } = await response.json();
      assert.match(created.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
      await page.waitForURL((url) => url.pathname === `/projects/${created.id}`);
      await page.getByRole("heading", { name: "브랜드 캠페인 그래픽", exact: true }).waitFor();
      const headers = { "x-burnguard-capability": response.request().headers()["x-burnguard-capability"] };
      assert.ok(headers["x-burnguard-capability"], "creation must carry bootstrapped authority");
      const detailResponse = await page.request.get(`${base}/api/projects/${created.id}`, { headers });
      assert.equal(detailResponse.status(), 200);
      const { data: detail } = await detailResponse.json();
      assert.equal(detail.name, "브랜드 캠페인 그래픽");
      assert.equal(detail.type, "graphic");
      const options = JSON.parse(detail.options_json);
      assert.deepEqual(options.graphic_canvas, { schema_version: 1, width: 1200, height: 628 });
      assert.equal(options.design_brief.visual_mood, "friendly");
      const ownedHome = await realpath(home);
      assert.ok(path.basename(ownedHome).startsWith("burnguard-e2e-home-"), "only an owned E2E profile can be inspected");
      const projectDir = path.join(ownedHome, ".burnguard", "data", "projects", created.id);
      const html = await readFile(path.join(projectDir, "index.html"), "utf8");
      assert.ok(html.includes("브랜드 캠페인 그래픽"), "created artifact must exist on disk");
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(path.join(ownedHome, ".burnguard", "burnguard.db"), { readOnly: true });
      try {
        const row = db.prepare("SELECT p.name, p.type, p.dir_path, s.id AS session_id, s.status, s.last_turn_id, s.usage_input_tokens, s.usage_output_tokens FROM projects p JOIN sessions s ON s.project_id = p.id WHERE p.id = ?").get(created.id);
        assert.equal(row?.name, detail.name);
        assert.equal(row.type, "graphic");
        assert.equal(path.resolve(row.dir_path), projectDir);
        assert.equal(row.session_id, created.session_id);
        assert.equal(row.status, "idle");
        assert.equal(row.last_turn_id, null);
        assert.equal(row.usage_input_tokens + row.usage_output_tokens, 0);
        assert.equal(db.prepare("SELECT COUNT(*) AS total FROM events WHERE session_id = ? AND type = 'user.message'").get(created.session_id).total, 0, "creating a project must not start a model turn");
      } finally { db.close(); }
      assert.equal(blockedPosts.length, 0, "project creation unexpectedly tried another POST");
      await page.setViewportSize({ width: 1440, height: 900 });
      await shot(page, "redesign-created-workspace");
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
      assert.equal(blockedPosts.length, 0, "switching panes must not send a model request");
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
        if (attempts === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "thumbnail_unavailable", message: "Thumbnail could not be rendered" } }) });
        return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
      };
      await page.route(thumbnailRoute, intercept);
      try {
        await page.goto(`${base}/?view=mine`, { waitUntil: "domcontentloaded" });
        const retry = page.getByRole("button", { name: /미리보기 다시 불러오기$/ }).first();
        await retry.waitFor();
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
        assert.equal(attempts, 2, "one explicit retry must issue one new image request");
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
