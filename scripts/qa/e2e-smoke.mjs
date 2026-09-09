#!/usr/bin/env node
// End-to-end smoke for the BurnGuard core loop, driven from Node with
// playwright-core and a real Chrome/Edge channel.
//
// Why Node and not Bun: on Windows the Playwright transport never
// connects under Bun (see doc/08-review-and-improvement-plan-2026-09-02.md,
// T3), so the driver runs on Node while the backend under test still runs
// on Bun exactly as users run it.
//
// Usage:  node scripts/qa/e2e-smoke.mjs [--port 14173] [--channel chrome|msedge]
//                                       [--shots <dir>] [--keep-home] [--bun <bun.exe>]
//                                       [--only review-R26] (independent review fixtures)
// Exit code 0 when every scenario passes, 1 otherwise. Prints a JSON
// summary on the last line so CI can parse it.

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runReviewUiFixtures } from "./review-ui-fixtures.mjs";
import { runReviewCanvasFixtures } from "./review-canvas-fixtures.mjs";
import { runUiRedesignFixtures } from "./ui-redesign-fixtures.mjs";
import { runCreationCanvasFixtures } from "./creation-canvas-fixtures.mjs";
import { runSettingsRedesignFixtures } from "./settings-redesign-fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port ?? 14173);
const CHANNEL = args.channel ?? "chrome";
const SHOTS = path.resolve(args.shots ?? path.join(tmpdir(), "burnguard-e2e-shots"));
const BASE = `http://127.0.0.1:${PORT}`;
const READY = `[burnguard] listening on ${BASE}`;
const FIXTURE_PROJECT = "Portfolio Playground";
const SCENARIO_TIMEOUT_MS = 120_000;
let backendLog = "";

const { chromium } = await import(
  pathToFileURL(path.join(repoRoot, "packages", "backend", "node_modules", "playwright-core", "index.mjs")).href
);

const results = [];
let backend = null;
let browser = null;
let home = null;
/** Set once the page exists so a failing scenario can capture what it saw. */
let failurePage = null;
const temporaryParent = await realpath(tmpdir());

