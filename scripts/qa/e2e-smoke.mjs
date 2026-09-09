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
//                                       [--shots <dir>] [--keep-home]
// Exit code 0 when every scenario passes, 1 otherwise. Prints a JSON
// summary on the last line so CI can parse it.

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port ?? 14173);
const CHANNEL = args.channel ?? "chrome";
const SHOTS = path.resolve(args.shots ?? path.join(tmpdir(), "burnguard-e2e-shots"));
const BASE = `http://127.0.0.1:${PORT}`;
const READY = `[burnguard] listening on ${BASE}`;
const FIXTURE_PROJECT = "Portfolio Playground";
const CREATED_PROJECT = `E2E Created ${Date.now().toString(36)}`;
const EXPORT_READY_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--paper:#fff;--ink:#111;--accent:#1647d8}*{box-sizing:border-box}html,body{margin:0;background:var(--paper);color:var(--ink);font-family:Arial,sans-serif}.stage{position:relative;min-height:700px;padding:24px}.a,.b{position:absolute;top:100px;width:120px;height:40px}.a{left:24px}.b{left:180px}</style></head><body><main class="stage" data-bg-node-id="ready-stage"><p data-bg-node-id="ready-copy">모든 검사를 통과하는 준비 상태</p><div class="a" data-bg-node-id="ready-a">측정 후보 A</div><div class="b" data-bg-node-id="ready-b">측정 후보 B</div></main></body></html>`;
const SCENARIO_TIMEOUT_MS = 120_000;
const BACKEND_STOP_TIMEOUT_MS = 5_000;
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

