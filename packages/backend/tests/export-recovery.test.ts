import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrationsFrom } from "../src/db/migrate";
import { advanceExportAttempt, completeExportAttempt, createExportAuthority, createRetryAuthority, requestExportCancellation } from "../src/db/export-lifecycle-repository";
import { reconcileExportState } from "../src/services/export-recovery";
import { canonicalJson, receiptDigest, sha256, type ExportReceipt } from "../src/services/export-receipt";
import { completeExportAttemptWithEvent } from "../src/services/export-events";

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

function seed(db: Database): void {
  db.exec(`
    INSERT INTO projects(id,name,type,dir_path,backend_id,created_at,updated_at,current_revision,current_digest)
      VALUES ('p','Project','slide_deck','/tmp/project','codex',1,1,3,'${"a".repeat(64)}');
    INSERT INTO exports(id,project_id,format,status,options_json,created_at)
      VALUES ('j','p','png','pending','{"png_width":1440,"png_height":900,"png_dpr":2}',1);
  `);
}

function insertAttempt(db: Database, id: string, parent: string | null, status = "pending"): void {
  db.prepare(`INSERT INTO export_attempts(
    id,job_id,parent_attempt_id,status,progress_json,stop_reason,project_revision,project_digest,
    canonical_options_json,options_digest,input_closure_digest,design_system_digest,renderer_digest,
    capture_digest,output_digest,receipt_digest,findings_json,retention_json,cancel_requested_at,created_at,updated_at
  ) VALUES (?,?,?,?,?,NULL,3,?,?,?,?,?,?,?,?,?,'[]','{"retained_until":10000,"output_available":false}',NULL,1,1)`).run(
    id, "j", parent, status, '{"stage":"queued","completed":0,"total":6}', "a".repeat(64),
    '{"png_width":1440,"png_height":900,"png_dpr":2}', "b".repeat(64), null, null,
    "c".repeat(64), "d".repeat(64), null, null,
  );
}

afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("export authority migration", () => {
  test("Given a validated-event INSERT failure When export completion commits Then job attempt and event all roll back together", async () => {
    const db = await migratedDatabase(); seedProject(db);
    const ids = createExportAuthority(db, { projectId: "p", revision: 3, digest: "a".repeat(64), designSystemDigest: null, format: "html_zip", options: {}, rendererDigest: "r", captureDigest: "c" });
    advanceExportAttempt(db, { attemptId: ids.attemptId, status: "validating", stage: "publishing" });
    db.exec("CREATE TRIGGER reject_validated_event BEFORE INSERT ON events WHEN NEW.type='export.attempt' AND json_extract(NEW.payload_json,'$.status')='validated' BEGIN SELECT RAISE(ABORT,'event_insert_blocked'); END");
    const completion = { ...ids, projectId: "p", projectRevision: 3, projectDigest: "a".repeat(64), outputPath: "/owned/output.zip", size: 1, outputDigest: "o", receiptDigest: "r" };
    expect(() => completeExportAttemptWithEvent(db, completion)).toThrow("event_insert_blocked");
    expect(db.query("SELECT status,output_path FROM exports WHERE id=?").get(ids.jobId)).toEqual({ status: "pending", output_path: null });
    expect(db.query("SELECT status,output_digest FROM export_attempts WHERE id=?").get(ids.attemptId)).toEqual({ status: "validating", output_digest: null });
    expect(db.query("SELECT COUNT(*) count FROM events").get()).toEqual({ count: 0 });
    db.exec("DROP TRIGGER reject_validated_event");
    expect(completeExportAttemptWithEvent(db, completion)?.envelope.event).toMatchObject({ type: "export.attempt", status: "validated" });
    expect(db.query("SELECT status FROM exports WHERE id=?").get(ids.jobId)).toEqual({ status: "succeeded" });
  });
  test("Given cancellation after validation When completion races Then durable cancellation prevents success", async () => {
    const db = await migratedDatabase(); seedProject(db);
    const ids = createExportAuthority(db, { projectId: "p", revision: 3, digest: "a".repeat(64), designSystemDigest: null, format: "html_zip", options: {}, rendererDigest: "r", captureDigest: "c" });
    advanceExportAttempt(db, { attemptId: ids.attemptId, status: "validating", stage: "publishing" });
    expect(requestExportCancellation(db, ids.attemptId)).toBe(true);
    expect(() => completeExportAttempt(db, { ...ids, outputPath: "/owned/output.zip", size: 1, outputDigest: "o", receiptDigest: "r" })).toThrow("transition_conflict");
    expect(db.query("SELECT status,output_path FROM exports WHERE id=?").get(ids.jobId)).toEqual({ status: "pending", output_path: null });
  });

  test("Given a cancellation persisted before restart When recovery finds owned output Then it removes bytes and preserves cancellation", async () => {
    const db = await migratedDatabase(); seedProject(db);
    const root = await mkdtemp(path.join(tmpdir(), "bg-export-cancel-recovery-")); directories.push(root);
    const ids = createExportAuthority(db, { projectId: "p", revision: 3, digest: "a".repeat(64), designSystemDigest: null, format: "html_zip", options: {}, rendererDigest: "r", captureDigest: "c" });
    const published = path.join(root, "attempts", ids.attemptId);
    await mkdir(published, { recursive: true }); await writeFile(path.join(published, "artifact.zip"), "cancelled bytes");
    requestExportCancellation(db, ids.attemptId);
    await reconcileExportState(db, root);
    expect(db.query("SELECT status,stop_reason,json_extract(retention_json,'$.output_available') available FROM export_attempts WHERE id=?").get(ids.attemptId)).toEqual({ status: "cancelled", stop_reason: "user_cancelled", available: 0 });
    expect(await Bun.file(path.join(published, "artifact.zip")).exists()).toBe(false);
    expect(db.query("SELECT json_extract(payload_json,'$.status') status FROM events WHERE session_id='s'").all()).toEqual([{ status: "cancelled" }]);
  });

  test("Given a successful output removed externally When recovery runs Then success is invalidated and a retry can start", async () => {
    const db = await migratedDatabase(); seedProject(db);
    const root = await mkdtemp(path.join(tmpdir(), "bg-export-missing-success-")); directories.push(root);
    const identity = { projectId: "p", revision: 3, digest: "a".repeat(64), designSystemDigest: null };
    const ids = createExportAuthority(db, { ...identity, format: "html_zip", options: {}, rendererDigest: "r", captureDigest: "c" });
    advanceExportAttempt(db, { attemptId: ids.attemptId, status: "validating", stage: "publishing" });
    completeExportAttempt(db, { ...ids, outputPath: path.join(root, "attempts", ids.attemptId, "artifact.zip"), size: 1, outputDigest: "o", receiptDigest: "r" });
    await reconcileExportState(db, root);
    expect(db.query("SELECT status,output_path FROM exports WHERE id=?").get(ids.jobId)).toEqual({ status: "failed", output_path: null });
    expect(db.query("SELECT status,json_extract(retention_json,'$.output_available') available FROM export_attempts WHERE id=?").get(ids.attemptId)).toEqual({ status: "corrupt", available: 0 });
    expect(createRetryAuthority(db, { jobId: ids.jobId, parentAttemptId: ids.attemptId, identity, rendererDigest: "r", captureDigest: "c" })).toBeString();
  });

  test("Given a fresh database When 0009 is applied Then PNG and nullable lifecycle evidence are supported", async () => {
    const db = await migratedDatabase();
    seed(db);
    insertAttempt(db, "a1", null);

    expect(db.query("SELECT format,options_json FROM exports WHERE id='j'").get()).toEqual({
      format: "png",
      options_json: '{"png_width":1440,"png_height":900,"png_dpr":2}',
    });
    expect(db.query("SELECT input_closure_digest,output_digest,receipt_digest,design_system_digest,cancel_requested_at FROM export_attempts WHERE id='a1'").get()).toEqual({
      input_closure_digest: null,
      output_digest: null,
      receipt_digest: null,
      design_system_digest: null,
      cancel_requested_at: null,
    });
  });

  test("Given one active attempt When a second is inserted Then the database enforces one nonterminal attempt per job", async () => {
    const db = await migratedDatabase();
    seed(db);
    insertAttempt(db, "a1", null, "running");
    expect(() => insertAttempt(db, "a2", null, "pending")).toThrow();
  });

  test("Given one retry child When another child uses the same parent Then linear lineage is enforced", async () => {
    const db = await migratedDatabase();
    seed(db);
    insertAttempt(db, "a1", null, "failed");
    insertAttempt(db, "a2", "a1", "failed");
    expect(() => insertAttempt(db, "a3", "a1", "failed")).toThrow();
  });

  test("Given a legacy succeeded export When migrated Then no validation receipt is fabricated", async () => {
    const db = await migratedDatabase();
    db.exec(`INSERT INTO projects(id,name,type,dir_path,backend_id,created_at,updated_at) VALUES ('legacy-p','Legacy','prototype','/missing','codex',1,1);
      INSERT INTO exports(id,project_id,format,status,output_path,size_bytes,created_at,completed_at) VALUES ('legacy-j','legacy-p','html_zip','succeeded','/missing.zip',10,1,2);`);
    expect(db.query("SELECT COUNT(*) count FROM export_attempts WHERE job_id='legacy-j'").get()).toEqual({ count: 0 });
  });

  test("Given canonical options When authority is created and completed Then job and attempt transition atomically", async () => {
    const db = await migratedDatabase(); seedProject(db);
    const ids = createExportAuthority(db, { projectId: "p", revision: 3, digest: "a".repeat(64), designSystemDigest: null, format: "png", options: { png_width: 1440, png_height: 900, png_dpr: 2 }, rendererDigest: "r", captureDigest: "c" });
    advanceExportAttempt(db, { attemptId: ids.attemptId, status: "running", stage: "snapshotting" });
    advanceExportAttempt(db, { attemptId: ids.attemptId, status: "running", stage: "rendering", inputClosureDigest: "i" });
    advanceExportAttempt(db, { attemptId: ids.attemptId, status: "validating", stage: "validating" });
    completeExportAttempt(db, { ...ids, outputPath: "/owned/artifact.png", size: 42, outputDigest: "o", receiptDigest: "q" });
    expect(db.query("SELECT status,output_path,size_bytes FROM exports WHERE id=?").get(ids.jobId)).toEqual({ status: "succeeded", output_path: "/owned/artifact.png", size_bytes: 42 });
    expect(db.query("SELECT status,output_digest,receipt_digest FROM export_attempts WHERE id=?").get(ids.attemptId)).toEqual({ status: "validated", output_digest: "o", receipt_digest: "q" });
  });

  test("Given a failed parent When retries race Then options stay immutable and only one linear child wins", async () => {
    const db = await migratedDatabase(); seedProject(db);
    const ids = createExportAuthority(db, { projectId: "p", revision: 3, digest: "a".repeat(64), designSystemDigest: null, format: "pdf", options: { pdf_paper: "letter" }, rendererDigest: "r", captureDigest: "c" });
    db.prepare("UPDATE export_attempts SET status='failed',stop_reason='render_failed' WHERE id=?").run(ids.attemptId);
    const identity = { projectId: "p", revision: 4, digest: "b".repeat(64), designSystemDigest: null };
    const child = createRetryAuthority(db, { jobId: ids.jobId, parentAttemptId: ids.attemptId, identity, rendererDigest: "r2", captureDigest: "c2" });
    expect(() => createRetryAuthority(db, { jobId: ids.jobId, parentAttemptId: ids.attemptId, identity, rendererDigest: "r2", captureDigest: "c2" })).toThrow();
    expect(db.query("SELECT parent_attempt_id,canonical_options_json,project_revision,project_digest FROM export_attempts WHERE id=?").get(child)).toEqual({ parent_attempt_id: ids.attemptId, canonical_options_json: '{"pdf_paper":"letter"}', project_revision: 4, project_digest: "b".repeat(64) });
  });

  test("Given an active attempt When cancellation is requested Then persistence precedes idempotent abort ownership", async () => {
    const db = await migratedDatabase(); seedProject(db);
    const ids = createExportAuthority(db, { projectId: "p", revision: 3, digest: "a".repeat(64), designSystemDigest: null, format: "html_zip", options: {}, rendererDigest: "r", captureDigest: "c" });
    expect(requestExportCancellation(db, ids.attemptId)).toBe(true);
    expect(db.query("SELECT cancel_requested_at IS NOT NULL requested FROM export_attempts WHERE id=?").get(ids.attemptId)).toEqual({ requested: 1 });
  });

  test("Given missing and malformed owned restart shapes When reconciled Then failure and corruption are terminal", async () => {
    const db = await migratedDatabase(); seedProject(db); const root = await mkdtemp(path.join(tmpdir(), "bg-export-recovery-shapes-")); directories.push(root);
    const missing = createExportAuthority(db, { projectId: "p", revision: 3, digest: "a".repeat(64), designSystemDigest: null, format: "png", options: { png_width: 320, png_height: 240, png_dpr: 1 }, rendererDigest: "r", captureDigest: "c" }); await reconcileExportState(db, root);
    expect(db.query("SELECT status,stop_reason FROM export_attempts WHERE id=?").get(missing.attemptId)).toEqual({ status: "failed", stop_reason: "recovery_failed" });
    const malformed = createExportAuthority(db, { projectId: "p", revision: 3, digest: "a".repeat(64), designSystemDigest: null, format: "png", options: { png_width: 320, png_height: 240, png_dpr: 1 }, rendererDigest: "r", captureDigest: "c" }); db.prepare("UPDATE export_attempts SET status='running' WHERE id=?").run(malformed.attemptId); const stage = path.join(root, ".staging", malformed.attemptId); await mkdir(stage, { recursive: true }); await writeFile(path.join(stage, "receipt.json"), "{}"); await reconcileExportState(db, root);
    expect(db.query("SELECT status,stop_reason FROM export_attempts WHERE id=?").get(malformed.attemptId)).toEqual({ status: "corrupt", stop_reason: "receipt_corrupt" });
  });

  test("Given a forged PDF cross-field receipt When recovery runs Then authority becomes typed corrupt without digest propagation", async () => {
    const db = await migratedDatabase(); seedProject(db); const root = await mkdtemp(path.join(tmpdir(), "bg-export-forged-pdf-")); directories.push(root);
    const ids = createExportAuthority(db, { projectId: "p", revision: 3, digest: "a".repeat(64), designSystemDigest: null, format: "pdf", options: { pdf_paper: "letter" }, rendererDigest: "b".repeat(64), captureDigest: "c".repeat(64) }); db.prepare("UPDATE export_attempts SET status='recovering',input_closure_digest=? WHERE id=?").run("a".repeat(64), ids.attemptId);
    const published = path.join(root, "attempts", ids.attemptId); await mkdir(published, { recursive: true }); const output = Uint8Array.from([1, 2, 3]); await writeFile(path.join(published, "artifact.pdf"), output);
    const validation = JSON.parse(await readFile(new URL("./fixtures/forged-pdf-receipt-validation.json", import.meta.url), "utf8")); const receipt = { schema_version: 1, job_id: ids.jobId, attempt_id: ids.attemptId, parent_attempt_id: null, format: "pdf", project: { id: "p", revision: 3, digest: "a".repeat(64) }, options: { pdf_paper: "letter" }, output_file: "artifact.pdf", output_size: 3, digests: { input_closure: "a".repeat(64), design_system: null, options: sha256(canonicalJson({ pdf_paper: "letter" })), renderer: "b".repeat(64), capture: "c".repeat(64), output: sha256(output) }, validation }; await writeFile(path.join(published, "receipt.json"), canonicalJson(receipt));
    await reconcileExportState(db, root);
    expect(db.query("SELECT status,stop_reason,output_digest,receipt_digest FROM export_attempts WHERE id=?").get(ids.attemptId)).toEqual({ status: "corrupt", stop_reason: "receipt_corrupt", output_digest: null, receipt_digest: null }); expect(db.query("SELECT status,output_path FROM exports WHERE id=?").get(ids.jobId)).toEqual({ status: "failed", output_path: null });
  });

  test("Given forged authority tuples When recovery parses owned receipts Then none propagate", async () => {
    for (const attack of ["project_id", "project_digest", "parent", "options", "provenance", "png_dimensions"] as const) {
      const db = await migratedDatabase(); seedProject(db); const root = await mkdtemp(path.join(tmpdir(), `bg-export-authority-${attack}-`)); directories.push(root); const renderer = "b".repeat(64); const capture = "c".repeat(64); const closure = "d".repeat(64);
      const ids = createExportAuthority(db, { projectId: "p", revision: 3, digest: "a".repeat(64), designSystemDigest: null, format: "png", options: { png_width: 320, png_height: 240, png_dpr: 1 }, rendererDigest: renderer, captureDigest: capture }); db.prepare("UPDATE export_attempts SET status='recovering',input_closure_digest=? WHERE id=?").run(closure, ids.attemptId);
      const published = path.join(root, "attempts", ids.attemptId); await mkdir(published, { recursive: true }); const output = Uint8Array.from([1, 2, 3]); await writeFile(path.join(published, "artifact.png"), output); const canonicalOptions = { png_width: 320, png_height: 240, png_dpr: 1 }; let parentAttemptId: string | null = null; let designSystemDigest: string | null = null;
      const receipt = { schema_version: 1, job_id: ids.jobId, attempt_id: ids.attemptId, parent_attempt_id: parentAttemptId, format: "png", project: { id: "p", revision: 3, digest: "a".repeat(64) }, options: canonicalOptions, output_file: "artifact.png", output_size: 3, digests: { input_closure: closure, design_system: designSystemDigest, options: sha256(canonicalJson(canonicalOptions)), renderer, capture, output: sha256(output) }, validation: { width: 320, height: 240, statistics: { pixels: 76_800, visible_pixels: 76_800, differing_pixels: 100, dominant_ratio: 0.9, luminance_variance: 10, entropy: 0.2 } } };
      if (attack === "project_id") receipt.project.id = "forged"; if (attack === "project_digest") receipt.project.digest = "e".repeat(64); if (attack === "parent") receipt.parent_attempt_id = "forged-parent"; if (attack === "provenance") { receipt.digests.input_closure = "e".repeat(64); receipt.digests.design_system = "f".repeat(64); receipt.digests.renderer = "1".repeat(64); receipt.digests.capture = "2".repeat(64); } if (attack === "options") { receipt.options = { png_width: 321, png_height: 240, png_dpr: 1 }; receipt.digests.options = sha256(canonicalJson(receipt.options)); receipt.validation.width = 321; receipt.validation.statistics.pixels = 77_040; } if (attack === "png_dimensions") receipt.validation.width = 321;
      await writeFile(path.join(published, "receipt.json"), canonicalJson(receipt)); await reconcileExportState(db, root); expect(db.query("SELECT status,stop_reason,output_digest,receipt_digest FROM export_attempts WHERE id=?").get(ids.attemptId), attack).toEqual({ status: "corrupt", stop_reason: "receipt_corrupt", output_digest: null, receipt_digest: null });
    }
  });

  test("Given a recoverable PNG ZIP stage When recovery publishes Then frame and platform scratch directories are removed", async () => {
    // Given
    const db = await migratedDatabase(); seedProject(db); const root = await mkdtemp(path.join(tmpdir(), "bg-export-frame-recovery-")); directories.push(root);
    const options = { slice_height: 5000, slice_format: "png" } as const;
    const renderer = "b".repeat(64); const capture = "c".repeat(64); const closure = "d".repeat(64);
    const ids = createExportAuthority(db, { projectId: "p", revision: 3, digest: "a".repeat(64), designSystemDigest: null, format: "png_zip", options, rendererDigest: renderer, captureDigest: capture });
    db.prepare("UPDATE export_attempts SET status='recovering',input_closure_digest=? WHERE id=?").run(closure, ids.attemptId);
    const stage = path.join(root, ".staging", ids.attemptId); await mkdir(path.join(stage, "frames"), { recursive: true }); await mkdir(path.join(stage, "platform"), { recursive: true });
    const output = Uint8Array.from([1, 2, 3]); await writeFile(path.join(stage, "artifact.zip"), output); await writeFile(path.join(stage, "frames", "01.png"), "scratch"); await writeFile(path.join(stage, "platform", "GUIDE.html"), "scratch");
    const receipt: ExportReceipt = { schema_version: 1, job_id: ids.jobId, attempt_id: ids.attemptId, parent_attempt_id: null, format: "png_zip", project: { id: "p", revision: 3, digest: "a".repeat(64) }, options, output_file: "artifact.zip", output_size: output.byteLength, digests: { input_closure: closure, design_system: null, options: sha256(canonicalJson(options)), renderer, capture, output: sha256(output) }, validation: { transformation_version: 1, outputs: [{ rel_path: "01.png", width: 1080, height: 1080, image_format: "png", bytes: 7, sha256: "e".repeat(64), sequence: 1, source_region: { top: 0, bottom: 1080 } }], aggregate: { frames: 1, dpr: 1 } } };
    await writeFile(path.join(stage, "receipt.json"), canonicalJson(receipt));

    // When
    await reconcileExportState(db, root);

    // Then
    const published = path.join(root, "attempts", ids.attemptId);
    expect(await Bun.file(path.join(published, "artifact.zip")).exists()).toBe(true);
    expect(await Bun.file(path.join(published, "frames", "01.png")).exists()).toBe(false);
    expect(await Bun.file(path.join(published, "platform", "GUIDE.html")).exists()).toBe(false);
    expect(db.query("SELECT status FROM exports WHERE id=?").get(ids.jobId)).toEqual({ status: "succeeded" });
  });

  test("Given publish completed before DB commit When startup reconciles Then authority converges once", async () => {
    const db = await migratedDatabase(); seedProject(db); const root = await mkdtemp(path.join(tmpdir(), "bg-export-recover-")); directories.push(root);
    const ids = createExportAuthority(db, { projectId: "p", revision: 3, digest: "a".repeat(64), designSystemDigest: null, format: "png", options: { png_width: 320, png_height: 240, png_dpr: 1 }, rendererDigest: "b".repeat(64), captureDigest: "c".repeat(64) });
    db.prepare("UPDATE export_attempts SET status='recovering',input_closure_digest=? WHERE id=?").run("a".repeat(64), ids.attemptId);
    const published = path.join(root, "attempts", ids.attemptId); await mkdir(published, { recursive: true }); const output = Uint8Array.from([1, 2, 3]); await writeFile(path.join(published, "artifact.png"), output);
    const receipt: ExportReceipt = { schema_version: 1, job_id: ids.jobId, attempt_id: ids.attemptId, parent_attempt_id: null, format: "png", project: { id: "p", revision: 3, digest: "a".repeat(64) }, options: { png_width: 320, png_height: 240, png_dpr: 1 }, output_file: "artifact.png", output_size: 3, digests: { input_closure: "a".repeat(64), design_system: null, options: sha256(canonicalJson({ png_width: 320, png_height: 240, png_dpr: 1 })), renderer: "b".repeat(64), capture: "c".repeat(64), output: sha256(output) }, validation: { width: 320, height: 240, statistics: { pixels: 76_800, visible_pixels: 76_800, differing_pixels: 100, dominant_ratio: 0.9, luminance_variance: 10, entropy: 0.2 } } }; await writeFile(path.join(published, "receipt.json"), canonicalJson(receipt));
    db.exec("CREATE TRIGGER reject_recovery_event BEFORE INSERT ON events WHEN NEW.type='export.attempt' AND json_extract(NEW.payload_json,'$.status')='validated' BEGIN SELECT RAISE(ABORT,'event_insert_blocked'); END");
    await expect(reconcileExportState(db, root)).rejects.toThrow("event_insert_blocked");
    expect(db.query("SELECT status,stop_reason FROM export_attempts WHERE id=?").get(ids.attemptId)).toEqual({ status: "recovering", stop_reason: null });
    expect(db.query("SELECT status,output_path FROM exports WHERE id=?").get(ids.jobId)).toEqual({ status: "pending", output_path: null });
    expect(new Uint8Array(await readFile(path.join(published, "artifact.png")))).toEqual(output);
    expect(await readFile(path.join(published, "receipt.json"), "utf8")).toBe(canonicalJson(receipt));
    db.exec("DROP TRIGGER reject_recovery_event");
    await reconcileExportState(db, root); await reconcileExportState(db, root);
    expect(db.query("SELECT status FROM exports WHERE id=?").get(ids.jobId)).toEqual({ status: "succeeded" });
    expect(db.query("SELECT status,receipt_digest FROM export_attempts WHERE id=?").get(ids.attemptId)).toEqual({ status: "validated", receipt_digest: receiptDigest(receipt) });
    expect(db.query("SELECT type,sequence FROM events WHERE session_id='s'").all()).toEqual([{ type: "export.attempt", sequence: 1 }]);
  });
});

function seedProject(db: Database): void {
  db.exec(`INSERT INTO projects(id,name,type,dir_path,backend_id,created_at,updated_at,current_revision,current_digest) VALUES ('p','Project','slide_deck','/tmp/project','codex',1,1,3,'${"a".repeat(64)}'); INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('s','p','codex','idle',1,1,1)`);
}
