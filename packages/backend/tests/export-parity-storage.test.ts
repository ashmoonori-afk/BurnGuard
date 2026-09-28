import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  EXPORT_PARITY_SIMILARITY_THRESHOLD,
  parseExportParitySummary,
} from "@bg/shared";
import {
  advanceExportAttempt,
  completeExportAttempt,
  createExportAuthority,
} from "../src/db/export-lifecycle-repository";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { exportsDir } from "../src/lib/paths";
import { artifactRoutes } from "../src/routes/artifacts";
import { managedFileRoutes } from "../src/routes/managed-files";
import { writeExportParityArtifacts } from "../src/services/export-parity-artifacts";
import { createCanvas } from "../src/services/export-native-modules";
import { canonicalJson, sha256 } from "../src/services/export-receipt";

describe("export parity receipt sidecars", () => {
  test("Given a structural export When parity is persisted Then the compact summary is stored beside the receipt", async () => {
    // Given
    const stageRoot = await mkdtemp(path.join(tmpdir(), "bg-parity-sidecar-"));
    try {
      // When
      const summary = await writeExportParityArtifacts({
        stageRoot,
        outputPath: path.join(stageRoot, "artifact.svg"),
        format: "svg",
        validation: { root: "svg", bytes: 64, source: null },
        sourcePages: [],
        signal: new AbortController().signal,
      });

      // Then
      const stored = parseExportParitySummary(
        JSON.parse(
          await readFile(path.join(stageRoot, "parity", "parity.json"), "utf8"),
        ),
      );
      expect(stored).toEqual(summary);
      expect(stored).toMatchObject({
        status: "pass",
        comparison: "structural",
        source_page_count: 1,
        output_page_count: 1,
      });
    } finally {
      await rm(stageRoot, { recursive: true, force: true });
    }
  });

  test("Given validated parity evidence When export APIs are read Then summary and digest-checked thumbnail are exposed", async () => {
    // Given
    await runMigrations();
    const projectId = `parity-api-${process.pid}`;
    const db = getSqlite();
    db.prepare(
      "INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)",
    ).run(projectId, "Parity API", projectId);
    const ids = createExportAuthority(db, {
      projectId,
      revision: 1,
      digest: "a".repeat(64),
      designSystemDigest: null,
      format: "png",
      options: { png_width: 320, png_height: 240, png_dpr: 1 },
      rendererDigest: "renderer",
      captureDigest: "capture",
    });
    const root = path.join(exportsDir, "attempts", ids.attemptId);
    const outputPath = path.join(root, "artifact.png");
    const thumbnailPath = path.join(
      root,
      "parity",
      "thumbnails",
      "page-001.png",
    );
    const canvas = createCanvas(320, 100);
    const context = canvas.getContext("2d");
    context.fillStyle = "#004fff";
    context.fillRect(0, 0, 320, 100);
    const thumbnail = new Uint8Array(canvas.toBuffer("image/png"));
    const summary = parseExportParitySummary({
      schema_version: 1,
      status: "pass",
      comparison: "pixel",
      threshold: EXPORT_PARITY_SIMILARITY_THRESHOLD,
      source_page_count: 1,
      output_page_count: 1,
      pages: [{
        page: 1,
        source_dimensions: { width: 320, height: 240 },
        output_dimensions: { width: 320, height: 240 },
        similarity_score: 100,
        warnings: [],
        thumbnail_available: true,
        thumbnail_sha256: sha256(thumbnail),
      }],
      warnings: [],
    });
    try {
      await mkdir(path.dirname(thumbnailPath), { recursive: true });
      await writeFile(outputPath, "output");
      await writeFile(thumbnailPath, thumbnail);
      await writeFile(path.join(root, "parity", "parity.json"), canonicalJson(summary));
      advanceExportAttempt(db, {
        attemptId: ids.attemptId,
        status: "running",
        stage: "rendering",
        inputClosureDigest: "input",
      });
      advanceExportAttempt(db, {
        attemptId: ids.attemptId,
        status: "validating",
        stage: "publishing",
      });
      completeExportAttempt(db, {
        ...ids,
        outputPath,
        size: 6,
        outputDigest: "output",
        receiptDigest: "receipt",
      });

      // When
      const listResponse = await artifactRoutes.request(
        `http://local/api/projects/${projectId}/exports`,
      );
      const thumbnailResponse = await managedFileRoutes.request(
        `http://local/api/exports/${ids.jobId}/parity/pages/1/thumbnail`,
      );

      // Then
      const body: unknown = await listResponse.json();
      expect(listResponse.status).toBe(200);
      expect(body).toMatchObject({ data: [{ id: ids.jobId, parity: summary }] });
      expect(thumbnailResponse.status).toBe(200);
      expect(thumbnailResponse.headers.get("content-type")).toBe("image/png");
      expect(
        sha256(new Uint8Array(await thumbnailResponse.arrayBuffer())),
      ).toBe(sha256(thumbnail));

      await writeFile(thumbnailPath, Uint8Array.from(thumbnail, (value) => value ^ 1));
      const corruptResponse = await managedFileRoutes.request(
        `http://local/api/exports/${ids.jobId}/parity/pages/1/thumbnail`,
      );
      const invalidPageResponse = await managedFileRoutes.request(
        `http://local/api/exports/${ids.jobId}/parity/pages/0/thumbnail`,
      );
      expect(corruptResponse.status).toBe(410);
      expect(invalidPageResponse.status).toBe(400);
    } finally {
      db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
      await rm(root, { recursive: true, force: true });
    }
  });
});