try {
  await mkdir(SHOTS, { recursive: true });
  home = await mkdtemp(path.join(tmpdir(), "burnguard-e2e-home-"));
  backend = await startBackend(home);
  browser = await chromium.launch({ headless: true, channel: CHANNEL });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  failurePage = page;
  await installProbes(page);

  await scenario("home-loads", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "최근" }).waitFor({ timeout: 20_000 });
    for (const name of ["내 디자인", "예제", "디자인 시스템"]) {
      await page.getByRole("tab", { name }).waitFor({ timeout: 5_000 });
    }
    await shot(page, "01-home");
  });

  let createdProjectUrl = null;
  await scenario("create-project", async () => {
    await page.getByRole("button", { name: "프로토타입", exact: true }).click();
    const createResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/projects",
    );
    await page.locator("#project-name").fill(CREATED_PROJECT);
    await page.locator("#brief-audience").fill("macOS E2E reviewer");
    await page.locator("#brief-objective").fill("Verify project creation wiring");
    await page.getByRole("button", { name: "만들기", exact: true }).click();
    const response = await createResponse;
    if (!response.ok()) throw new Error(`project creation returned ${response.status()}`);
    const body = await response.json();
    const created = body?.data;
    const projectId = created?.id;
    if (typeof projectId !== "string") throw new Error("project creation response had no project id");
    if (typeof created.dir_path !== "string" || typeof created.entrypoint !== "string") {
      throw new Error("project creation response had no managed file location");
    }
    await page.waitForURL(new RegExp(`/projects/${projectId}(?:[/?]|$)`), { timeout: 20_000 });
    createdProjectUrl = page.url();
    await waitForArtifactFrame(page);
    const detail = await page.request.get(`${BASE}/api/projects/${projectId}`);
    const detailBody = await detail.json();
    if (!detail.ok() || detailBody?.data?.name !== CREATED_PROJECT) {
      throw new Error("created project was not readable through the project API");
    }
    const initialDigest = detailBody.data.current_digest;
    await writeFile(path.join(created.dir_path, created.entrypoint), EXPORT_READY_HTML, "utf8");
    await page.waitForFunction(
      async ({ projectId, initialDigest }) => {
        const response = await fetch(`/api/projects/${projectId}`);
        const body = await response.json();
        return response.ok && body?.data?.current_digest !== initialDigest;
      },
      { projectId, initialDigest },
      { timeout: 20_000 },
    );
    await page.waitForFunction(
      () => document.querySelector("iframe")?.getAttribute("srcdoc")?.includes("모든 검사를 통과하는 준비 상태"),
      undefined,
      { timeout: 20_000 },
    );
    await expectNoErrorToast(page, /프로젝트를 만들지 못했어요/);
    await shot(page, "02-project-created");
  });

  let projectUrl = null;
  await scenario("open-example-project", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    // The seeded "Portfolio Playground" fixture is a plain project (no
    // tutorial tag), so it lives on the 최근 tab, not on 예제.
    await page.getByRole("tab", { name: "최근" }).click();
    const card = page.locator("a[href^='/projects/']").filter({ hasText: FIXTURE_PROJECT }).first();
    await card.waitFor({ timeout: 20_000 });
    await card.click();
    await page.waitForURL(/\/projects\/[^/?]+/, { timeout: 20_000 });
    projectUrl = page.url();
    await waitForArtifactFrame(page);
    for (const label of ["선택", "스타일", "코멘트", "편집", "그리기", "품질 점검"]) {
      await modeButton(page, label).waitFor({ timeout: 10_000 });
    }
    await shot(page, "03-project");
  });

  await scenario("edit-mode-save", async () => {
    const editButton = modeButton(page, "편집");
    await editButton.click();
    await page.waitForFunction(
      () => [...document.querySelectorAll("button")].some((button) =>
        button.textContent?.trim() === "편집" &&
        button.getAttribute("aria-pressed") === "true"
      ),
      undefined,
      { timeout: 10_000 },
    );
    const panel = page.locator("aside").last();
    const textarea = panel.locator("textarea").first();
    const targetRect = await page
      .frameLocator("iframe")
      .locator('[data-bg-node-id="hero-title"]')
      .first()
      .evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      });
    const editOverlay = page.locator(
      'div.absolute.inset-0[style*="cursor: crosshair"]',
    );
    await editOverlay.waitFor({ state: "visible", timeout: 10_000 });
    await editOverlay.click({
      position: {
        x: targetRect.left + Math.min(12, targetRect.width / 2),
        y: targetRect.top + Math.min(12, targetRect.height / 2),
      },
    });
    await textarea.waitFor({ timeout: 10_000 });
    const before = await textarea.inputValue();
    const projectId = new URL(page.url()).pathname.split("/")[2];
    const marker = ` E2E-${Date.now().toString(36)}`;
    await textarea.fill(before + marker);
    const saveResponse = page.waitForResponse((response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname.includes(`/api/projects/${projectId}/fs/`),
    );
    await panel.getByRole("button", { name: /저장/ }).first().click();
    const saved = await saveResponse;
    if (!saved.ok()) throw new Error(`edit save returned ${saved.status()}`);
    // The patch has to reach the managed file, and the canvas has to show it
    // without a manual refresh. Assert the file first: that is what "save"
    // means, and it tells a canvas-refresh regression apart from a lost write.
    const file = await page.request.get(`${BASE}/api/projects/${projectId}/fs/index.html`);
    if (!file.ok() || !(await file.text()).includes(marker.trim())) {
      throw new Error("edit did not reach the managed file");
    }
    await page.waitForFunction(
      (expected) => document.querySelector("iframe")?.getAttribute("srcdoc")?.includes(expected),
      marker.trim(),
      { timeout: 45_000 },
    );
    await page
      .frameLocator("iframe")
      .locator('[data-bg-node-id="hero-title"]')
      .filter({ hasText: marker.trim() })
      .waitFor({ state: "visible", timeout: 20_000 });
    await waitForEditSelectionGeometry(page, "hero-title");
    await expectNoErrorToast(page, /저장하지 못했어요|편집을 저장하지 못했어요/);
    await shot(page, "04-edit-saved");
  });

  await scenario("comment-pin-create", async () => {
    await modeButton(page, "코멘트").click();
    const box = await canvasBox(page);
    const createCommentResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/comments"),
    );
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
    const commentCreated = await createCommentResponse;
    if (!commentCreated.ok()) throw new Error(`comment creation returned ${commentCreated.status()}`);
    const panel = page.locator("aside").last();
    await panel.locator("textarea[placeholder='메모를 남겨 보세요...']").first().waitFor({ timeout: 20_000 });
    // The pin has to exist server-side, not only in React state.
    const projectId = new URL(page.url()).pathname.split("/")[2];
    const comments = await page.request.get(`${BASE}/api/projects/${projectId}/comments`);
    const commentsBody = await comments.json();
    if (!comments.ok() || !Array.isArray(commentsBody?.data) || commentsBody.data.length === 0) {
      throw new Error("comment pin was not persisted");
    }
    await expectNoErrorToast(page, /코멘트를 만들지 못했어요/);
    await shot(page, "05-comment-pin");
  });

  await scenario("draw-stroke-persists", async () => {
    await modeButton(page, "그리기").click();
    const box = await canvasBox(page);
    const x0 = box.x + box.width * 0.3;
    const y0 = box.y + box.height * 0.6;
    const drawResponse = page.waitForResponse((response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname.endsWith("/draws/index.html"),
    );
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(x0 + i * 20, y0 + i * 6);
    await page.mouse.up();
    const drawSaved = await drawResponse;
    if (!drawSaved.ok()) throw new Error(`draw save returned ${drawSaved.status()}`);
    const projectId = new URL(page.url()).pathname.split("/")[2];
    const draw = await page.request.get(`${BASE}/api/projects/${projectId}/draws/index.html`);
    const svg = await draw.text();
    if (!draw.ok() || !/<(path|polyline|line|rect)/.test(svg)) {
      throw new Error("draw sidecar did not contain a stroke");
    }
    await expectNoErrorToast(page, /그리기를 저장하지 못했어요/);
    await shot(page, "06-draw");
  });

  await scenario("html-export-download", async () => {
    if (createdProjectUrl === null) throw new Error("created project URL is unavailable");
    await page.goto(createdProjectUrl, { waitUntil: "domcontentloaded" });
    await page.locator("iframe").first().waitFor({ state: "visible", timeout: 20_000 });
    const projectId = new URL(page.url()).pathname.split("/")[2];
    await page.getByRole("button", { name: "내보내기", exact: true }).click();
    const createExportResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/projects/${projectId}/exports`,
    );
    await page.getByRole("menuitem", { name: /HTML ZIP 파일/ }).click();
    const response = await createExportResponse;
    if (!response.ok()) throw new Error(`export creation returned ${response.status()}`);
    const body = await response.json();
    const exportId = body?.data?.id;
    if (typeof exportId !== "string") throw new Error("export creation response had no export id");
    const link = page.locator(`a[href="/api/exports/${exportId}/download"]`);
    await link.waitFor({ state: "visible", timeout: 30_000 });
    const downloadPromise = page.waitForEvent("download");
    await link.click();
    const download = await downloadPromise;
    await download.saveAs(path.join(SHOTS, "burnguard-e2e-export.zip"));
    await expectNoErrorToast(page, /내보내기를 시작하지 못했어요|내보내기에 실패했어요/);
    await shot(page, "07-export");
  });

  await scenario("delete-project", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "최근" }).click();
    const card = page.locator("a[href^='/projects/']").filter({ hasText: FIXTURE_PROJECT }).first();
    await card.waitFor({ timeout: 20_000 });
    await card.hover();
    await page.getByRole("button", { name: `${FIXTURE_PROJECT} 옵션 메뉴` }).click();
    await page.getByRole("menuitem", { name: /삭제/ }).click();
    const deleteResponse = page.waitForResponse((response) =>
      response.request().method() === "DELETE" &&
      new URL(response.url()).pathname.startsWith("/api/projects/"),
    );
    await page.getByRole("button", { name: "삭제", exact: true }).click();
    const deleted = await deleteResponse;
    if (!deleted.ok()) throw new Error(`project deletion returned ${deleted.status()}`);
    await card.waitFor({ state: "detached", timeout: 15_000 });
    await expectNoErrorToast(page, /삭제하지 못했어요/);
    await shot(page, "08-deleted");
  });
} catch (error) {
  results.push({ name: "harness", ok: false, error: String(error?.stack ?? error) });
} finally {
  if (browser) await browser.close().catch(() => {});
  if (backend) await stopBackend(backend);
  if (home && !args["keep-home"]) await rm(home, { recursive: true, force: true }).catch(() => {});
}

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name} (${r.ms ?? 0} ms)${r.ok ? "" : `  — ${r.error.split("\n")[0]}`}`);
}
await writeFile(path.join(SHOTS, "backend.log"), backendLog).catch(() => {});
console.log(`shots: ${SHOTS}`);
console.log(JSON.stringify({ ok: failed.length === 0, passed: results.length - failed.length, failed: failed.length, results }));
process.exit(failed.length === 0 ? 0 : 1);

// ---------------------------------------------------------------- helpers

async function scenario(name, run) {
  const started = Date.now();
  try {
    await Promise.race([
      run(),
      delay(SCENARIO_TIMEOUT_MS).then(() => { throw new Error(`scenario timed out after ${SCENARIO_TIMEOUT_MS} ms`); }),
    ]);
    results.push({ name, ok: true, ms: Date.now() - started });
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, error: String(error?.stack ?? error) });
    await shot(failurePage, `fail-${name}`);
  }
}

