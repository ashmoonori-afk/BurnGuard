import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GraphicCanvasV1, SequencedEventEnvelope } from "@bg/shared";
import { getExportAttemptDetail, getExportJob } from "../src/db/exports";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { renderInitialArtifact } from "../src/db/templates";
import { copyBundledFonts } from "../src/data/bundled-fonts";
import { artifactRoutes } from "../src/routes/artifacts";
import { projectsDir } from "../src/lib/paths";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { auditRenderedTree } from "../src/services/design-audit";
import { sequencedBroker } from "../src/services/broker";
import { activeExportBrowserCount } from "../src/services/export-browser-registry";
import { enqueueProjectExport, ExportServiceError } from "../src/services/exports";
import { parsePng } from "../src/services/export-png-validation";
import { parseExportReceipt } from "../src/services/export-receipt";

const projectId = `graphic-export-${process.pid}`;
const sessionId = `${projectId}-session`;
const projectDir = path.join(projectsDir, projectId);
const canvas = { schema_version: 1, width: 1200, height: 628 } as const;
const projectName = "Functional Graphic 1200x628";
const limitProjectId = `${projectId}-pdf-limit`;

beforeAll(async () => {
  await runMigrations();
  await mkdir(projectDir, { recursive: true });
  await copyBundledFonts(projectDir);
  await writeFile(path.join(projectDir, "index.html"), renderInitialArtifact({ name: projectName, type: "graphic", options: { graphic_canvas: canvas } }));
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,options_json,created_at,updated_at) VALUES (?,?, 'graphic',?,'index.html','codex',?,1,1)").run(projectId, projectName, projectDir, JSON.stringify({ use_speaker_notes: false, copy_as_is: false, design_brief: { schema_version: 1, output_type: "graphic", audience: "Campaign visitors", objective: "Announce the autumn launch", content_source: "none", locale: "en-US", brand_mode: "none", visual_mood: "premium", density: "balanced", output_size: "custom" }, graphic_canvas: canvas }));
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,options_json,created_at,updated_at) VALUES (?,?,'graphic',?,'index.html','codex',?,1,1)").run(limitProjectId, "Oversized PDF", limitProjectId, JSON.stringify({ graphic_canvas: { schema_version: 1, width: 1080, height: 1080 }, graphic_set: { schema_version: 1, kind: "card_news", frame_count: 40 } }));
  await new ArtifactCoordinator(getSqlite()).initialize(projectId, projectDir);
});

afterAll(async () => {
  getSqlite().prepare("DELETE FROM projects WHERE id IN (?,?)").run(projectId, limitProjectId);
  await rm(projectDir, { recursive: true, force: true });
});

