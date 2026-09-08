import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const PROJECT = "review-canvas-project";
const SESSION = "review-canvas-session";
const SYSTEM = "review-canvas-system";
const AUTHORITY = "review-canvas-fixture-authority";
const AT = 1_700_000_000_000;
const DIGEST = "c".repeat(64);
const CSS = "/* REVIEW_CURRENT_CSS */\n.review-preview { color: #123456; }\n";
const LATE_CSS = "/* REVIEW_STALE_CSS_MUST_NOT_REPLACE_IMAGE */";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

/** Actual canvas/preview DOM and native fetch cancellation; all API bytes are synthetic. */
export async function runReviewCanvasFixtures(page, context, base, scenario) {
  assert.equal(page.context(), context, "canvas fixtures require the caller's existing browser context");
  const receipts = [];
  const state = { shortCount: 10, slowRequested: null, releaseSlow: null, finishSlow: null, heldSlow: false };
  const viewport = page.viewportSize();
  const routePattern = `${base}/api/**`;
  const routeHandler = async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const ok = (data) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) });
    const missing = () => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "fixture_route_missing", message: "Synthetic fixture route unavailable" } }) });
    if (pathname === "/api/bootstrap") return ok({ capability: AUTHORITY });
    if (pathname === "/api/settings") return ok({ user: { id: "local", display_name: "검토 사용자" }, app_version: "fixture", default_backend: "claude-code", theme: "light", chat_abort_threshold_ms: 300_000, chat_context_mode: "compact", figma_token_set: false });
    if (pathname === "/api/projects") return ok([projectFixture()]);
    if (pathname === "/api/design-systems") return ok([systemFixture()]);
    if (pathname === `/api/design-systems/${SYSTEM}`) return ok(systemFixture());
    if (pathname === `/api/design-systems/${SYSTEM}/tokens`) return ok({ system_id: SYSTEM, colors: [], token_file_path: null });
    if (pathname === `/api/design-systems/${SYSTEM}/previews`) return ok([]);
    if (pathname === `/api/projects/${PROJECT}`) return ok(projectFixture());
    if (pathname === `/api/projects/${PROJECT}/session`) return ok(sessionFixture());
    if (pathname === `/api/projects/${PROJECT}/artifacts`) return ok({ project_id: PROJECT, entrypoint: "long.html", entrypoint_url: `/api/projects/${PROJECT}/fs/long.html`, design_system_id: SYSTEM, design_system_url: null, file_count: 5, current_revision: 1, current_digest: DIGEST, updated_at: AT });
    if (pathname === `/api/projects/${PROJECT}/files`) return ok(fileFixtures(state.shortCount));
    if (pathname === `/api/projects/${PROJECT}/comments`) return ok(commentFixtures());
    if (pathname === `/api/projects/${PROJECT}/exports`) return ok([]);
    if ([`/api/projects/${PROJECT}/design-directions`, `/api/projects/${PROJECT}/design-audit`].includes(pathname)) return ok(null);
    if (pathname === `/api/sessions/${SESSION}/snapshot`) return ok({ session: sessionFixture(), sequence: 0, pending_permissions: [] });
    if (pathname === `/api/sessions/${SESSION}/events`) return ok([]);
    // These scenarios do not exercise chat/stream readiness. HTTP 204 tells the
    // browser's real EventSource not to reconnect to a finite synthetic stream.
    if (pathname === `/api/sessions/${SESSION}/stream`) return route.fulfill({ status: 204 });
    if (pathname.startsWith(`/api/projects/${PROJECT}/draws/`)) return route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    const prefix = `/api/projects/${PROJECT}/fs/`;
    if (pathname.startsWith(prefix)) {
      assert.equal(request.headers()["x-burnguard-capability"], AUTHORITY, "file fixture lost launch authority");
      const path = decodeURIComponent(pathname.slice(prefix.length));
      if (path.endsWith("/undo-info")) return ok({ can_undo: false, stored_at: null });
      if (path === "slow.css" && state.heldSlow) {
        const gate = new Promise((resolve) => { state.releaseSlow = resolve; });
        state.slowRequested?.();
        await gate;
        try {
          await route.fulfill({ status: 200, contentType: "text/css", body: LATE_CSS });
        } catch (error) {
          // The native fetch is deliberately cancelled before this delayed
          // response is released. Suppress only that cancelled-request case.
          if (!request.failure()) throw error;
        } finally { state.finishSlow?.(); }
        return;
      }
      const content = fileContents(path, state.shortCount);
      if (!content) return missing();
      return route.fulfill({ status: 200, contentType: content.mime, headers: { "cache-control": "no-store", "x-burnguard-file-hash": hash(content.body), "x-burnguard-revision": "1", "x-burnguard-artifact-digest": DIGEST }, body: content.body });
    }
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
  let registered = false;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route(routePattern, routeHandler);
    registered = true;
    await page.goto(`${base}/projects/${PROJECT}`, { waitUntil: "domcontentloaded" });
    await activeSlide(page, "long.html", 0);

    await run("review-R26-file-slide-restore-clamp-comments", async () => {
      // Establish both tabs first: Design Files intentionally unmounts Canvas.
      await page.getByRole("button", { name: "디자인 파일", exact: true }).click();
      await page.locator("nav").getByRole("button", { name: /^short\.html(?:\s|$)/ }).click();
      await activeSlide(page, "short.html", 0);
      const frame = page.frameLocator('iframe[title="캔버스"]');
      await frame.getByRole("button", { name: "마지막 장", exact: true }).click();
      await activeSlide(page, "short.html", 9);
      await correctComment(page, "short-nine");
      await page.getByRole("button", { name: "long.html", exact: true }).click();
      await activeSlide(page, "long.html", 0);
      await frame.getByRole("button", { name: "마지막 장", exact: true }).click();
      await activeSlide(page, "long.html", 9);
      await correctComment(page, "long-nine");

      // The remembered short-file index is now outside its new three-slide DOM.
      state.shortCount = 3;
      await page.getByRole("button", { name: "short.html", exact: true }).click();
      await activeSlide(page, "short.html", 2);
      await correctComment(page, "short-two");
      await frame.getByRole("button", { name: "이전 장", exact: true }).click();
      await activeSlide(page, "short.html", 1);
      await correctComment(page, "short-one");
      await page.getByRole("button", { name: "long.html", exact: true }).click();
      await activeSlide(page, "long.html", 9);
      await correctComment(page, "long-nine");
      await page.getByRole("button", { name: "short.html", exact: true }).click();
      await activeSlide(page, "short.html", 1);
      await correctComment(page, "short-one");
    });

    await run("review-R31-css-and-png-real-preview", async () => {
      await page.getByRole("button", { name: "디자인 파일", exact: true }).click();
      await selectPreviewFile(page, "styles.css");
      await page.locator("pre").filter({ hasText: "REVIEW_CURRENT_CSS" }).waitFor();
      assert.equal(await page.locator("pre").filter({ hasText: "REVIEW_CURRENT_CSS" }).textContent(), CSS);
      assert.equal(await page.locator('iframe[title="캔버스"]').count(), 0, "CSS was opened as an HTML canvas instead of a source preview");
      await selectPreviewFile(page, "pixel.png");
      await decodedPng(page);
      assert.equal(await page.locator("pre").filter({ hasText: "REVIEW_CURRENT_CSS" }).count(), 0, "previous text remained under the image header");
    });

    await run("review-R31-superseded-preview-native-abort", async () => {
      state.heldSlow = true;
      const requested = new Promise((resolve) => { state.slowRequested = resolve; });
      const finished = new Promise((resolve) => { state.finishSlow = resolve; });
      const aborted = page.waitForEvent("requestfailed", { predicate: (request) => new URL(request.url()).pathname === `/api/projects/${PROJECT}/fs/slow.css`, timeout: 20_000 });
      // Attach a rejection handler immediately so a failed preceding DOM action
      // cannot leave an unhandled requestfailed timeout during outer cleanup.
      void aborted.catch(() => {});
      await selectPreviewFile(page, "slow.css");
      await requested;
      await page.getByRole("status").filter({ hasText: "파일을 불러오고 있어요." }).waitFor();
      await selectPreviewFile(page, "pixel.png");
      await decodedPng(page);
      state.releaseSlow();
      const failed = await aborted;
      assert.match(failed.failure()?.errorText ?? "", /abort|cancel/i, "superseded preview did not cancel its native network request");
      await finished;
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await decodedPng(page);
      assert.equal(await page.locator("pre").filter({ hasText: "REVIEW_STALE_CSS_MUST_NOT_REPLACE_IMAGE" }).count(), 0, "late response replaced the currently selected image");
    });
  } finally {
    state.releaseSlow?.();
    await page.goto("about:blank").catch(() => {});
    if (registered) await page.unroute(routePattern, routeHandler);
    if (viewport) await page.setViewportSize(viewport);
  }
  return receipts;
}

