import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SequencedEventEnvelope } from "@bg/shared";
import { getExportAttemptDetail, getExportJob } from "../src/db/exports";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { exportsDir, projectsDir } from "../src/lib/paths";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { sequencedBroker } from "../src/services/broker";
import { activeExportBrowserCount } from "../src/services/export-browser-registry";
import { cancelProjectExport, enqueueProjectExport, type ExportPhase } from "../src/services/exports";

const prefix = `audit-export-${process.pid}`;
const projects = [{ id: `${prefix}-blocked`, session: `${prefix}-blocked-session`, html: `<!doctype html><html><head><style>:root{--ink:#111}body{background:#fff;color:#aaa}.a,.b{position:absolute;width:80px}.a{left:10px}.b{left:120px}</style></head><body><p class="a" data-bg-node-id="a">Low contrast</p><p class="b" data-bg-node-id="b">Text</p></body></html>` }, { id: `${prefix}-recommended`, session: `${prefix}-recommended-session`, html: `<!doctype html><html><head><style>body{background:#fff;color:#111}.a,.b{position:absolute;width:80px}.a{left:10px}.b{left:120px}</style></head><body><p class="a" data-bg-node-id="a" style="font-size:9px">Small</p><p class="b" data-bg-node-id="b">Text</p></body></html>` }, { id: `${prefix}-ready`, session: `${prefix}-ready-session`, html: `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>/* @bg-shared-css */:root{--paper:#fff;--ink:#111;--accent:#1647d8}*{box-sizing:border-box}html,body{margin:0;background:var(--paper);color:var(--ink);font-family:Arial,sans-serif}/* @bg-page-css */.stage{position:relative;min-height:700px;padding:24px}.a,.b{position:absolute;top:100px;width:120px;height:40px}.a{left:24px}.b{left:180px}</style></head><body><header data-bg-shared="header"></header><nav data-bg-shared="nav"><a href="index.html" aria-current="page">홈</a></nav><main class="stage" data-bg-content data-bg-node-id="ready-stage"><p data-bg-node-id="ready-copy">모든 검사를 통과하는 준비 상태</p><div class="a" data-bg-node-id="ready-a">측정 후보 A</div><div class="b" data-bg-node-id="ready-b">측정 후보 B</div></main><footer data-bg-shared="footer"></footer></body></html>` }] as const;

beforeAll(async () => {
  await runMigrations();
  for (const project of projects) { const root = path.join(projectsDir, project.id); await mkdir(root, { recursive: true }); await writeFile(path.join(root, "index.html"), project.html); getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(project.id, project.id, root); getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(project.session, project.id); await new ArtifactCoordinator(getSqlite()).initialize(project.id, root); }
});
afterAll(async () => { for (const project of projects) { getSqlite().prepare("DELETE FROM projects WHERE id=?").run(project.id); await rm(path.join(projectsDir, project.id), { recursive: true, force: true }); } });

function nextTerminal(sessionId: string): Promise<SequencedEventEnvelope> { return new Promise((resolve, reject) => { const timeout = setTimeout(() => { unsubscribe(); reject(new TypeError("export terminal event timed out")); }, 60_000); const unsubscribe = sequencedBroker.subscribe(sessionId, (item) => { if (item.event.type !== "export.attempt" || !["failed", "validated", "cancelled"].includes(item.event.status)) return; clearTimeout(timeout); unsubscribe(); resolve(item); }); }); }

describe("pre-export design audit", () => {
  test("Given must-fix contrast When the user skips quality checks Then HTML publishes with the choice recorded", async () => {
    const terminal = nextTerminal(projects[0].session);
    const started = await enqueueProjectExport(projects[0].id, "html_zip", { skip_quality_check: true });
    if (!started?.latest_attempt) throw new TypeError("export did not start");
    await terminal;
    const job = await getExportJob(started.id);
    const attempt = await getExportAttemptDetail(started.latest_attempt.id);
    expect(job?.status).toBe("succeeded");
    expect(job?.options).toEqual({ skip_quality_check: true });
    expect(attempt?.findings).toEqual([{ code: "design_audit:skipped_by_user", path: null }]);
    expect(activeExportBrowserCount()).toBe(0);
  });

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

  for (const phase of ["after_validation", "after_receipt", "after_publish_before_db"] satisfies ExportPhase[]) {
    test(`Given cancellation at ${phase} When the real export finishes Then cancellation wins and owned output is removed`, async () => {
      const terminal = nextTerminal(projects[2].session);
      let accepted = false;
      const started = await enqueueProjectExport(projects[2].id, "html_zip", {}, { phase: (attemptId, reached) => {
        if (reached === phase) accepted = cancelProjectExport(attemptId);
      } });
      if (started?.latest_attempt === null || started === null) throw new TypeError("export did not start");
      const event = await terminal;
      const job = await getExportJob(started.id);
      const attempt = await getExportAttemptDetail(started.latest_attempt.id);
      expect(accepted).toBe(true);
      expect(event.event.type === "export.attempt" && event.event.status).toBe("cancelled");
      expect(attempt?.status).toBe("cancelled");
      expect(attempt?.stop_reason).toBe("user_cancelled");
      expect(job?.status).toBe("failed");
      expect(job?.output_path).toBeNull();
      expect(await Bun.file(path.join(exportsDir, "attempts", started.latest_attempt.id, "artifact.zip")).exists()).toBe(false);
      expect(await Bun.file(path.join(exportsDir, ".staging", started.latest_attempt.id, "receipt.json")).exists()).toBe(false);
      expect(activeExportBrowserCount()).toBe(0);
    }, 70_000);
  }
});