async function startBackend(homeDir) {
  const env = {
    ...process.env,
    USERPROFILE: homeDir,
    HOME: homeDir,
    BG_PORT: String(PORT),
    BG_NO_OPEN: "1",
  };
  const child = spawn("bun", ["run", "src/index.ts"], {
    cwd: path.join(repoRoot, "packages", "backend"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  child.stdout.on("data", (chunk) => {
    backendLog += chunk;
    if (backendLog.includes(READY)) resolveReady();
  });
  child.stderr.on("data", (chunk) => { backendLog += chunk; });
  await Promise.race([
    ready,
    new Promise((_, reject) => child.once("exit", (code) => reject(new Error(`backend exited before readiness (${code})`)))),
    delay(90_000).then(() => { throw new Error(`backend did not become ready on ${BASE}\n${backendLog.slice(-2_000)}`); }),
  ]);
  return child;
}

async function stopBackend(child) {
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", shell: true });
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
  } else {
    child.kill("SIGTERM");
  }
  if (await waitForChildExit(child, BACKEND_STOP_TIMEOUT_MS)) return;
  if (process.platform !== "win32") child.kill("SIGKILL");
  if (!(await waitForChildExit(child, BACKEND_STOP_TIMEOUT_MS))) {
    throw new Error("backend did not exit after forced teardown");
  }
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
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

/** The artifact HTML currently mounted in the canvas, or "" when there is none. */
async function canvasSrcDoc(page) {
  return (await page.locator("iframe").first().getAttribute("srcdoc").catch(() => null)) ?? "";
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
  await page.waitForFunction(
    () => document.querySelector("iframe")?.getAttribute("srcdoc")?.includes("data-bg-node-id"),
    undefined,
    { timeout: 90_000 },
  );
  await page
    .frameLocator("iframe")
    .locator("[data-bg-node-id]")
    .first()
    .waitFor({ state: "visible", timeout: 90_000 });
}

async function waitForEditSelectionGeometry(page, bgId) {
  const iframeBox = await page.locator("iframe").first().boundingBox();
  const target = await page
    .frameLocator("iframe")
    .locator(`[data-bg-node-id="${bgId}"]`)
    .first()
    .evaluate((node) => {
      const elementRect = node.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(node);
      const tight = range.getBoundingClientRect();
      const rect = tight.width > 0 &&
        tight.height > 0 &&
        elementRect.width - tight.width > 4
        ? tight
        : elementRect;
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    });
  if (!iframeBox) throw new Error("artifact iframe geometry is unavailable");
  const expected = {
    x: iframeBox.x + target.x,
    y: iframeBox.y + target.y,
    width: target.width,
    height: target.height,
  };
  await page.waitForFunction(
    (next) => {
      const overlays = [...document.querySelectorAll(
        "div.absolute.pointer-events-none.border-2",
      )];
      const overlay = overlays.at(-1)?.getBoundingClientRect();
      if (!overlay) return false;
      return Math.max(
        Math.abs(overlay.x - next.x),
        Math.abs(overlay.y - next.y),
        Math.abs(overlay.width - next.width),
        Math.abs(overlay.height - next.height),
      ) <= 1;
    },
    expected,
    { timeout: 20_000 },
  );
}

async function shot(page, name) {
  if (!page) return;
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
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
