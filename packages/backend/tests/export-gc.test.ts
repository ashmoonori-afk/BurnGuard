import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { advanceExportAttempt, completeExportAttempt, createExportAuthority } from "../src/db/export-lifecycle-repository";
import { exportsDir } from "../src/lib/paths";
import { pruneOldExports, type ExpiredAttempt } from "../src/services/export-gc";
import { exportGcStorage } from "../src/services/export-gc-storage";

const NOW = Date.UTC(2026, 3, 25);
function attempt(overrides: Partial<ExpiredAttempt> = {}): ExpiredAttempt {
  return { attemptId: "attempt-1", jobId: "job-1", retainedUntil: NOW - 1, outputAvailable: true, ...overrides };
}

describe("pruneOldExports", () => {
  test("Given completed owned output When its persisted deadline arrives Then real storage expires it exactly once", async () => {
    await runMigrations();
    const db = getSqlite(); const projectId = `gc-deadline-${process.pid}`;
    db.prepare("INSERT INTO projects(id,name,type,dir_path,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'codex',1,1)").run(projectId, "GC deadline", projectId);
    const ids = createExportAuthority(db, { projectId, revision: 1, digest: "a".repeat(64), designSystemDigest: null, format: "html_zip", options: {}, rendererDigest: "r", captureDigest: "c" });
    const root = path.join(exportsDir, "attempts", ids.attemptId), output = path.join(root, "artifact.zip");
    try {
      await mkdir(root, { recursive: true }); await writeFile(output, "owned");
      advanceExportAttempt(db, { attemptId: ids.attemptId, status: "validating", stage: "publishing" });
      completeExportAttempt(db, { ...ids, outputPath: output, size: 5, outputDigest: "o", receiptDigest: "r" });
      const deadline = db.query<{ deadline: number }, [string]>("SELECT json_extract(retention_json,'$.retained_until') deadline FROM export_attempts WHERE id=?").get(ids.attemptId)?.deadline;
      if (deadline === undefined) throw new Error("Retention was not persisted");
      const deps = { listExpired: async (cutoff: number) => (await exportGcStorage.listExpired(cutoff)).filter((item) => item.attemptId === ids.attemptId) };
      expect((await pruneOldExports({ now: deadline - 1 }, deps)).removedJobs).toBe(0);
      expect(await Bun.file(output).exists()).toBe(true);
      expect((await pruneOldExports({ now: deadline }, deps)).removedFiles).toEqual([ids.attemptId]);
      expect(await Bun.file(output).exists()).toBe(false);
      expect((await pruneOldExports({ now: deadline + 1 }, deps)).removedJobs).toBe(0);
      expect(db.query("SELECT status FROM export_attempts WHERE id=?").get(ids.attemptId)).toEqual({ status: "expired" });
    } finally { db.prepare("DELETE FROM projects WHERE id=?").run(projectId); await rm(root, { recursive: true, force: true }); }
  });

  test("Given an absolute retention deadline When GC selects work Then expiration is compared with now once", async () => {
    const deadlines: number[] = [];
    await pruneOldExports({ now: NOW }, { listExpired: async (cutoff) => { deadlines.push(cutoff); return []; }, claim: async () => true, removeDirectory: async () => 0 });
    expect(deadlines).toEqual([NOW]);
  });

  test("Given expired validated output When GC runs Then authority is claimed before owned bytes are removed", async () => {
    const order: string[] = [];
    const result = await pruneOldExports({ now: NOW }, {
      listExpired: async () => [attempt()],
      claim: async (id) => { order.push(`claim:${id}`); return true; },
      removeDirectory: async (id) => { order.push(`remove:${id}`); return 2048; },
    });
    expect(order).toEqual(["claim:attempt-1", "remove:attempt-1"]);
    expect(result.removedJobs).toBe(1);
    expect(result.removedBytes).toBe(2048);
  });

  test("Given a concurrent claim loss When GC runs Then bytes remain untouched", async () => {
    let removed = false;
    const result = await pruneOldExports({ now: NOW }, {
      listExpired: async () => [attempt()], claim: async () => false,
      removeDirectory: async () => { removed = true; return 1; },
    });
    expect(removed).toBe(false);
    expect(result.removedJobs).toBe(0);
  });

  test("Given an already tombstoned attempt after a crash When GC restarts Then removal completes without a second claim", async () => {
    let claims = 0;
    const result = await pruneOldExports({ now: NOW }, {
      listExpired: async () => [attempt({ outputAvailable: false })],
      claim: async () => { claims += 1; return true; },
      removeDirectory: async () => 512,
    });
    expect(claims).toBe(0);
    expect(result.removedBytes).toBe(512);
    expect(result.removedFiles).toEqual(["attempt-1"]);
  });

  test("Given unlink failure after tombstone When GC runs Then audit remains claimed and failure is reported", async () => {
    const result = await pruneOldExports({ now: NOW }, {
      listExpired: async () => [attempt()], claim: async () => true,
      removeDirectory: async () => { throw new TypeError("owned unlink failed"); },
    });
    expect(result.removedJobs).toBe(0);
    expect(result.warnings).toEqual(["owned unlink failed"]);
  });

  test("Given dry run When GC plans Then neither claim nor unlink occurs", async () => {
    let effects = 0;
    const result = await pruneOldExports({ now: NOW, dryRun: true }, {
      listExpired: async () => [attempt()], claim: async () => { effects += 1; return true; },
      removeDirectory: async () => { effects += 1; return 1; },
    });
    expect(effects).toBe(0);
    expect(result.removedJobs).toBe(1);
  });
});
