import { describe, expect, test } from "bun:test";
import type { DesignAuditCheck, DesignAuditFinding, DesignAuditResult, ExportAttempt, ExportJob, ExportStatus } from "@bg/shared";
import { exportJobState, exportTransitions } from "../src/components/export/export-job-state";
import { shareExportReady } from "../src/components/export/VercelShare";
import { qualityStatusKey } from "../src/components/modes/QualityPanel";
import { exportQualityGate } from "../src/lib/design-audit-state";

const attempt: ExportAttempt = { id: "attempt", job_id: "job", parent_attempt_id: null, status: "validated", project_revision: 4, project_digest: "digest", digests: { options: "options", input_closure: null, design_system: null, renderer: "renderer", capture: null, output: "output", receipt: "receipt" }, progress: { stage: "complete", completed: 6, total: 6 }, stop_reason: null, findings: [], retention: { retained_until: 1000, output_available: true }, cancel_requested_at: null, created_at: 1, updated_at: 1 };
const job = (overrides: Partial<ExportJob> = {}): ExportJob => ({ id: "job", project_id: "project", format: "pdf", status: "succeeded", output_path: null, error_message: null, size_bytes: 4, options: {}, latest_attempt: attempt, created_at: 1, completed_at: 2, ...overrides });

const DIGEST = "a".repeat(64);
function finding(severity: DesignAuditFinding["severity"]): DesignAuditFinding {
  return { id: `finding-${severity}`, check_code: "contrast", severity, source: { rel_path: "index.html", node_bg_id: "hero" }, evidence: "2.1 below 4.5", measured: 2.1, threshold: 4.5, targeted_action: "increase_color_contrast" };
}
function report(overall_status: DesignAuditResult["overall_status"], findings: readonly DesignAuditFinding[]): DesignAuditResult {
  const checks: readonly DesignAuditCheck[] = [{ code: "contrast", status: findings.length > 0 ? "fail" : "pass", reason: null, findings }];
  return { schema_version: 1, project_id: "project", artifact_revision: 2, artifact_digest: DIGEST, created_at: 100, overall_status, checks };
}

describe("export quality gate copy (UXM-12, DP-19)", () => {
  test("Given a must-fix report When the gate and the panel status are derived Then both keys belong to the fix family", () => {
    const mustFix = report("must_fix", [finding("must_fix"), finding("recommended")]);
    const gate = exportQualityGate(mustFix, DIGEST);
    expect(gate).toEqual({ mustFixCount: 1, copyKey: "export.qualityMustFix" });
    expect(qualityStatusKey({ kind: "must_fix", running: false, report: mustFix })).toBe("modes.quality.needsFix");
    expect(qualityStatusKey({ kind: "must_fix", running: true, report: mustFix })).toBe("modes.quality.rerunning");
  });

  test("Given a recommended report When the gate and the panel status are derived Then neither names a fix", () => {
    const recommended = report("recommended", [finding("recommended")]);
    expect(exportQualityGate(recommended, DIGEST)).toBeNull();
    expect(qualityStatusKey({ kind: "recommended", running: false, report: recommended })).toBe("modes.quality.recommendedStatus");
  });

  test("Given a must-fix report for an older artifact When the gate is derived Then it is absent", () => {
    expect(exportQualityGate(report("must_fix", [finding("must_fix")]), "b".repeat(64))).toBeNull();
    expect(exportQualityGate(null, DIGEST)).toBeNull();
  });
});

describe("export outcome transitions (UXM-20)", () => {
  test("Given a job that moves from running to succeeded between polls When transitions are derived Then exactly one success is reported", () => {
    const seen = new Map<string, ExportStatus>([["job", "running"]]);
    expect(exportTransitions(seen, [job()])).toEqual([{ job: job(), outcome: "succeeded" }]);
    expect(exportTransitions(seen, [job()])).toEqual([]);
  });

  test("Given a job that fails When transitions are derived Then a failure is reported once and a cancellation is not", () => {
    const failed = job({ status: "failed", latest_attempt: { ...attempt, status: "failed", stop_reason: "render_failed" } });
    const cancelled = job({ id: "cancelled", status: "failed", latest_attempt: { ...attempt, status: "cancelled", stop_reason: "user_cancelled" } });
    const seen = new Map<string, ExportStatus>([["job", "running"], ["cancelled", "running"]]);
    expect(exportTransitions(seen, [failed, cancelled])).toEqual([{ job: failed, outcome: "failed" }]);
    expect(exportTransitions(seen, [failed, cancelled])).toEqual([]);
  });

  test("Given a job first seen already succeeded When transitions are derived Then nothing is reported for it", () => {
    const seen = new Map<string, ExportStatus>();
    expect(exportTransitions(seen, [job()], { initial: true })).toEqual([]);
    expect(seen.get("job")).toBe("succeeded");
  });

  test("Given the export menu source When scanned Then the audit-failure branches are gone and success reaches a toast (UXM-01)", async () => {
    const source = await Bun.file(new URL("../src/components/export/ExportMenu.tsx", import.meta.url)).text();
    expect(source).not.toContain("isDesignAuditExportFailure");
    expect(source).not.toContain("auditStopped");
    expect(source).not.toContain("auditFailed");
    expect(source).toContain('"export.succeededFormat"');
    expect(source).toContain("exportTransitions(");
  });
});

describe("share readiness (UXM-32)", () => {
  test("Given a succeeded job whose output expired When readiness is derived Then publishing is not offered", () => {
    const expired = job({ latest_attempt: { ...attempt, status: "expired", retention: { retained_until: 0, output_available: false } } });
    expect(exportJobState(expired).canDownload).toBe(false);
    expect(shareExportReady(expired)).toBe(false);
  });

  test("Given a succeeded, validated job When readiness is derived Then publishing is offered", () => {
    expect(shareExportReady(job())).toBe(true);
    expect(shareExportReady(undefined)).toBe(false);
    expect(shareExportReady(job({ status: "running" }))).toBe(false);
  });

  test("Given the share dialog source When scanned Then the ready line and the publish control both derive from the same readiness", async () => {
    const source = await Bun.file(new URL("../src/components/export/VercelShare.tsx", import.meta.url)).text();
    expect(source).not.toContain('job.data?.status === "succeeded"');
    expect(source).not.toContain('job.data?.status !== "succeeded"');
    expect(source.match(/shareExportReady\(job\.data\)/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});
