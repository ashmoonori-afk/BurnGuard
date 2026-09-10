import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExportOptions, GraphicSetV1 } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { advanceExportAttempt, createExportAuthority, recordExportAuditFindings } from "../src/db/export-lifecycle-repository";
import { getSqlite } from "../src/db/sqlite-client";
import type { CapturePage, CaptureRequest } from "../src/services/export-frame-capture";
import { createCanvas } from "../src/services/export-native-modules";
import { renderPngZipWithPage } from "../src/services/export-png-zip";
import { MAX_ATTEMPT_FINDINGS, recordRenderFindings } from "../src/services/exports";

const projectId = `png-zip-findings-${process.pid}`;
const detailSet: GraphicSetV1 = { schema_version: 1, kind: "product_detail", frame_count: 1 };
const sliceOptions: ExportOptions = { slice_height: 3000, slice_format: "png" };
let stagedDir = "";
let outputPath = "";

beforeAll(async () => {
  await runMigrations();
  stagedDir = await mkdtemp(path.join(tmpdir(), "bg-png-zip-findings-"));
  outputPath = path.join(stagedDir, "artifact.zip");
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at,current_revision,current_digest) VALUES (?,?,'graphic',?,'index.html','codex',1,1,2,?)").run(projectId, "Detail Page", `/tmp/${projectId}`, "a".repeat(64));
});

afterAll(async () => {
  getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
  await rm(stagedDir, { recursive: true, force: true });
});

function pngBytes(width: number, height: number): Uint8Array {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#0f1c2e";
  context.fillRect(0, 0, width, height);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

function cuttingPage(): CapturePage {
  return {
    awaitRenderReady: async () => undefined,
    applyDeckPrintStyles: async () => undefined,
    measureFrames: async () => [],
    isolateFrame: async () => null,
    restoreFrames: async () => undefined,
    // One 7000px section cannot fit a 3000px slice, so the plan must cut through it.
    measureSections: async () => ({ pageWidth: 860, pageHeight: 7000, originX: 0, originY: 0, sectionBottoms: [7000] }),
    flattenBackground: async () => undefined,
    capture: async (request: CaptureRequest) => pngBytes(request.clip.width, request.clip.height),
  };
}

function newAttempt(): string {
  const ids = createExportAuthority(getSqlite(), { projectId, revision: 2, digest: "a".repeat(64), designSystemDigest: null, format: "png_zip", options: sliceOptions, rendererDigest: "r".repeat(64), captureDigest: "c".repeat(64) });
  advanceExportAttempt(getSqlite(), { attemptId: ids.attemptId, status: "running", stage: "rendering", inputClosureDigest: "d".repeat(64), designSystemDigest: null });
  return ids.attemptId;
}

function findingsOf(attemptId: string): readonly { readonly code: string; readonly path: string | null }[] {
  return JSON.parse(getSqlite().query<{ readonly findings_json: string }, [string]>("SELECT findings_json FROM export_attempts WHERE id=?").get(attemptId)?.findings_json ?? "[]");
}

describe("png zip render findings", () => {
  test("Given a slice plan that cuts through a section When the batch findings are recorded Then the attempt keeps the audit findings and the cut", async () => {
    // Given
    const attemptId = newAttempt();
    const audit = [{ code: "design_audit:contrast:fail", path: "index.html" }];
    recordExportAuditFindings(getSqlite(), attemptId, audit);
    const { findings } = await renderPngZipWithPage({ page: cuttingPage(), stagedDir, outputPath, deck: false, graphic_set: detailSet, options: sliceOptions, receiptWriter: async () => undefined, signal: new AbortController().signal });
    expect(findings.map((finding) => finding.code)).toContain("cut_through_content");

    // When
    recordRenderFindings(attemptId, audit, findings);

    // Then
    const recorded = findingsOf(attemptId);
    expect(recorded).toContainEqual({ code: "design_audit:contrast:fail", path: "index.html" });
    expect(recorded.filter((finding) => finding.code === "png_zip:cut_through_content")).not.toHaveLength(0);
  });

  test("Given no render findings When recording runs Then the audit findings are left untouched", () => {
    // Given
    const attemptId = newAttempt();
    const audit = [{ code: "design_audit:contrast:fail", path: "index.html" }];
    recordExportAuditFindings(getSqlite(), attemptId, audit);

    // When
    recordRenderFindings(attemptId, audit, []);

    // Then
    expect(findingsOf(attemptId)).toEqual(audit);
  });

  test("Given more findings than the attempt row accepts When recording runs Then the merged set stays within the cap", () => {
    // Given
    const attemptId = newAttempt();
    const audit = Array.from({ length: MAX_ATTEMPT_FINDINGS }, (_unused, index) => ({ code: `design_audit:check-${index}:fail`, path: null }));

    // When
    recordRenderFindings(attemptId, audit, [{ code: "cut_through_content", slice: 1 }]);

    // Then
    expect(findingsOf(attemptId)).toHaveLength(MAX_ATTEMPT_FINDINGS);
  });
});