async function activeSlide(page, file, index) {
  const frame = page.frameLocator('iframe[title="캔버스"]');
  await frame.locator(`body[data-review-deck="${file}"] [data-slide][data-review-index="${index}"][data-active]`).waitFor();
  assert.equal(await frame.locator("[data-slide][data-active]").count(), 1, "fixture deck has more than one active slide");
}

async function correctComment(page, name) {
  await page.locator(`button[title="review-comment-${name}"]`).waitFor();
  assert.equal(await page.locator('button[title^="review-comment-"]').count(), 1, "comment pin filtering disagrees with the active file/slide");
}

async function selectPreviewFile(page, file) {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.locator("nav").getByRole("button", { name: new RegExp(`^${escaped}(?:\\s|$)`) }).click();
}

async function decodedPng(page) {
  await page.getByRole("img", { name: "pixel.png", exact: true }).waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector('img[alt="pixel.png"]');
    return image?.complete && image.naturalWidth === 1 && image.naturalHeight === 1 && image.src.startsWith("blob:");
  });
}

function deck(file, count) {
  const slides = Array.from({ length: count }, (_, index) => `<section data-slide data-review-index="${index}"${index === 0 ? " data-active" : ""}><h1>${file}: ${index + 1}</h1></section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:24px sans-serif}section{display:none;padding:100px}section[data-active]{display:block}nav{position:fixed;right:16px;top:16px;display:flex;gap:12px}button{padding:12px}</style></head><body data-review-deck="${file}"><nav><button id="previous">이전 장</button><button id="last">마지막 장</button></nav>${slides}<script>(()=>{const slides=[...document.querySelectorAll('[data-slide]')];const index=()=>Math.max(0,Math.min(slides.length-1,Number(location.hash.replace('#slide-',''))-1||0));const apply=()=>slides.forEach((slide,i)=>slide.toggleAttribute('data-active',i===index()));window.addEventListener('hashchange',apply);document.querySelector('#last').onclick=()=>{location.hash='#slide-'+slides.length;apply()};document.querySelector('#previous').onclick=()=>{location.hash='#slide-'+Math.max(1,index());apply()};apply()})()</script></body></html>`;
}

function fileContents(file, shortCount) {
  if (file === "long.html") return { mime: "text/html; charset=utf-8", body: deck(file, 10) };
  if (file === "short.html") return { mime: "text/html; charset=utf-8", body: deck(file, shortCount) };
  if (file === "styles.css") return { mime: "text/css; charset=utf-8", body: CSS };
  if (file === "slow.css") return { mime: "text/css; charset=utf-8", body: LATE_CSS };
  if (file === "pixel.png") return { mime: "image/png", body: PNG };
  return null;
}
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function fileFixtures(shortCount) {
  return [["long.html", "html"], ["short.html", "html"], ["styles.css", "stylesheet"], ["slow.css", "stylesheet"], ["pixel.png", "asset"]].map(([rel_path, category]) => {
    const content = fileContents(rel_path, shortCount);
    return { rel_path, category, hash: hash(content.body), size_bytes: Buffer.byteLength(content.body), updated_at: AT };
  });
}
function commentFixtures() {
  return [["long.html", 0, "long-zero"], ["long.html", 9, "long-nine"], ["short.html", 0, "short-zero"], ["short.html", 1, "short-one"], ["short.html", 2, "short-two"], ["short.html", 9, "short-nine"]].map(([rel_path, slide_index, name]) => ({ id: name, project_id: PROJECT, rel_path, node_selector: `[data-review-index="${slide_index}"]`, x_pct: 30, y_pct: 45, slide_index, body: `review-comment-${name}`, author_id: "fixture", artifact_revision: 1, artifact_digest: DIGEST, resolved_at: null, created_at: AT, updated_at: AT }));
}
function projectFixture() { return { id: PROJECT, name: "캔버스 회귀 검토", type: "prototype", design_system_id: SYSTEM, design_system_name: "검토 시스템", thumbnail_path: null, updated_at: AT, archived_at: null, dir_path: "fixture-project", entrypoint: "long.html", backend_id: "claude-code", options_json: null, current_revision: 1, current_digest: DIGEST }; }
function sessionFixture() { return { id: SESSION, project_id: PROJECT, backend_id: "claude-code", status: "idle", usage: { input: 0, output: 0, cached: 0, cache_write: 0 }, updated_at: AT, last_active_at: AT }; }
function systemFixture() { return { id: SYSTEM, name: "검토 시스템", description: "브라우저 회귀 검증용 합성 자료", status: "published", source_type: "manual", source_uri: null, dir_path: "fixture-system", skill_md_path: null, tokens_css_path: null, readme_md_path: null, archived_at: null, is_template: false, thumbnail_path: null, kind: "design-system", owner: "local", lifecycle: "active", provenance: "observed", license: "unknown", tags: [], metadata_revision: 1, content: { revision: 1, receipt_id: null, digest: DIGEST }, lineage: null, preview: null, usage: [], warning: null, created_at: AT, updated_at: AT }; }
