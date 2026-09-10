// Deliverables and platform-publishing fixtures (doc/14 sections 8-9). Runs only
// against e2e-smoke's owned temporary profile: one owned multi-page project for
// navigation, and the seeded "VELUNE · Web" sample for a real Cafe24 package export.
import assert from "node:assert/strict";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { createFixture } from "./creation-canvas-fixtures.mjs";

// e2e-smoke deletes its own fixture sample (VELUNE · Web) before these run.
const SAMPLE_WEB = "ODDWARD · Web";
const CAFE24_LABEL = "카페24 스마트디자인 패키지";

export async function runDeliverablesFixtures(page, base, scenario, { home, shot }) {
  const ownedHome = await realpath(home);
  assert.ok(path.basename(ownedHome).startsWith("burnguard-e2e-home-"), "deliverables fixtures require an owned E2E home");
  const frame = () => page.frameLocator('iframe[title="캔버스"]');

  await scenario("deliverables-multipage-dropdown-and-dir-index", async () => {
    const nav = '<nav data-bg-shared="nav"><a href="index.html">홈</a><a href="about.html">소개</a><a href="docs/">문서</a></nav>';
    await createFixture(page, base, ownedHome, "Deliverables multi-page site", {
      "index.html": `<!doctype html><html><head><meta charset="utf-8"><title>홈</title></head><body><header data-bg-shared="header">${nav}</header><main data-bg-content><h1 id="fixture-hero" data-bg-node-id="fixture-hero">멀티페이지 홈</h1></main></body></html>`,
      "about.html": `<!doctype html><html><head><meta charset="utf-8"><title>소개</title></head><body><header data-bg-shared="header">${nav}</header><main data-bg-content><h1 data-bg-node-id="about-heading">소개 페이지</h1></main></body></html>`,
      "docs/index.html": `<!doctype html><html><head><meta charset="utf-8"><title>문서</title></head><body><header data-bg-shared="header"><nav data-bg-shared="nav"><a href="../index.html">홈</a><a href="../about.html">소개</a><a href="./">문서</a></nav></header><main data-bg-content><h1 data-bg-node-id="docs-heading">문서 페이지</h1></main></body></html>`,
    });
    // The derived site map feeds the page dropdown: home first, then nav order.
    const select = page.getByLabel("캔버스 페이지", { exact: true });
    await select.waitFor({ timeout: 20_000 });
    assert.deepEqual(await select.locator("option").evaluateAll((options) => options.map((option) => option.value)), ["index.html", "about.html", "docs/index.html"]);
    await select.selectOption("about.html");
    await frame().getByRole("heading", { name: "소개 페이지", exact: true }).waitFor();
    await page.getByText("보고 있는 페이지: about.html", { exact: true }).waitFor();
    // A directory-style link resolves to dir/index.html inside the sandbox.
    await frame().getByRole("link", { name: "문서", exact: true }).click();
    await frame().getByRole("heading", { name: "문서 페이지", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('iframe[title="캔버스"]')?.getAttribute("srcdoc")?.includes("docs/index.html"));
    await page.getByText("보고 있는 페이지: docs/index.html", { exact: true }).waitFor();
    assert.equal(await select.inputValue(), "docs/index.html");
    await shot(page, "deliverables-multipage-dir-index");
  });

  let sampleId = null;
  await scenario("deliverables-cafe24-package-export", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "최근 작업", exact: true }).click();
    const card = page.locator("a[href^='/projects/']").filter({ hasText: SAMPLE_WEB }).first();
    await card.waitFor({ timeout: 20_000 });
    await card.click();
    await page.waitForURL(/\/projects\/[^/?]+/, { timeout: 20_000 });
    sampleId = new URL(page.url()).pathname.split("/").pop();
    await page.locator('iframe[title="캔버스"]').waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "내보내기", exact: true }).click();
    const item = page.getByRole("menuitem", { name: new RegExp(`^${CAFE24_LABEL}`) });
    await item.waitFor({ timeout: 10_000 });
    assert.ok(!(await item.getAttribute("aria-disabled")) || (await item.getAttribute("aria-disabled")) === "false", "cafe24 package must be available for a web project");
    await item.click();
    // The real pipeline runs: audit, closure, site map, lint, smoke render, rewrite, zip, validate.
    // The status row labels its actions with the format's short label, so match the action suffix.
    const guideButton = page.getByRole("button", { name: /설치 가이드 보기$/ }).first();
    await guideButton.waitFor({ timeout: 110_000 });
    await page.getByRole("button", { name: /다운로드$/ }).first().waitFor();
    await guideButton.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await dialog.getByText("카페24 스마트디자인 설치 가이드", { exact: true }).waitFor();
    await dialog.getByText("documentation-tested").first().waitFor();
    await shot(page, "deliverables-cafe24-guide");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    const jobs = await page.request.get(`${base}/api/projects/${sampleId}/exports`);
    assert.equal(jobs.status(), 200);
    const job = (await jobs.json()).data.find((entry) => entry.format === "cafe24_package");
    assert.ok(job, "cafe24 export job must exist");
    assert.equal(job.status, "succeeded");
    assert.ok(job.size_bytes > 0, "package must have bytes");
  });

  await scenario("deliverables-quality-panel-settles", async () => {
    assert.ok(sampleId, "sample project id from the export scenario");
    await page.goto(`${base}/projects/${sampleId}`, { waitUntil: "domcontentloaded" });
    await page.locator('iframe[title="캔버스"]').waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "품질 점검", exact: true }).click();
    const status = page.getByRole("status").filter({ hasText: /검사|결과|문제|개선/ }).first();
    await status.waitFor({ timeout: 10_000 });
    // The panel must leave every "검사하고 있어요" state and settle on a terminal copy.
    await page.waitForFunction(() => {
      const nodes = [...document.querySelectorAll('[role="status"]')];
      return nodes.some((node) => /통과했어요|권장 개선이 있어요|고쳐야 할 문제가 있어요|불러오지 못했어요|다시 검사해 주세요|이전 검사 결과를 보여드려요/.test(node.textContent ?? ""));
    }, undefined, { timeout: 100_000 });
    const copy = await status.textContent();
    assert.ok(!/검사하고\u00A0있어요|검사하고 있어요/.test(copy ?? ""), `quality panel still spinning: ${copy}`);
    await shot(page, "deliverables-quality-settled");
  });
}
