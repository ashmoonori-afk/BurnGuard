import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import * as fsp from "node:fs/promises";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrationsFrom } from "../src/db/migrate";
import { createExportAuthority, requestExportCancellation } from "../src/db/export-lifecycle-repository";
import { reconcileExportState } from "../src/services/export-recovery";
import { canonicalJson, sha256, type ExportReceipt } from "../src/services/export-receipt";

const sourceDir = path.join(import.meta.dir, "../src/db/migrations");
const databases: Database[] = [];
const directories: string[] = [];

async function migratedDatabase(): Promise<Database> {
  const directory = await mkdtemp(path.join(tmpdir(), "bg-export-migration-"));
  directories.push(directory);
  for (const file of await readdir(sourceDir)) await cp(path.join(sourceDir, file), path.join(directory, file));
  const db = new Database(":memory:");
  databases.push(db);
  await runMigrationsFrom(db, directory);
  return db;
}

function seedProject(db: Database): void {
  db.exec(`INSERT INTO projects(id,name,type,dir_path,backend_id,created_at,updated_at,current_revision,current_digest) VALUES ('p','Project','slide_deck','/tmp/project','codex',1,1,3,'${"a".repeat(64)}'); INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('s','p','codex','idle',1,1,1)`);
}

describe("export recovery cleanup and orphan trees", () => {
  afterEach(async () => {
    for (const db of databases.splice(0)) db.close();
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
  });

  test("Given a cancelled attempt, a corrupt attempt and an orphan stage whose removal rejects with EBUSY When recovery runs Then it resolves and both attempts are terminal", async () => {
    // Given
    const db = await migratedDatabase(); seedProject(db); const root = await mkdtemp(path.join(tmpdir(), "bg-export-recovery-busy-")); directories.push(root);
    const cancelled = createExportAuthority(db, { projectId: "p", revision: 3, digest: "a".repeat(64), designSystemDigest: null, format: "html_zip", options: {}, rendererDigest: "r", captureDigest: "c" });
    db.prepare("UPDATE export_attempts SET status='running' WHERE id=?").run(cancelled.attemptId); requestExportCancellation(db, cancelled.attemptId);
    await mkdir(path.join(root, ".staging", cancelled.attemptId, "render"), { recursive: true });
    const corrupt = createExportAuthority(db, { projectId: "p", revision: 3, digest: "a".repeat(64), designSystemDigest: null, format: "html_zip", options: {}, rendererDigest: "r", captureDigest: "c" });
    db.prepare("UPDATE export_attempts SET status='running' WHERE id=?").run(corrupt.attemptId);
    await mkdir(path.join(root, "attempts", corrupt.attemptId), { recursive: true }); await writeFile(path.join(root, "attempts", corrupt.attemptId, "receipt.json"), "{}");
    await mkdir(path.join(root, ".staging", "01ORPHANSTAGE0000000000000"), { recursive: true });
    const original = fsp.rm;
    const busy = spyOn(fsp, "rm").mockImplementation(async (target, options) => { if (String(target).startsWith(root)) throw Object.assign(new Error("resource busy"), { code: "EBUSY" }); return original(target, options); });
    // When
    try { await reconcileExportState(db, root); } finally { busy.mockRestore(); }
    // Then
    expect(db.query("SELECT status,stop_reason FROM export_attempts WHERE id=?").get(cancelled.attemptId)).toEqual({ status: "cancelled", stop_reason: "user_cancelled" });
    expect(db.query("SELECT status,stop_reason FROM export_attempts WHERE id=?").get(corrupt.attemptId)).toEqual({ status: "corrupt", stop_reason: "receipt_corrupt" });
  });

  test("Given an interrupted render stage and a published receipt whose output is gone When recovery runs Then the render is failed not corrupt and no job message carries a path", async () => {
    // Given
    const db = await migratedDatabase(); seedProject(db); const root = await mkdtemp(path.join(tmpdir(), "bg-export-recovery-interrupted-")); directories.push(root);
    const options = { png_width: 320, png_height: 240, png_dpr: 1 } as const;
    const interrupted = createExportAuthority(db, { projectId: "p", revision: 3, digest: "a".repeat(64), designSystemDigest: null, format: "png", options, rendererDigest: "b".repeat(64), captureDigest: "c".repeat(64) });
    db.prepare("UPDATE export_attempts SET status='running' WHERE id=?").run(interrupted.attemptId);
    const stage = path.join(root, ".staging", interrupted.attemptId); await mkdir(path.join(stage, "render"), { recursive: true }); await writeFile(path.join(stage, "render", "index.html"), "scratch");
    const missing = createExportAuthority(db, { projectId: "p", revision: 3, digest: "a".repeat(64), designSystemDigest: null, format: "png", options, rendererDigest: "b".repeat(64), captureDigest: "c".repeat(64) });
    db.prepare("UPDATE export_attempts SET status='recovering',input_closure_digest=? WHERE id=?").run("a".repeat(64), missing.attemptId);
    const published = path.join(root, "attempts", missing.attemptId); await mkdir(published, { recursive: true });
    const receipt: ExportReceipt = { schema_version: 1, job_id: missing.jobId, attempt_id: missing.attemptId, parent_attempt_id: null, format: "png", project: { id: "p", revision: 3, digest: "a".repeat(64) }, options, output_file: "artifact.png", output_size: 3, digests: { input_closure: "a".repeat(64), design_system: null, options: sha256(canonicalJson(options)), renderer: "b".repeat(64), capture: "c".repeat(64), output: "d".repeat(64) }, validation: { width: 320, height: 240, statistics: { pixels: 76_800, visible_pixels: 76_800, differing_pixels: 100, dominant_ratio: 0.9, luminance_variance: 10, entropy: 0.2 } } };
    await writeFile(path.join(published, "receipt.json"), canonicalJson(receipt));
    // When
    await reconcileExportState(db, root);
    // Then
    expect(db.query("SELECT status,stop_reason FROM export_attempts WHERE id=?").get(interrupted.attemptId)).toEqual({ status: "failed", stop_reason: "recovery_failed" });
    expect(await Bun.file(path.join(stage, "render", "index.html")).exists()).toBe(false);
    expect(db.query("SELECT status,stop_reason FROM export_attempts WHERE id=?").get(missing.attemptId)).toEqual({ status: "corrupt", stop_reason: "receipt_corrupt" });
    for (const jobId of [interrupted.jobId, missing.jobId]) {
      const message = db.query<{ readonly error_message: string }, [string]>("SELECT error_message FROM exports WHERE id=?").get(jobId)?.error_message ?? "";
      expect(message).not.toBe(""); expect(message).not.toMatch(/[\\/]/u);
    }
  });

  test("Given attempt and stage directories whose export rows were cascaded away by project deletion When recovery runs Then they are removed while a validated attempt stays byte-identical", async () => {
    // Given
    const db = await migratedDatabase(); seedProject(db); db.exec("PRAGMA foreign_keys=ON"); const root = await mkdtemp(path.join(tmpdir(), "bg-export-orphan-attempts-")); directories.push(root);
    const kept = createExportAuthority(db, { projectId: "p", revision: 3, digest: "a".repeat(64), designSystemDigest: null, format: "png", options: { png_width: 320, png_height: 240, png_dpr: 1 }, rendererDigest: "b".repeat(64), captureDigest: "c".repeat(64) });
    db.prepare("UPDATE export_attempts SET status='recovering',input_closure_digest=? WHERE id=?").run("a".repeat(64), kept.attemptId);
    const published = path.join(root, "attempts", kept.attemptId); await mkdir(published, { recursive: true }); const output = Uint8Array.from([1, 2, 3]); await writeFile(path.join(published, "artifact.png"), output);
    const receipt: ExportReceipt = { schema_version: 1, job_id: kept.jobId, attempt_id: kept.attemptId, parent_attempt_id: null, format: "png", project: { id: "p", revision: 3, digest: "a".repeat(64) }, options: { png_width: 320, png_height: 240, png_dpr: 1 }, output_file: "artifact.png", output_size: 3, digests: { input_closure: "a".repeat(64), design_system: null, options: sha256(canonicalJson({ png_width: 320, png_height: 240, png_dpr: 1 })), renderer: "b".repeat(64), capture: "c".repeat(64), output: sha256(output) }, validation: { width: 320, height: 240, statistics: { pixels: 76_800, visible_pixels: 76_800, differing_pixels: 100, dominant_ratio: 0.9, luminance_variance: 10, entropy: 0.2 } } };
    await writeFile(path.join(published, "receipt.json"), canonicalJson(receipt));
    db.exec(`INSERT INTO projects(id,name,type,dir_path,backend_id,created_at,updated_at,current_revision,current_digest) VALUES ('gone','Gone','prototype','/tmp/gone','codex',1,1,1,'${"e".repeat(64)}')`);
    const deleted = createExportAuthority(db, { projectId: "gone", revision: 1, digest: "e".repeat(64), designSystemDigest: null, format: "html_zip", options: {}, rendererDigest: "r", captureDigest: "c" });
    db.prepare("UPDATE export_attempts SET status='failed',stop_reason='render_failed' WHERE id=?").run(deleted.attemptId);
    await mkdir(path.join(root, "attempts", deleted.attemptId), { recursive: true }); await writeFile(path.join(root, "attempts", deleted.attemptId, "artifact.zip"), "deleted project source");
    await mkdir(path.join(root, ".staging", deleted.attemptId, "render"), { recursive: true });
    db.prepare("DELETE FROM projects WHERE id='gone'").run();
    expect(db.query("SELECT COUNT(*) count FROM export_attempts WHERE id=?").get(deleted.attemptId)).toEqual({ count: 0 });
    // When
    await reconcileExportState(db, root);
    // Then
    expect(await readdir(path.join(root, "attempts"))).toEqual([kept.attemptId]);
    expect(await readdir(path.join(root, ".staging"))).toEqual([]);
    expect(db.query("SELECT status FROM export_attempts WHERE id=?").get(kept.attemptId)).toEqual({ status: "validated" });
    expect(new Uint8Array(await readFile(path.join(published, "artifact.png")))).toEqual(output);
    expect(await readFile(path.join(published, "receipt.json"), "utf8")).toBe(canonicalJson(receipt));
  });
});
