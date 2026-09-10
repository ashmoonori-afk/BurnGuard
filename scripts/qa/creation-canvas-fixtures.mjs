// Run only against e2e-smoke's owned temporary profile. Provider POSTs are intercepted;
// mock transcript assertions below are UI delivery checks, never provider execution proof.
import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

export async function runCreationCanvasFixtures(page, base, scenario, { home, shot }) {
  const ownedHome = await realpath(home);
  assert.ok(path.basename(ownedHome).startsWith("burnguard-e2e-home-"), "canvas fixtures require an owned E2E home");
  const eventPattern = `${base}/api/sessions/*/events`;
  let captured = null;
  let allowMockSend = false;
  const guard = async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    assert.ok(allowMockSend, "an unexpected action tried to start a provider turn");
    assert.equal(captured, null, "one explicit comment action must send only once");
    captured = route.request().postDataJSON();
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ data: { accepted: true } }) });
  };
  await page.route(eventPattern, guard);
  try {
    await scenario("creation-canvas-zoom-scroll-font", async () => {
      await createFixture(page, base, ownedHome, "Canvas geometry");
      const frame = page.frameLocator('iframe[title="캔버스"]');
      const iframe = page.locator('iframe[title="캔버스"]');
      const original = await iframe.boundingBox();
      assert.ok(original);
      await page.getByRole("button", { name: "미리보기 축소", exact: true }).click();
      const scaled = await iframe.boundingBox();
      assert.ok(scaled && Math.abs(scaled.width / original.width - 0.75) < 0.02, "75% must scale the entire frame");
      await page.getByRole("button", { name: "화면 이동", exact: true }).click();
      const start = { x: scaled.x + scaled.width / 2, y: scaled.y + scaled.height / 2 };
      // Wait for the mode's actual hit surface, not just the preceding button click.
      await page.waitForFunction(({ x, y }) => {
        const target = document.elementFromPoint(x, y);
        return target instanceof HTMLElement && target.style.cursor === "grab";
      }, start);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 45, start.y + 25);
      // Continuous pointer updates commit asynchronously. Observe the exact requested
      // translation before releasing capture, then check the rendered geometry too.
      await page.waitForFunction(() => {
        const stage = document.querySelector('iframe[title="캔버스"]')?.parentElement;
        if (!stage) return false;
        const transform = new DOMMatrixReadOnly(getComputedStyle(stage).transform);
        return Math.abs(transform.m41 - 45) < 0.1 && Math.abs(transform.m42 - 25) < 0.1;
      }, null, { timeout: 5000 });
      await page.mouse.up();
      const moved = await iframe.boundingBox();
      assert.ok(moved && Math.abs(moved.x - scaled.x - 45) < 2, "pan must move the scaled stage");
      await page.getByRole("button", { name: "화면 이동", exact: true }).click();
      await page.locator('[aria-label="캔버스 도구"]').getByRole("button", { name: "스타일", exact: true }).click();
      const heading = await frame.locator("#fixture-hero").boundingBox();
      assert.ok(heading);
      await page.mouse.click(heading.x + heading.width / 2, heading.y + heading.height / 2);
      const tools = page.getByRole("complementary", { name: "캔버스 도구 설정" });
      await tools.getByText('data-bg-node-id="fixture-hero"', { exact: true }).waitFor();
      // Deterministic native fallback on Windows; no browser permission dialog is auto-approved.
      await page.evaluate(() => Object.defineProperty(window, "queryLocalFonts", { value: undefined, configurable: true }));
      const fonts = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/settings/local-fonts");
      await tools.getByRole("button", { name: "설치된 글꼴 불러오기", exact: true }).click();
      const fontResponse = await fonts;
      assert.equal(fontResponse.status(), 200, "native font enumeration must be available for this Windows QA run");
      const families = (await fontResponse.json()).data.families;
      assert.ok(families.length > 0 && families.every((family) => !/[\\/\x00-\x1f]/.test(family)), "family names must exclude private paths");
      await tools.getByText(/설치된 글꼴 \d+개/).waitFor();
      const patched = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/fs/"));
      await tools.getByText("글꼴", { exact: true }).locator("..").locator("select").selectOption(JSON.stringify(families[0]));
      assert.equal((await patched).status(), 200, "font-family must persist through the normal patch path");
      await frame.locator("#fixture-hero").waitFor();
      const bounds = await iframe.boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.wheel(0, 400);
      await frame.locator("body").evaluate(() => new Promise((resolve, reject) => {
        if (document.scrollingElement.scrollTop > 0) return resolve();
        const timeout = setTimeout(() => { window.removeEventListener("scroll", onScroll); reject(new Error("style overlay did not forward scrolling")); }, 5000);
        function onScroll() { if (document.scrollingElement.scrollTop > 0) { clearTimeout(timeout); window.removeEventListener("scroll", onScroll); resolve(); } }
        window.addEventListener("scroll", onScroll);
      }));
      await shot(page, "creation-canvas-zoom-scroll-font");
    });

    await scenario("creation-canvas-comment-save-model-mock", async () => {
      // Capture real EventSources so only the explicitly mocked response is injected.
      await page.addInitScript(() => {
        const NativeEventSource = window.EventSource;
        window.__creationCanvasStreams = [];
        window.EventSource = class extends NativeEventSource {
          constructor(...args) { super(...args); window.__creationCanvasStreams.push(this); }
        };
      });
      const fixture = await createFixture(page, base, ownedHome, "Comment request");
      const chat = page.getByRole("complementary", { name: "AI 대화와 코멘트" });
      const model = chat.getByLabel("생성 모델", { exact: true });
      await page.waitForFunction(() => document.querySelector('[aria-label="생성 모델"]')?.querySelectorAll("option").length > 1);
      const modelValue = await model.locator("option").nth(1).getAttribute("value");
      await model.selectOption(modelValue);
      const effort = chat.getByLabel("추론 강도", { exact: true });
      const effortValue = await effort.locator("option").last().getAttribute("value");
      await effort.selectOption(effortValue);
      const vanilla = await chat.getByRole("checkbox", { name: /바닐라 모드/ }).isChecked();
      await page.locator('[aria-label="캔버스 도구"]').getByRole("button", { name: "코멘트", exact: true }).click();
      const heading = await page.frameLocator('iframe[title="캔버스"]').locator("#fixture-hero").boundingBox();
      const created = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/comments"));
      await page.mouse.click(heading.x + heading.width / 2, heading.y + heading.height / 2);
      assert.equal((await created).status(), 201);
      const tools = page.getByRole("complementary", { name: "캔버스 도구 설정" });
      const draft = "코멘트 한 번 클릭 저장/전송 fixture";
      await tools.getByPlaceholder("메모를 남겨 보세요...").fill(draft);
      assert.equal(captured, null, "typing must never send a model request");
      allowMockSend = true;
      const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/comments/"));
      const sent = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/events"));
      await tools.getByRole("button", { name: "저장하고 AI로 수정", exact: true }).click();
      assert.equal((await saved).status(), 200);
      assert.equal((await sent).status(), 202);
      assert.equal(captured.generation.model, modelValue);
      assert.equal(captured.generation.effort, effortValue);
      assert.equal(captured.generation.vanilla, vanilla);
      assert.ok(captured.text.includes("명시적인 확인을 받을 때까지 이미지 생성 도구를 호출하거나 파일을 변경하지 마세요"));
      assert.ok(captured.text.includes("직접 브라우저로 렌더링하고 스크린샷을 확인하세요"));
      const target = JSON.parse(captured.text.split("\n")[1]);
      assert.equal(target.file, "index.html");
      assert.equal(target.request, draft);
      assert.ok(target.element.includes("fixture-hero"));
      const response = await page.request.get(`${base}/api/projects/${fixture.id}/comments`);
      const comment = (await response.json()).data.find((item) => item.id === target.comment_id);
      assert.equal(comment.body, draft);
      assert.equal(comment.resolved_at, null, "sending is not equivalent to resolving");
      await page.evaluate(({ sessionId, text }) => {
        const source = window.__creationCanvasStreams.findLast((stream) => stream.url.includes(`/sessions/${sessionId}/stream`) && stream.readyState !== EventSource.CLOSED);
        if (!source) throw new Error("fixture stream not connected");
        const events = [
          { type: "chat.user_message", turnId: "fixture-turn", text, attachmentCount: 0 },
          { type: "chat.delta", turnId: "fixture-turn", text: "[모의 응답] 요청을 확인했어요." },
          { type: "chat.message_end", turnId: "fixture-turn" },
          { type: "status.idle", stopReason: "end_turn" },
        ];
        events.forEach((event, index) => source.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ sequence: 10000 + index, event: { ...event, id: `canvas-fixture-${index}`, ts: Date.now() } }) })));
      }, { sessionId: fixture.sessionId, text: captured.text });
      await chat.getByText("[모의 응답] 요청을 확인했어요.", { exact: true }).waitFor();
      await chat.getByText(`코멘트 수정 · index.html\n${draft}`, { exact: true }).waitFor();
      const transcript = await chat.innerText();
      for (const hidden of [target.comment_id, "comment_id", "artifact_digest", "artifact_revision", "다음 저장된 코멘트에 따라"]) assert.ok(!transcript.includes(hidden), `${hidden} must stay out of chat copy`);
      await shot(page, "creation-canvas-comment-mock-response");
      allowMockSend = false;
    });

    await scenario("creation-canvas-three-save-reload-undo", async () => {
      const fixture = await createFixture(page, base, ownedHome, "Offline Three scene");
      const beforeResponse = await page.request.get(`${base}/api/projects/${fixture.id}/fs/index.html`);
      const before = await beforeResponse.text();
      await page.getByRole("button", { name: "3D 장면", exact: true }).click();
      const editor = page.getByRole("region", { name: "3D 장면 편집기" });
      await editor.getByRole("button", { name: "큐브 +", exact: true }).click();
      await editor.getByLabel("3D position X", { exact: true }).fill("2");
      await editor.getByLabel("3D 오브젝트 색상", { exact: true }).fill("#ff0000");
      assert.equal(await editor.locator("canvas").evaluate((canvas) => Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"))), true, "editor must have a real WebGL context");
      const saveResponse = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes("/three-scene?"));
      await editor.getByRole("button", { name: "HTML에 저장", exact: true }).click();
      assert.equal((await saveResponse).status(), 200);
      const storedResponse = await page.request.get(`${base}/api/projects/${fixture.id}/fs/index.html`);
      const stored = await storedResponse.text();
      assert.ok(stored.includes("data-bg-three-runtime") && !/<script src=["']https?:/.test(stored), "saved scene must contain its offline runtime");
      await page.reload({ waitUntil: "domcontentloaded" });
      const frame = page.frameLocator('iframe[title="캔버스"]');
      await frame.locator("[data-bg-three] canvas").waitFor();
      assert.equal(await frame.locator("[data-bg-three] canvas").evaluate((canvas) => Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"))), true, "saved iframe must render a real WebGL scene");
      await page.getByRole("button", { name: "3D 장면", exact: true }).click();
      await editor.getByLabel("3D position X", { exact: true }).waitFor();
      assert.equal(await editor.getByLabel("3D position X", { exact: true }).inputValue(), "2");
      assert.equal(await editor.getByLabel("3D 오브젝트 색상", { exact: true }).inputValue(), "#ff0000");
      const undoResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/undo"));
      await page.getByRole("button", { name: "마지막 저장 실행 취소", exact: true }).click();
      assert.equal((await undoResponse).status(), 200);
      const restoredResponse = await page.request.get(`${base}/api/projects/${fixture.id}/fs/index.html`);
      assert.equal(await restoredResponse.text(), before, "undo must restore exact pre-scene HTML bytes");
      await shot(page, "creation-canvas-three-undone");
    });

    await scenario("creation-canvas-prototype-subpages", async () => {
      await createFixture(page, base, ownedHome, "Linked prototype pages", {
        "index.html": '<!doctype html><html><head><meta charset="utf-8"></head><body><h1 id="fixture-hero" data-bg-node-id="fixture-hero">Prototype home</h1><a href="pages/%ed%8e%98%ec%9d%b4%ec%a7%80.html#details">서비스 소개</a><a href="missing.html">없는 페이지</a></body></html>',
        "pages/페이지.html": '<!doctype html><html><head><meta charset="utf-8"></head><body><a href="../index.html">홈으로</a><h1 data-bg-node-id="about-heading">서비스 소개 페이지</h1><div style="height:1500px"></div><h2 id="details">서비스 상세</h2><div style="height:900px"></div></body></html>',
      });
      const frame = () => page.frameLocator('iframe[title="캔버스"]');
      await frame().getByRole("link", { name: "서비스 소개", exact: true }).click();
      await frame().getByRole("heading", { name: "서비스 소개 페이지", exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('iframe[title="캔버스"]')?.getAttribute("srcdoc")?.includes("pages/%ed%8e%98%ec%9d%b4%ec%a7%80.html#details"));
      assert.ok(await frame().locator("#details").evaluate((element) => Math.abs(element.getBoundingClientRect().top) < 5), "linked fragment must scroll within the subpage");
      assert.ok((await page.locator('iframe[title="캔버스"]').getAttribute("sandbox")).includes("allow-scripts"));
      assert.ok(!(await page.locator('iframe[title="캔버스"]').getAttribute("sandbox")).includes("allow-same-origin"));
      await shot(page, "creation-canvas-prototype-subpage");
      await frame().getByRole("link", { name: "홈으로", exact: true }).click();
      await frame().getByRole("heading", { name: "Prototype home", exact: true }).waitFor();
      await frame().getByRole("link", { name: "없는 페이지", exact: true }).click();
      await page.getByText("페이지를 열 수 없어요", { exact: true }).waitFor();
      await frame().getByRole("heading", { name: "Prototype home", exact: true }).waitFor();
      await shot(page, "creation-canvas-prototype-home");
    });
  } finally { await page.unroute(eventPattern, guard); }
}

export async function createFixture(page, base, ownedHome, name, pages = {}) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "최근 작업", exact: true }).waitFor();
  const capability = await page.evaluate(async () => (await (await fetch("/api/bootstrap")).json()).data.capability);
  const response = await page.request.post(`${base}/api/projects`, { headers: { "x-burnguard-capability": capability, origin: base }, data: { name, type: "prototype", design_system_id: null, backend_id: "claude-code" } });
  assert.equal(response.status(), 201, "owned fixture project creation failed");
  const project = (await response.json()).data;
  assert.match(project.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  const projectDir = await realpath(path.join(ownedHome, ".burnguard", "data", "projects", project.id));
  assert.ok(projectDir.startsWith(ownedHome + path.sep), "fixture escaped the owned temporary profile");
  await writeFile(path.join(projectDir, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:Arial,sans-serif}h1{margin:32px;padding:32px;font-size:32px}main{height:2600px;background:linear-gradient(#fff,#dde6f4)}</style></head><body><h1 id="fixture-hero" data-bg-node-id="fixture-hero">Canvas fixture heading</h1><main data-bg-node-id="fixture-body">Owned scroll fixture</main></body></html>');
  for (const [relPath, html] of Object.entries(pages)) {
    const target = path.resolve(projectDir, relPath);
    assert.ok(target.startsWith(projectDir + path.sep), "fixture page escaped its project");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, html);
  }
  // The file route reconciles external fixture writes before the UI reads artifact identity.
  assert.equal((await page.request.get(`${base}/api/projects/${project.id}/fs/index.html`)).status(), 200);
  await page.goto(`${base}/projects/${project.id}`, { waitUntil: "domcontentloaded" });
  await page.frameLocator('iframe[title="캔버스"]').locator("#fixture-hero").waitFor();
  const sessionResponse = await page.request.get(`${base}/api/projects/${project.id}/session`);
  assert.equal(sessionResponse.status(), 200);
  return { id: project.id, sessionId: (await sessionResponse.json()).data.id };
}
