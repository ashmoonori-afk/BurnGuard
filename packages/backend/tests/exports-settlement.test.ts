import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { SequencedEventEnvelope } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { exportsDir, projectsDir } from "../src/lib/paths";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { sequencedBroker } from "../src/services/broker";
import { enqueueProjectExport, retryProjectExport, type ExportHooks } from "../src/services/exports";

const projectId = `export-settlement-${process.pid}`;
const sessionId = `${projectId}-session`;
const projectDir = path.join(projectsDir, projectId);

beforeAll(async () => {
  await runMigrations();
  await fsp.mkdir(projectDir, { recursive: true });
  await fsp.writeFile(path.join(projectDir, "index.html"), "<!doctype html><html><head><title>Settlement</title></head><body><main>Settlement</main></body></html>");
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,options_json,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',NULL,1,1)").run(projectId, "Settlement", projectDir);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
  await new ArtifactCoordinator(getSqlite()).initialize(projectId, projectDir);
});

afterAll(async () => {
  getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
  await fsp.rm(projectDir, { recursive: true, force: true });
});

/** Fails the render right after the snapshot so runExport enters its catch block. */
const failAfterSnapshot = (onFailure: (attemptId: string) => void = () => {}): ExportHooks => ({
  phase: (attemptId, phase) => { if (phase !== "after_snapshot") return; onFailure(attemptId); throw new Error("render_probe"); },
});

type Outcome = { readonly kind: "terminal"; readonly status: string } | { readonly kind: "logged"; readonly args: readonly unknown[] } | { readonly kind: "escaped" } | { readonly kind: "timeout" };

/** Resolves on the first settlement signal: a terminal export event, a matching console.warn, or an escaped rejection. */
function settlement(logged: (args: readonly unknown[]) => boolean = () => false) {
  let resolve: (outcome: Outcome) => void = () => {};
  const outcome = new Promise<Outcome>((done) => { resolve = done; });
  const deadline = setTimeout(() => resolve({ kind: "timeout" }), 20_000);
  const observe = (): void => { resolve({ kind: "escaped" }); };
  process.on("unhandledRejection", observe);
  const unsubscribe = sequencedBroker.subscribe(sessionId, (item: SequencedEventEnvelope) => {
    if (item.event.type === "export.attempt" && ["failed", "cancelled", "validated"].includes(item.event.status)) resolve({ kind: "terminal", status: item.event.status });
  });
  const warn = spyOn(console, "warn").mockImplementation((...args: unknown[]) => { if (logged(args)) resolve({ kind: "logged", args }); });
  const dispose = (): void => { clearTimeout(deadline); process.off("unhandledRejection", observe); unsubscribe(); warn.mockRestore(); };
  return { outcome: outcome.finally(dispose) };
}

describe("export settlement", () => {
  test("Given a failed render whose staged tree removal rejects with EBUSY When the attempt settles Then it is failed with render_failed and no rejection escapes", async () => {
    // Given
    const original = fsp.rm; let busy: { mockRestore: () => void } | null = null; let attemptId = "";
    const hooks = failAfterSnapshot((id) => {
      attemptId = id;
      busy = spyOn(fsp, "rm").mockImplementation(async (target, options) => { if (String(target).includes(id)) throw Object.assign(new Error("resource busy"), { code: "EBUSY" }); return original(target, options); });
    });
    const settled = settlement();
    try {
      // When
      const job = await enqueueProjectExport(projectId, "html_zip", {}, hooks);
      const outcome = await settled.outcome;
      // Then
      expect(outcome).toEqual({ kind: "terminal", status: "failed" });
      expect(getSqlite().query("SELECT status,stop_reason FROM export_attempts WHERE id=?").get(attemptId)).toEqual({ status: "failed", stop_reason: "render_failed" });
      expect(getSqlite().query("SELECT status FROM exports WHERE id=?").get(job!.id)).toEqual({ status: "failed" });
    } finally {
      (busy as { mockRestore: () => void } | null)?.mockRestore();
      if (attemptId) await fsp.rm(path.join(exportsDir, ".staging", attemptId), { recursive: true, force: true });
    }
  });

  test.each(["enqueue", "retry"] as const)("Given the terminal write of a failed %s attempt is rejected When runExport settles Then the launch site logs the attempt id without a path and no rejection escapes", async (site) => {
    // Given
    const db = getSqlite(); let attemptId = "";
    const parent = site === "retry" ? await (async () => { const first = settlement(); const job = await enqueueProjectExport(projectId, "html_zip", {}, failAfterSnapshot()); expect(await first.outcome).toEqual({ kind: "terminal", status: "failed" }); return job!.id; })() : null;
    db.exec("CREATE TRIGGER block_export_settlement BEFORE UPDATE OF status ON export_attempts WHEN NEW.status='failed' BEGIN SELECT RAISE(ABORT,'settlement_blocked'); END");
    const settled = settlement((args) => attemptId !== "" && args.includes(attemptId));
    try {
      // When
      const hooks = failAfterSnapshot((id) => { attemptId = id; });
      if (parent === null) await enqueueProjectExport(projectId, "html_zip", {}, hooks); else await retryProjectExport(parent, hooks);
      const outcome = await settled.outcome;
      // Then
      expect(outcome.kind).toBe("logged");
      const args = outcome.kind === "logged" ? outcome.args : [];
      expect(args.every((arg) => typeof arg === "string" && !arg.includes("/") && !arg.includes("\\"))).toBe(true);
    } finally {
      db.exec("DROP TRIGGER IF EXISTS block_export_settlement");
      if (attemptId) db.prepare("UPDATE export_attempts SET status='failed',stop_reason='render_failed' WHERE id=?").run(attemptId);
    }
  });
});
