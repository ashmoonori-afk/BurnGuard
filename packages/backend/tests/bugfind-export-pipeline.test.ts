import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SequencedEventEnvelope } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { getExportJob } from "../src/db/exports";
import { getSqlite } from "../src/db/sqlite-client";
import { exportsDir, projectsDir } from "../src/lib/paths";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { sequencedBroker } from "../src/services/broker";
import { enqueueProjectExport } from "../src/services/exports";

const created: string[] = [];

async function createProject(kind: string, type: "prototype" | "slide_deck", files: Readonly<Record<string, string>>): Promise<{ readonly projectId: string; readonly sessionId: string }> {
  const projectId = `bugfind-export-${kind}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const sessionId = `${projectId}-session`;
  const projectDir = path.join(projectsDir, projectId);
  await mkdir(projectDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(projectDir, name)), { recursive: true });
    await writeFile(path.join(projectDir, name), content);
  }
  const db = getSqlite();
  db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,options_json,created_at,updated_at) VALUES (?,?,?,?,'index.html','codex',NULL,1,1)").run(projectId, `Bugfind ${kind}`, type, projectDir);
  db.prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
  await new ArtifactCoordinator(db).initialize(projectId, projectDir);
  created.push(projectId);
  return { projectId, sessionId };
}

function terminalStatus(sessionId: string): Promise<string> {
  return new Promise((resolve) => {
    const deadline = setTimeout(() => { unsubscribe(); resolve("timeout"); }, 20_000);
    const unsubscribe = sequencedBroker.subscribe(sessionId, (item: SequencedEventEnvelope) => {
      if (item.event.type === "export.attempt" && ["failed", "cancelled", "validated"].includes(item.event.status)) {
        clearTimeout(deadline); unsubscribe(); resolve(item.event.status);
      }
    });
  });
}

beforeAll(async () => { await runMigrations(); });

afterAll(async () => {
  for (const projectId of created) {
    getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
    await rm(path.join(projectsDir, projectId), { recursive: true, force: true });
  }
});

describe("bugfind export pipeline", () => {
  test("Given a slide deck whose entrypoint file is missing When an HTML export fails Then the persisted job error_message carries no absolute private path", async () => {
    // Given: the deck entrypoint index.html was renamed away, only a stylesheet remains.
    const { projectId, sessionId } = await createProject("leak", "slide_deck", { "styles.css": "body{margin:0}" });
    const settled = terminalStatus(sessionId);
    // When
    const job = await enqueueProjectExport(projectId, "html_zip", {});
    expect(await settled).toBe("failed");
    const persisted = await getExportJob(job!.id);
    // Then: the DTO served by GET /api/exports/:id must not expose the profile layout.
    const message = persisted?.error_message ?? "";
    expect(message).not.toContain(exportsDir);
    expect(message).not.toMatch(/[\\/]\.staging[\\/]/u);
  });

  test("Given a prototype with an NFD-normalized asset file name When an HTML export runs Then the export is validated", async () => {
    // Given: an initialized project whose Korean asset name is then rewritten decomposed (NFD), as macOS tools and syncs write it; the canonical digest is unchanged.
    const nfc = "\uB85C\uACE0.svg";
    const { projectId, sessionId } = await createProject("nfd", "prototype", {
      "index.html": "<!doctype html><html><head><title>NFD</title></head><body><main>NFD</main></body></html>",
      [`assets/${nfc}`]: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\"></svg>",
    });
    const assets = path.join(projectsDir, projectId, "assets");
    await rename(path.join(assets, nfc), path.join(assets, nfc.normalize("NFD")));
    const settled = terminalStatus(sessionId);
    // When
    const job = await enqueueProjectExport(projectId, "html_zip", {});
    const status = await settled;
    // Then
    expect({ status, error: (await getExportJob(job!.id))?.error_message ?? null }).toEqual({ status: "validated", error: null });
  });
});