describe("graphic PNG export invariant", () => {
  test.each([
    { png_width: 1201, png_height: 628, png_dpr: 1 as const },
    { png_width: 1200, png_height: 629, png_dpr: 1 as const },
    { png_width: 1200, png_height: 628, png_dpr: 2 as const },
  ])("Given mismatched graphic PNG options When enqueued Then rejection precedes export authority", async (options) => {
    const before = exportCount();
    try {
      await enqueueProjectExport(projectId, "png", options);
      throw new TypeError("expected graphic export rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ExportServiceError);
      if (!(error instanceof ExportServiceError)) throw error;
      expect(error.code).toBe("invalid_graphic_export_options");
    }
    expect(exportCount()).toBe(before);
    expect(activeExportBrowserCount()).toBe(0);
  });

  test("Given a single-frame graphic When PNG ZIP is requested Then the frame guard rejects before authority creation", async () => {
    // Given
    const before = exportCount();

    // When
    const response = await artifactRoutes.request(`http://local/api/projects/${projectId}/exports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "png_zip", options: {} }),
    });

    // Then
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "format_requires_frames" } });
    expect(exportCount()).toBe(before);
    expect(activeExportBrowserCount()).toBe(0);
  });

  test("Given a non-detail graphic When JPEG slices are requested Then the kind-option pair is rejected", async () => {
    // Given / When
    const response = await artifactRoutes.request(`http://local/api/projects/${projectId}/exports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "png_zip", options: { slice_format: "jpeg" } }),
    });

    // Then
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_export_options" } });
    expect(activeExportBrowserCount()).toBe(0);
  });

  test("Given a single-frame graphic When service PNG ZIP is requested Then authority is not created", async () => {
    // Given
    const before = exportCount();

    // When / Then
    await expect(enqueueProjectExport(projectId, "png_zip", { slice_height: 5000, slice_format: "png" })).rejects.toMatchObject({ code: "format_requires_frames" });
    expect(exportCount()).toBe(before);
    expect(activeExportBrowserCount()).toBe(0);
  });

  test("Given forty 1080 artboards When artboard PDF is requested Then aggregate overflow fails before rendering", async () => {
    // Given
    const before = getSqlite().query<{ readonly count: number }, [string]>("SELECT COUNT(*) count FROM exports WHERE project_id=?").get(limitProjectId)?.count ?? 0;

    // When / Then
    await expect(enqueueProjectExport(limitProjectId, "pdf", { pdf_paper: "artboard" })).rejects.toMatchObject({ code: "pdf_resource_limit" });
    expect(getSqlite().query<{ readonly count: number }, [string]>("SELECT COUNT(*) count FROM exports WHERE project_id=?").get(limitProjectId)?.count).toBe(before);
    expect(activeExportBrowserCount()).toBe(0);
  });

  test("Given a mismatched API request When posted Then a typed client-facing error is returned", async () => {
    const response = await artifactRoutes.request(`http://local/api/projects/${projectId}/exports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        format: "png",
        options: { png_width: 1201, png_height: 628, png_dpr: 1 },
      }),
    });
    const body: unknown = await response.json();
    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: { code: "invalid_graphic_export_options" },
    });
  });

  test.each([
    [projectName, canvas],
    ["가".repeat(200), canvas],
    ["Minimum canvas", { schema_version: 1, width: 320, height: 240 } as const],
    ["Portrait canvas", { schema_version: 1, width: 1080, height: 1920 } as const],
  ] as const)("Given a server initial graphic When audited at its persisted canvas Then authored text is audit-clean", async (name, dimensions) => {
    const report = await auditInitialGraphic(name, dimensions);
    const mustFix = report.checks.flatMap((check) => check.findings).filter((finding) => finding.severity === "must_fix");
    const undersized = report.checks.find((check) => check.code === "minimum_text_size")?.findings ?? [];
    expect(mustFix).toEqual([]);
    expect(undersized).toEqual([]);
  }, 70_000);

  test("Given exact persisted dimensions When exported Then PNG IHDR statistics and receipt are exact", async () => {
    const terminal = nextTerminalExport();
    const started = await enqueueProjectExport(projectId, "png", {
      png_width: canvas.width,
      png_height: canvas.height,
      png_dpr: 1,
    });
    if (started === null || started.latest_attempt === null) {
      throw new TypeError("graphic export did not start");
    }
    await terminal;
    const job = await getExportJob(started.id);
    if (job?.status !== "succeeded") {
      const attempt = await getExportAttemptDetail(started.latest_attempt.id);
      throw new TypeError(`${job?.error_message ?? `unexpected graphic export status: ${job?.status ?? "missing"}`} ${JSON.stringify(attempt?.findings ?? [])}`);
    }
    if (job.output_path === null) {
      throw new TypeError("graphic output unavailable");
    }
    const output = new Uint8Array(await readFile(job.output_path));
    expect(parsePng(output)).toEqual({ width: 1200, height: 628 });
    const receipt = parseExportReceipt(JSON.parse(await readFile(path.join(path.dirname(job.output_path), "receipt.json"), "utf8")));
    expect(receipt.validation).toMatchObject({ width: 1200, height: 628 });
    if (!("statistics" in receipt.validation)) throw new TypeError("PNG statistics missing");
    expect(receipt.validation.statistics.pixels).toBe(753_600);
    expect(receipt.validation.statistics.visible_pixels).toBe(753_600);
    expect(receipt.validation.statistics.differing_pixels).toBeGreaterThan(0);
    expect(activeExportBrowserCount()).toBe(0);
  }, 70_000);
});

async function auditInitialGraphic(name: string, dimensions: GraphicCanvasV1) {
  const root = await mkdtemp(path.join(tmpdir(), "bg-graphic-template-audit-"));
  try {
    await writeFile(path.join(root, "index.html"), renderInitialArtifact({
      name,
      type: "graphic",
      options: { graphic_canvas: dimensions },
    }));
    const manifest = await inspectCanonicalTree(root);
    const report = await auditRenderedTree({
      projectId: "graphic-template-audit",
      projectDir: root,
      entrypoint: "index.html",
      revision: 0,
      digest: manifest.tree_digest,
      canvas: dimensions,
      safeFix: false,
      signal: new AbortController().signal,
    });
    expect(activeExportBrowserCount()).toBe(0);
    return report;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function exportCount(): number {
  const row = getSqlite().query<{ readonly count: number }, [string]>("SELECT COUNT(*) count FROM exports WHERE project_id=?").get(projectId);
  return row?.count ?? 0;
}

function nextTerminalExport(): Promise<SequencedEventEnvelope> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new TypeError("graphic export terminal event timed out"));
    }, 60_000);
    const unsubscribe = sequencedBroker.subscribe(sessionId, (item) => {
      if (item.event.type !== "export.attempt" || (item.event.status !== "failed" && item.event.status !== "validated")) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(item);
    });
  });
}
