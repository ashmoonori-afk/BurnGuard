import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { ExportOptions } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { advanceExportAttempt, createExportAuthority, failExportAttempt, recordExportAuditFindings } from "../src/db/export-lifecycle-repository";
import { getSqlite } from "../src/db/sqlite-client";
import { buildPlatformPackage } from "../src/services/export-platform-package";
import { exportStopReason, recordPlatformFindings } from "../src/services/exports";
import { FIXTURE_ENTRYPOINT, stagePlatformFixture } from "./helpers/platform-package-fixture";

const projectId = `platform-findings-${process.pid}`;
const options: ExportOptions = {};
const roots: string[] = [];

beforeAll(async () => {
  await runMigrations();
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at,current_revision,current_digest) VALUES (?,?,'prototype',?,?,'codex',1,1,4,?)").run(projectId, "Shop Site", `/tmp/${projectId}`, FIXTURE_ENTRYPOINT, "a".repeat(64));
});

afterAll(async () => {
  getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function newAttempt(format: "cafe24_package" | "imweb_package"): { readonly jobId: string; readonly attemptId: string } {
  const ids = createExportAuthority(getSqlite(), { projectId, revision: 4, digest: "a".repeat(64), designSystemDigest: null, format, options, rendererDigest: "r".repeat(64), captureDigest: "c".repeat(64) });
  advanceExportAttempt(getSqlite(), { attemptId: ids.attemptId, status: "running", stage: "rendering", inputClosureDigest: "d".repeat(64), designSystemDigest: null });
  return ids;
}

function attemptRow(attemptId: string): { readonly findings: readonly { readonly code: string; readonly path: string | null }[]; readonly stopReason: string | null } {
  const row = getSqlite().query<{ readonly findings_json: string; readonly stop_reason: string | null }, [string]>("SELECT findings_json,stop_reason FROM export_attempts WHERE id=?").get(attemptId);
  return { findings: JSON.parse(row?.findings_json ?? "[]"), stopReason: row?.stop_reason ?? null };
}

async function build(attemptId: string, format: "cafe24_package" | "imweb_package", main?: string): Promise<void> {
  const stagedDir = await stagePlatformFixture(main);
  roots.push(stagedDir);
  await buildPlatformPackage({
    paths: { staged: stagedDir, scratch: path.join(path.dirname(stagedDir), `${path.basename(stagedDir)}-package`), output: path.join(path.dirname(stagedDir), `${path.basename(stagedDir)}-artifact.zip`) },
    format,
    options,
    project: { name: "Shop Site", entrypoint: FIXTURE_ENTRYPOINT, revision: 4, digest: "a".repeat(64) },
    onFindings: (findings) => { recordPlatformFindings(attemptId, findings); },
  });
}

describe("platform lint findings on the export attempt", () => {
  test("Given a cafe24 package with warning-only lint When the package is built Then the attempt keeps the audit findings and the lint codes", async () => {
    // Given
    const { attemptId } = newAttempt("cafe24_package");
    const audit = [{ code: "design_audit:contrast:fail", path: "home.html" }];
    recordExportAuditFindings(getSqlite(), attemptId, audit);

    // When
    await build(attemptId, "cafe24_package");

    // Then
    const { findings } = attemptRow(attemptId);
    expect(findings).toContainEqual({ code: "design_audit:contrast:fail", path: "home.html" });
    expect(findings.map((finding) => finding.code)).toContain("cafe24_disallowed_extension");
    expect(findings.some((finding) => finding.code === "cafe24_disallowed_extension" && finding.path !== null)).toBe(true);
  });

  test("Given an imweb page over one million characters When the package is built Then the blocking finding is on the attempt before the failure is recorded", async () => {
    // Given
    const { jobId, attemptId } = newAttempt("imweb_package");
    const oversized = `<section class="hero" id="hero"><p>${"가".repeat(1_000_001)}</p></section>`;

    // When
    const error = await build(attemptId, "imweb_package", oversized).then(() => null, (reason: unknown) => reason);

    // Then
    expect(error).toMatchObject({ name: "ExportError", code: "platform_lint_failed" });
    expect(attemptRow(attemptId).findings.map((finding) => finding.code)).toContain("imweb_page_over_1m_chars");
    expect(exportStopReason(error)).toBe("validation_failed");
    failExportAttempt(getSqlite(), { jobId, attemptId, status: "failed", reason: exportStopReason(error), message: "platform lint failed" });
    const failed = attemptRow(attemptId);
    expect(failed.stopReason).toBe("validation_failed");
    expect(failed.findings.map((finding) => finding.code)).toContain("imweb_page_over_1m_chars");
  }, 30_000);
});
