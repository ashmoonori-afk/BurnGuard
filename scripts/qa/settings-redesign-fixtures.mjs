import assert from "node:assert/strict";

/** Actual browser controls with synthetic API data; no provider or persisted server mutations. */
export async function runSettingsRedesignFixtures(page, base, scenario) {
  const systemId = "redesign-status-fixture";
  const authority = "redesign-settings-fixture-authority";
  const at = 1_700_000_000_000;
  const originalSystem = {
    id: systemId, name: "상태 전환 검증 시스템", description: "검토와 게시 뒤에도 남는 설명", status: "draft",
    source_type: "manual", source_uri: null, dir_path: "fixture-system", skill_md_path: null,
    tokens_css_path: "styles/tokens.css", readme_md_path: null, archived_at: null, is_template: false,
    thumbnail_path: null, kind: "design-system", owner: "local", lifecycle: "active", provenance: "observed",
    license: "unknown", tags: ["브랜드", "검증"], metadata_revision: 7,
    content: { revision: 3, receipt_id: null, digest: "c".repeat(64) }, lineage: null,
    preview: null, usage: [], warning: null, created_at: at, updated_at: at,
  };
  const tokens = { system_id: systemId, colors: [{ name: "brand-blue", value: "#2455D9" }], token_file_path: "styles/tokens.css" };
  const originalTokens = structuredClone(tokens);
  const settings = {
    user: { id: "local", display_name: "설정 검증 사용자" }, app_version: "fixture", default_backend: "codex",
    theme: "light", chat_abort_threshold_ms: 300_000, chat_context_mode: "compact", figma_token_set: true,
  };
  const installed = { state: "success", started_at: null, finished_at: at, exit_code: 0, error: null, tail: [] };
  let system = structuredClone(originalSystem);
  const systemPatches = [];
  const settingsPatches = [];
  const mutations = [];
  const receipts = [];
  const viewport = page.viewportSize();
  const pattern = `${base}/api/**`;
  const handler = async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) mutations.push({ pathname, method });
    const ok = (data) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) });
    const missing = () => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "fixture_route_missing", message: "Fixture route unavailable" } }) });
    if (pathname === "/api/bootstrap") return ok({ capability: authority });
    if (pathname === "/api/settings") {
      if (method === "PATCH") {
        const body = request.postDataJSON();
        settingsPatches.push({ body, authority: request.headers()["x-burnguard-capability"] });
        for (const key of ["user", "theme", "default_backend", "chat_abort_threshold_ms", "chat_context_mode"]) {
          if (key in body) settings[key] = body[key];
        }
      }
      return ok(settings);
    }
    if (pathname === "/api/projects") return ok([]);
    if (pathname === "/api/design-systems") return ok([system]);
    if (pathname === `/api/design-systems/${systemId}`) {
      if (method === "PATCH") {
        const body = request.postDataJSON();
        systemPatches.push({ body, authority: request.headers()["x-burnguard-capability"] });
        system = { ...system, name: body.name, description: body.description, status: body.status, tags: body.tags, metadata_revision: system.metadata_revision + 1 };
      }
      return ok(system);
    }
    if (pathname === `/api/design-systems/${systemId}/tokens`) return ok(tokens);
    if (pathname === `/api/design-systems/${systemId}/previews`) return ok([]);
    if (pathname === "/api/backends/detect") return ok({ backends: [{ id: "claude-code", found: true, version: "fixture" }, { id: "codex", found: true, version: "fixture" }] });
    if (pathname === "/api/settings/updates") return ok({ supported: false, unsupported_reason: "not_installed", state: "unsupported", current_version: "fixture", available_version: null, progress: null, checked_at: null, error: null });
    if (pathname === "/api/settings/playwright") return ok(installed);
    if (pathname === "/api/settings/python") return ok({ health: { python: { found: true, executable: ["fixture-python"], version: "Python fixture" }, pypdf: { found: true, version: "fixture", supported: true, required_version: "fixture" }, checked_at: at }, install: installed });
    return missing();
  };
  const run = async (name, callback) => {
    const check = async () => {
      await callback();
      receipts.push({ name, ok: true, evidence: "real-browser-with-synthetic-api" });
    };
    if (scenario) await scenario(name, check);
    else await check();
  };

  await page.route(pattern, handler);
  try {
    await run("redesign-system-review-publish-preserves-metadata", async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${base}/systems/${systemId}`, { waitUntil: "domcontentloaded" });
      const summary = page.getByRole("heading", { name: originalSystem.name, exact: true }).locator("..");
      await summary.waitFor();
      await page.getByRole("button", { name: "brand-blue 색상 편집", exact: true }).waitFor();
      await page.getByRole("button", { name: "검토 시작", exact: true }).click();
      await page.getByRole("button", { name: "디자인 시스템 게시", exact: true }).waitFor();
      assert.deepEqual(systemPatches[0], { authority, body: { expected_revision: 7, name: originalSystem.name, description: originalSystem.description, status: "review", tags: originalSystem.tags } });
      await page.getByRole("button", { name: "디자인 시스템 게시", exact: true }).click();
      await summary.getByText("게시됨", { exact: true }).waitFor();
      assert.deepEqual(systemPatches[1], { authority, body: { expected_revision: 8, name: originalSystem.name, description: originalSystem.description, status: "published", tags: originalSystem.tags } });
      assert.equal(systemPatches.length, 2);
      assert.deepEqual(mutations, [{ pathname: `/api/design-systems/${systemId}`, method: "PATCH" }, { pathname: `/api/design-systems/${systemId}`, method: "PATCH" }]);
      assert.deepEqual(system, { ...originalSystem, status: "published", metadata_revision: 9 });
      assert.deepEqual(tokens, originalTokens);
      assert.equal(await page.getByRole("heading", { name: originalSystem.name, exact: true }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "brand-blue 색상 편집", exact: true }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "디자인 시스템 게시", exact: true }).count(), 0);
    });

    await run("redesign-settings-mobile-sections-and-fixed-save", async () => {
      const mutationCount = mutations.length;
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${base}/settings`, { waitUntil: "domcontentloaded" });
      const dialog = page.getByRole("dialog", { name: "설정", exact: true });
      const name = dialog.getByLabel("표시 이름", { exact: true });
      await name.fill("모바일에서 유지되는 초안");
      const navigation = dialog.getByRole("navigation", { name: "설정 섹션", exact: true });
      const save = dialog.getByRole("button", { name: "저장", exact: true }).last();
      for (const [label, sectionId] of [["생성 도구", "generation"], ["화면", "appearance"], ["파일 변환", "files"], ["외부 연결", "connections"], ["사용자", "user"]]) {
        const control = navigation.getByRole("button", { name: label, exact: true });
        await control.focus();
        await control.press("Enter");
        await page.waitForFunction((id) => {
          const section = document.getElementById(`settings-${id}`);
          const heading = document.getElementById(`settings-${id}-title`);
          const scrollport = section?.parentElement?.parentElement;
          if (!heading || !scrollport) return false;
          const bounds = heading.getBoundingClientRect();
          const area = scrollport.getBoundingClientRect();
          return bounds.top >= area.top && bounds.bottom <= area.bottom;
        }, sectionId);
        const bounds = await save.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 844, "Settings save escaped the mobile viewport");
        assert.equal(await name.inputValue(), "모바일에서 유지되는 초안");
      }
      await save.focus();
      assert.equal(await save.evaluate((element) => element === document.activeElement), true, "Settings save cannot receive keyboard focus");
      await save.click();
      await dialog.waitFor({ state: "hidden" });
      assert.deepEqual(settingsPatches, [{ authority, body: { default_backend: "codex", theme: "light", chat_abort_threshold_ms: 300_000, chat_context_mode: "compact", user: { id: "local", display_name: "모바일에서 유지되는 초안" } } }]);
      assert.equal(settings.figma_token_set, true, "General settings changed the separate Figma connection");
      assert.deepEqual(mutations.slice(mutationCount), [{ pathname: "/api/settings", method: "PATCH" }]);
    });
  } finally {
    await page.goto("about:blank");
    await page.unroute(pattern, handler);
    if (viewport) await page.setViewportSize(viewport);
  }
  return receipts;
}
