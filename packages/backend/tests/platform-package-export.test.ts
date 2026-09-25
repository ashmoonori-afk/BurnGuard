import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SequencedEventEnvelope } from "@bg/shared";
import { getExportJob } from "../src/db/exports";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir } from "../src/lib/paths";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { sequencedBroker } from "../src/services/broker";
import { resetChromiumCapability, setChromiumCapabilityForTesting } from "../src/services/chromium-capability";
import { activeExportBrowserCount } from "../src/services/export-browser-registry";
import { parseExportReceipt } from "../src/services/export-receipt";
import { enqueueProjectExport } from "../src/services/exports";

const projectId = `platform-export-${process.pid}`;
const sessionId = `${projectId}-session`;
const root = path.join(projectsDir, projectId);
const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>홈</title><style>/* @bg-shared-css */body{margin:0}/* @bg-page-css */.hero{padding:8px}</style></head><body><header data-bg-shared="header"></header><main data-bg-content><section class="hero" id="hero" data-bg-node-id="hero"><h1>안녕하세요</h1></section></main><footer data-bg-shared="footer"></footer></body></html>';

beforeAll(async () => {
  await runMigrations();
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "index.html"), html);
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, "Shop Site", root);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
  await new ArtifactCoordinator(getSqlite()).initialize(projectId, root);
});

afterAll(async () => {
  resetChromiumCapability();
  getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
  await rm(root, { recursive: true, force: true });
});

function nextTerminal(): Promise<SequencedEventEnvelope> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe(); reject(new TypeError("export terminal event timed out")); }, 20_000);
    const unsubscribe = sequencedBroker.subscribe(sessionId, (item) => {
      if (item.event.type !== "export.attempt" || !["failed", "validated", "cancelled"].includes(item.event.status)) return;
      clearTimeout(timeout); unsubscribe(); resolve(item);
    });
  });
}

describe("platform package export pipeline", () => {
  test.each(["cafe24_package", "imweb_package"] as const)("Given Chromium reported unusable When a %s export runs Then it completes with a validated package and no browser", async (format) => {
    // Given
    setChromiumCapabilityForTesting(false);
    const terminal = nextTerminal();

    // When
    const started = await enqueueProjectExport(projectId, format, {});
    if (started === null) throw new TypeError("export did not start");
    const event = await terminal;

    // Then
    const job = await getExportJob(started.id);
    expect(event.event.type === "export.attempt" && event.event.status).toBe("validated");
    expect(job?.status).toBe("succeeded");
    if (job?.output_path === null || job?.output_path === undefined) throw new TypeError("export output is unavailable");
    expect((await stat(job.output_path)).isFile()).toBe(true);
    const receipt = parseExportReceipt(JSON.parse(await Bun.file(path.join(path.dirname(job.output_path), "receipt.json")).text()));
    expect(receipt.validation.entries).toBeGreaterThan(0);
    expect(activeExportBrowserCount()).toBe(0);
  }, 30_000);
});