try {
  await mkdir(SHOTS, { recursive: true });
  home = await mkdtemp(path.join(temporaryParent, "burnguard-e2e-home-"));
  backend = await startBackend(home);
  browser = await chromium.launch({ headless: true, channel: CHANNEL });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  failurePage = page;
  await installProbes(page);


  await scenario("home-loads", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "최근 작업", exact: true }).waitFor({ timeout: 20_000 });
    for (const name of ["내 프로젝트", "예제", "디자인 시스템"]) {
      await page.getByRole("tab", { name }).waitFor({ timeout: 5_000 });
    }
    await shot(page, "01-home");
  });

  let projectUrl = null;
  await scenario("open-example-project", async () => {
    // The seeded "Portfolio Playground" fixture is a plain project (no
    // tutorial tag), so it lives on the 최근 tab, not on 예제.
    await page.getByRole("tab", { name: "최근 작업", exact: true }).click();
    const card = page.locator("a[href^='/projects/']").filter({ hasText: FIXTURE_PROJECT }).first();
    await card.waitFor({ timeout: 20_000 });
    await card.click();
    await page.waitForURL(/\/projects\/[^/?]+/, { timeout: 20_000 });
    projectUrl = page.url();
    await waitForArtifactFrame(page);
    for (const label of ["선택", "스타일", "코멘트", "편집", "그리기", "품질 점검"]) {
      await modeButton(page, label).waitFor({ timeout: 10_000 });
    }
    await shot(page, "02-project");
  });

  await scenario("edit-mode-save", async () => {
    await modeButton(page, "편집").click();
    // The canvas is a sandboxed srcdoc frame, which a driver cannot reliably
    // query from the outside, so the click is aimed by geometry and the
    // assertions read the srcdoc attribute instead of the frame's DOM.
    const box = await canvasBox(page);
    const panel = page.locator("aside").last();
    const textarea = panel.locator("textarea").first();
    // Only elements the harness annotated are editable, and where they land
    // depends on the fixture and on font loading, so sweep the canvas instead
    // of assuming one point hits.
    let opened = false;
    for (const fy of [0.25, 0.4, 0.12, 0.55, 0.7, 0.85]) {
      for (const fx of [0.5, 0.3, 0.7]) {
        await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
        opened = await textarea.waitFor({ timeout: 1_500 }).then(() => true, () => false);
        if (opened) break;
      }
      if (opened) break;
    }
    if (!opened) throw new Error("edit panel never opened for any canvas position");
    const before = await textarea.inputValue();
    const marker = ` E2E-${Date.now().toString(36)}`;
    await textarea.fill(before + marker);
    const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/fs/"));
    await panel.getByRole("button", { name: /저장/ }).first().click();
    await requireSuccess(await saved, "edit");
    await expectNoErrorToast(page, /저장하지 못했어요|편집을 저장하지 못했어요/);
    // The patch has to reach the managed file, and the canvas has to show it
    // without a manual refresh. Assert the file first: that is what "save"
    // means, and it tells a canvas-refresh regression apart from a lost write.
    const projectId = new URL(page.url()).pathname.split("/")[2];
    const res = await page.request.get(`${BASE}/api/projects/${projectId}/fs/index.html`);
    if (!res.ok() || !(await res.text()).includes(marker.trim())) throw new Error("edit did not reach the managed file");
    await page.waitForFunction((text) => document.querySelector("iframe")?.getAttribute("srcdoc")?.includes(text), marker.trim(), { timeout: 45_000 });
    await shot(page, "03-edit-saved");
  });

  await scenario("comment-pin-create", async () => {
    await modeButton(page, "코멘트").click();
    const box = await canvasBox(page);
    const created = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/comments"));
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
    await requireSuccess(await created, "comment");
    await expectNoErrorToast(page, /코멘트를 만들지 못했어요/);
    const panel = page.locator("aside").last();
    await panel.locator("textarea[placeholder='메모를 남겨 보세요...']").first().waitFor({ timeout: 20_000 });
    // The pin has to exist server-side, not only in React state.
    const projectId = new URL(page.url()).pathname.split("/")[2];
    const res = await page.request.get(`${BASE}/api/projects/${projectId}/comments`);
    const body = await res.json();
    if (!res.ok() || !Array.isArray(body.data) || body.data.length === 0) throw new Error("comment pin was not persisted");
    await shot(page, "04-comment-pin");
  });

  await scenario("draw-stroke-persists", async () => {
    await modeButton(page, "그리기").click();
    const box = await canvasBox(page);
    const x0 = box.x + box.width * 0.3;
    const y0 = box.y + box.height * 0.6;
    const saved = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes("/draws/"));
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(x0 + i * 20, y0 + i * 6);
    await page.mouse.up();
    await requireSuccess(await saved, "draw");
    await expectNoErrorToast(page, /그리기를 저장하지 못했어요/);
    const projectId = new URL(page.url()).pathname.split("/")[2];
    const res = await page.request.get(`${BASE}/api/projects/${projectId}/draws/index.html`);
    if (!res.ok() || !/<(path|polyline|line|rect)/.test(await res.text())) throw new Error("draw sidecar did not contain a stroke");
    await shot(page, "05-draw");
  });

  await scenario("draw-undo-redo-persists", async () => {
    const projectId = new URL(page.url()).pathname.split("/")[2];
    const drawUrl = `${BASE}/api/projects/${projectId}/draws/index.html`;
    const before = await (await page.request.get(drawUrl)).text();
    const responseForDraw = () => page.waitForResponse((response) => response.url() === drawUrl && response.request().method() === "PUT");
    let response = responseForDraw();
    await page.getByRole("button", { name: "실행 취소", exact: true }).click();
    if (!(await response).ok()) throw new Error("undo did not persist");
    const undone = await (await page.request.get(drawUrl)).text();
    if (undone === before) throw new Error("undo left the saved stroke unchanged");
    response = responseForDraw();
    await page.getByRole("button", { name: "다시 실행", exact: true }).click();
    if (!(await response).ok()) throw new Error("redo did not persist");
    const redone = await (await page.request.get(drawUrl)).text();
    if (redone !== before) throw new Error("redo did not restore the saved stroke");
    await shot(page, "06-draw-redo");
  });

  await scenario("tweaks-escape-enter", async () => {
    await modeButton(page, "스타일").click();
    const box = await canvasBox(page);
    const input = page.locator("aside").last().getByLabel("font-size", { exact: false });
    let opened = false;
    for (const fy of [0.25, 0.4, 0.12, 0.55, 0.7, 0.85]) {
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * fy);
      if (await input.waitFor({ timeout: 1000 }).then(() => true, () => false)) { opened = true; break; }
    }
    if (!opened) throw new Error("style element selection failed");
    const writes = [];
    const onRequest = (request) => { if (request.method() === "PATCH" && request.url().includes("/fs/")) writes.push(request); };
    page.on("request", onRequest);
    try {
      await input.fill("43");
      await input.press("Escape");
      await page.evaluate(() => new Promise(requestAnimationFrame));
      if (writes.length !== 0) throw new Error("Escape unexpectedly saved a style");
      await input.fill("42");
      const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/fs/"));
      await input.press("Enter");
      await requireSuccess(await saved, "style");
      await input.waitFor({ state: "visible" });
      await page.evaluate(() => new Promise(requestAnimationFrame));
      if (writes.length !== 1) throw new Error(`Enter produced ${writes.length} writes`);
    } finally { page.off("request", onRequest); }
    await shot(page, "07-style-saved");
  });

  await scenario("responsive-home-and-keyboard", async () => {
    for (const width of [1024, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.getByRole("tab", { name: "최근 작업", exact: true }).waitFor();
      const create = page.getByRole("button", { name: "새 프로젝트", exact: true });
      await create.waitFor();
      if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error(`Home overflows at ${width}px`);
      await shot(page, `08-home-${width}`);
      await create.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "새 프로젝트 만들기" });
      await dialog.waitFor();
      await dialog.getByLabel("프로젝트 이름", { exact: true }).waitFor();
      if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error(`Home overflows at ${width}px`);
      await shot(page, `08-create-${width}`);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "새 프로젝트");
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await runUiRedesignFixtures(page, BASE, scenario, { home, shot, fixtureProjectName: FIXTURE_PROJECT });

  await scenario("delete-project", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "최근 작업", exact: true }).click();
    const card = page.locator("a[href^='/projects/']").filter({ hasText: FIXTURE_PROJECT }).first();
    await card.waitFor({ timeout: 20_000 });
    await card.hover();
    await page.getByRole("button", { name: `${FIXTURE_PROJECT} 옵션 메뉴` }).click();
    await page.getByRole("menuitem", { name: /삭제/ }).click();
    const removed = page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().includes("/api/projects/"));
    await page.getByRole("button", { name: "삭제", exact: true }).click();
    await requireSuccess(await removed, "delete");
    await expectNoErrorToast(page, /삭제하지 못했어요/);
    await card.waitFor({ state: "detached", timeout: 15_000 });
    await shot(page, "06-deleted");
  });
  await runReviewUiFixtures(page, context, BASE, scenario);
  await runReviewCanvasFixtures(page, context, BASE, scenario);
  await runSettingsRedesignFixtures(page, BASE, scenario);
  await runCreationCanvasFixtures(page, BASE, scenario, { home, shot });
} catch (error) {
  results.push({ name: "harness", ok: false, error: String(error?.stack ?? error) });
} finally {
  if (browser) await browser.close().catch(() => {});
  if (backend) await stopBackend(backend);
  if (home && !args["keep-home"]) {
    const ownedHome = await realpath(home);
    if (path.dirname(ownedHome) !== temporaryParent || !path.basename(ownedHome).startsWith("burnguard-e2e-home-")) throw new Error("Refusing unowned fixture cleanup");
    await rm(ownedHome, { recursive: true, force: true });
  }
}

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name} (${r.ms ?? 0} ms)${r.ok ? "" : `  — ${r.error.split("\n")[0]}`}`);
}
await writeFile(path.join(SHOTS, "backend.log"), backendLog).catch(() => {});
console.log(`shots: ${SHOTS}`);
console.log(JSON.stringify({ ok: failed.length === 0, selection: args.only ?? null, passed: results.length - failed.length, failed: failed.length, results }));
process.exit(failed.length === 0 ? 0 : 1);

// ---------------------------------------------------------------- helpers

async function scenario(name, run) {
  if (args.only && !name.includes(String(args.only))) return;
  const started = Date.now();
  let deadline;
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error(`scenario timed out after ${SCENARIO_TIMEOUT_MS} ms`)), SCENARIO_TIMEOUT_MS); }),
    ]);
    if (name.startsWith("review-")) await shot(failurePage, name);
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(JSON.stringify(results.at(-1)));
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, error: String(error?.stack ?? error) });
    console.log(JSON.stringify({ ...results.at(-1), error: String(error.message) }));
    await shot(failurePage, `fail-${name}`).catch(() => {});
  } finally {
    clearTimeout(deadline);
  }
}

async function startBackend(homeDir) {
  const env = {
    ...process.env,
    BG_APP_ROOT: path.join(homeDir, ".burnguard"),
    CODEX_HOME: path.join(homeDir, ".codex"),
    BG_PORT: String(PORT),
    BG_NO_OPEN: "1",
  };
  const child = spawn(args.bun ?? "bun", ["run", "src/index.ts"], {
    cwd: path.join(repoRoot, "packages", "backend"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let deadline;
  try {
    await new Promise((resolve, reject) => {
      deadline = setTimeout(() => reject(new Error("backend readiness timeout")), 90_000);
      child.once("error", reject);
      child.once("exit", () => reject(new Error("backend exited before readiness")));
      child.stdout.on("data", (chunk) => { backendLog += chunk; if (backendLog.includes(READY)) resolve(); });
      child.stderr.on("data", (chunk) => { backendLog += chunk; });
    });
  } catch (error) {
    await stopBackend(child);
    throw error;
  } finally {
    clearTimeout(deadline);
  }
  return child;
}

async function stopBackend(child) {
  if (child.exitCode !== null || !child.pid) return;
  const exited = once(child, "exit");
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    await withDeadline(once(killer, "exit"), 15_000, () => killer.kill());
  } else {
    child.kill("SIGTERM");
  }
  await withDeadline(exited, 15_000);
}

async function withDeadline(promise, milliseconds, onTimeout = () => {}) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => { onTimeout(); reject(new Error("Owned process cleanup timed out")); }, milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function installProbes(page) {
  await page.addInitScript(() => {
    window.__bgToasts = [];
    const seen = new WeakSet();
    const observer = new MutationObserver(() => {
      for (const node of document.querySelectorAll("div.fixed.bottom-4.right-4 > div")) {
        if (seen.has(node)) continue;
        seen.add(node);
        window.__bgToasts.push(node.innerText);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

async function expectNoErrorToast(page, pattern) {
  const toasts = await page.evaluate(() => window.__bgToasts ?? []);
  const hit = toasts.find((t) => pattern.test(t));
  if (hit) throw new Error(`error toast: ${hit.replace(/\n/g, " | ")}`);
}

/**
 * Canvas mode buttons only. "코멘트" also names a tab in the chat pane, so the
 * bare role query is ambiguous; scope it to the canvas toolbar above the
 * iframe.
 */
function modeButton(page, label) {
  return page.locator("div").filter({ has: page.getByRole("button", { name: "품질 점검", exact: true }) }).last()
    .getByRole("button", { name: label, exact: true });
}

async function canvasBox(page) {
  const box = await page.locator("iframe").first().boundingBox();
  if (!box) throw new Error("canvas iframe has no bounding box");
  return box;
}

async function waitForArtifactFrame(page) {
  // Generous on purpose: the first project opened after a fresh install shares
  // the backend with background thumbnail renders, and on a host where
  // Chromium cannot launch those burn their full timeout before the cooldown
  // engages.
  await page.waitForFunction(() => document.querySelector("iframe")?.getAttribute("srcdoc")?.includes("data-bg-node-id"), null, { timeout: 90_000 });
}

async function requireSuccess(response, operation) {
  if (!response.ok()) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`${operation} failed: ${response.status()} ${body.error?.code ?? "unknown"}`);
  }
}

async function shot(page, name) {
  if (!page) return;
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key.slice(2)] = true;
    else { out[key.slice(2)] = next; i += 1; }
  }
  return out;
}
