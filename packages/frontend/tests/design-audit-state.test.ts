import { describe, expect, test } from "bun:test";
import type { DesignAuditCheck, DesignAuditFinding, DesignAuditResult } from "@bg/shared";
import { ApiError } from "../src/api/client";
import { designAuditActionAvailability, designAuditControlAvailability, designAuditErrorCode, designAuditViewState, groupDesignAuditResult, isDesignAuditCurrent, preferDesignAuditResult } from "../src/lib/design-audit-state";
import { DESIGN_AUDIT_ERROR_COPY } from "../src/components/modes/design-audit-copy";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import QualityPanel, { type QualityPanelBinding } from "../src/components/modes/QualityPanel";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
function finding(overrides: Partial<DesignAuditFinding> = {}): DesignAuditFinding {
  return { id: "finding-1", check_code: "contrast", severity: "must_fix", source: { rel_path: "index.html", node_bg_id: "hero-title" }, evidence: "Contrast ratio 2.1 is below 4.5", measured: 2.1, threshold: 4.5, targeted_action: "increase_color_contrast", ...overrides };
}
function check(overrides: Partial<DesignAuditCheck>): DesignAuditCheck {
  return { code: "contrast", status: "pass", reason: null, findings: [], ...overrides };
}
function result(overrides: Partial<DesignAuditResult> = {}): DesignAuditResult {
  const checks: readonly DesignAuditCheck[] = [check({ code: "text_overflow" }), check({ code: "element_overlap" }), check({ code: "minimum_text_size" }), check({ code: "contrast" }), check({ code: "narrow_width" }), check({ code: "duplicate_node_id" }), check({ code: "missing_image" }), check({ code: "token_usage" })];
  return { schema_version: 1, project_id: "project-1", artifact_revision: 2, artifact_digest: DIGEST_A, created_at: 100, overall_status: "ready", checks, ...overrides };
}

test("Given quality findings When current or busy Then automatic repair is enabled only for the current idle report", () => {
  const report = result({ overall_status: "must_fix", checks: [check({ status: "fail", findings: [finding()] })] });
  const quality: QualityPanelBinding = { state: { kind: "must_fix", running: false, report }, pendingFindingId: null, focusedFindingId: null, revealResult: null, onRetry() {}, onOpenFile() {}, onReveal() {}, onApplySafeFix() {}, onAutoFix() {}, autoFixPending: false, autoFixDisabled: false };
  const repairButton = (binding: QualityPanelBinding) => renderToStaticMarkup(createElement(QualityPanel, { quality: binding })).match(/<button[^>]*>[\s\S]*?<\/button>/g)?.find((button) => button.includes("문제 자동 수정") || button.includes("자동으로 수정하고 있어요")) ?? "";
  expect(repairButton(quality)).not.toContain('disabled=""');
  expect(repairButton({ ...quality, autoFixPending: true })).toContain('disabled=""');
  expect(repairButton({ ...quality, autoFixDisabled: true })).toContain('disabled=""');
  expect(repairButton({ ...quality, state: { kind: "stale", running: false, report } })).toContain('disabled=""');
  expect(repairButton({ ...quality, state: { kind: "ready", running: false, report: result() } })).toContain('disabled=""');
});

describe("preferDesignAuditResult", () => {
  test("Given snapshots for different projects When merging Then only the current project is accepted", () => {
    const current = result();
    const other = result({ project_id: "project-2", artifact_revision: 9 });
    expect(preferDesignAuditResult(current, other, "project-1")).toBe(current);
    expect(preferDesignAuditResult(null, other, "project-1")).toBeNull();
  });
  test("Given out-of-order snapshots When merging Then revision and creation time decide freshness", () => {
    const current = result({ artifact_revision: 3, created_at: 100 });
    expect(preferDesignAuditResult(current, result({ artifact_revision: 2, created_at: 999 }), "project-1")).toBe(current);
    const newer = result({ artifact_revision: 3, created_at: 101 });
    expect(preferDesignAuditResult(current, newer, "project-1")).toBe(newer);
  });
});

describe("design audit grouping and actions", () => {
  test("Given fail, unknown, and pass checks When grouped Then unknown never contributes to pass", () => {
    const report = result({ overall_status: "must_fix", checks: [
      check({ code: "text_overflow", status: "fail", findings: [finding({ check_code: "text_overflow", targeted_action: "expand_or_reflow_text" })] }),
      check({ code: "element_overlap", status: "fail", findings: [finding({ id: "recommended", check_code: "element_overlap", severity: "recommended", targeted_action: "separate_overlapping_elements" })] }),
      check({ code: "minimum_text_size" }), check({ code: "contrast" }),
      check({ code: "narrow_width", status: "unmeasurable", reason: "unresolvable_rendering" }),
      check({ code: "duplicate_node_id" }), check({ code: "missing_image" }),
      check({ code: "token_usage", status: "skipped", reason: "tokens_not_exposed" }),
    ] });
    const grouped = groupDesignAuditResult(report);
    expect(grouped.mustFix.map((item) => item.id)).toEqual(["finding-1"]);
    expect(grouped.recommended.map((item) => item.id)).toEqual(["recommended"]);
    expect(grouped.unknown.map((item) => [item.code, item.status, item.reason])).toEqual([["narrow_width", "unmeasurable", "unresolvable_rendering"], ["token_usage", "skipped", "tokens_not_exposed"]]);
    expect(grouped.passedCount).toBe(4);
  });
  test("Given a stale safe-fix finding When resolving actions Then reveal stays available and mutation is closed", () => {
    const withFix = finding({ safe_fix: { kind: "patch_html_node", rel_path: "index.html", request: { node_bg_id: "hero-title", styles: { "font-size": "12px" } } } });
    expect(designAuditActionAvailability(withFix, { current: false, running: false, pendingFindingId: null })).toEqual({ canOpenFile: true, canReveal: true, canApplySafeFix: false, applying: false });
  });
  test("Given a running audit or pending fix When resolving actions Then rerun and every fix are mutually excluded", () => {
    const withFix = finding({ safe_fix: { kind: "patch_html_node", rel_path: "index.html", request: { node_bg_id: "hero-title", styles: { "font-size": "12px" } } } });
    expect(designAuditActionAvailability(withFix, { current: true, running: true, pendingFindingId: null }).canApplySafeFix).toBe(false);
    expect(designAuditActionAvailability(withFix, { current: true, running: false, pendingFindingId: "other" })).toMatchObject({ canApplySafeFix: false, applying: false });
    expect(designAuditActionAvailability(withFix, { current: true, running: false, pendingFindingId: withFix.id })).toMatchObject({ canApplySafeFix: false, applying: true });
    expect(designAuditControlAvailability({ running: false, pendingFindingId: withFix.id }).canRetry).toBe(false);
    expect(designAuditControlAvailability({ running: true, pendingFindingId: null }).canRetry).toBe(false);
    expect(designAuditControlAvailability({ running: false, pendingFindingId: null }).canRetry).toBe(true);
  });
});

describe("design audit state", () => {
  test("Given report and artifact identities When comparing Then only equal digests are current", () => {
    expect(isDesignAuditCurrent(result(), DIGEST_A)).toBe(true);
    expect(isDesignAuditCurrent(result(), DIGEST_B)).toBe(false);
  });
  test("Given every query condition When deriving Then the closed view-state variants are returned", () => {
    const current = result();
    const mustFix = result({ overall_status: "must_fix", checks: current.checks.map((item) => item.code === "contrast" ? check({ code: "contrast", status: "fail", findings: [finding()] }) : item) });
    const recommended = result({ overall_status: "recommended", checks: current.checks.map((item) => item.code === "token_usage" ? check({ code: "token_usage", status: "skipped", reason: "tokens_not_exposed" }) : item) });
    expect(designAuditViewState({ renderable: false, report: null, pending: false, rerunning: false, errorCode: null, currentDigest: DIGEST_A }).kind).toBe("unavailable");
    expect(designAuditViewState({ renderable: true, report: null, pending: true, rerunning: false, errorCode: null, currentDigest: DIGEST_A }).kind).toBe("loading");
    expect(designAuditViewState({ renderable: true, report: null, pending: false, rerunning: false, errorCode: "audit_unavailable", currentDigest: DIGEST_A }).kind).toBe("error_cold");
    expect(designAuditViewState({ renderable: true, report: current, pending: false, rerunning: false, errorCode: "network_error", currentDigest: DIGEST_A }).kind).toBe("error_warm");
    expect(designAuditViewState({ renderable: true, report: result({ artifact_digest: DIGEST_B }), pending: false, rerunning: false, errorCode: null, currentDigest: DIGEST_A }).kind).toBe("stale");
    expect(designAuditViewState({ renderable: true, report: mustFix, pending: false, rerunning: false, errorCode: null, currentDigest: DIGEST_A }).kind).toBe("must_fix");
    expect(designAuditViewState({ renderable: true, report: recommended, pending: false, rerunning: false, errorCode: null, currentDigest: DIGEST_A }).kind).toBe("recommended");
    expect(designAuditViewState({ renderable: true, report: current, pending: false, rerunning: true, errorCode: null, currentDigest: DIGEST_A })).toMatchObject({ kind: "ready", running: true });
  });
  test("Given no report, no error, and no request in flight When deriving Then the panel is idle, never loading", () => {
    const settled = { renderable: true, report: null, pending: false, rerunning: false, errorCode: null, currentDigest: DIGEST_A } as const;
    expect(designAuditViewState(settled).kind).toBe("idle");
    expect(designAuditViewState({ ...settled, rerunning: true }).kind).toBe("loading");
    const quality: QualityPanelBinding = { state: designAuditViewState(settled), pendingFindingId: null, focusedFindingId: null, revealResult: null, onRetry() {}, onOpenFile() {}, onReveal() {}, onApplySafeFix() {}, onAutoFix() {}, autoFixPending: false, autoFixDisabled: false };
    const markup = renderToStaticMarkup(createElement(QualityPanel, { quality }));
    expect(markup).toContain("다시 검사해 주세요");
    expect(markup).not.toContain("검사하고");
    const retryButton = markup.match(/<button[^>]*>[\s\S]*?<\/button>/g)?.find((button) => button.includes("다시 검사")) ?? "";
    expect(retryButton).not.toContain('disabled=""');
  });
  test("Given bounded and unknown API errors When mapping Then a closed machine code is returned", () => {
    expect(designAuditErrorCode(new ApiError("project_path_unavailable", "x", 503))).toBe("project_path_unavailable");
    expect(designAuditErrorCode(new ApiError("stale_revision", "raw", 409))).toBe("stale_revision");
    expect(designAuditErrorCode(new ApiError("stale_node_fingerprint", "raw", 422))).toBe("stale_node_fingerprint");
    expect(designAuditErrorCode(new ApiError("node_not_found", "raw", 404))).toBe("node_not_found");
    expect(designAuditErrorCode(new ApiError("file_not_found", "raw", 404))).toBe("file_not_found");
    expect(designAuditErrorCode(new ApiError("unexpected", "x", 500))).toBe("unknown_error");
    expect(designAuditErrorCode(new TypeError("offline"))).toBe("network_error");
    expect(Object.keys(DESIGN_AUDIT_ERROR_COPY).sort()).toEqual([
      "audit_unavailable", "file_not_found", "network_error", "node_not_found", "project_not_found", "project_path_unavailable",
      "stale_artifact_digest", "stale_artifact_identity", "stale_file_hash", "stale_node_fingerprint", "stale_revision", "unknown_error",
    ]);
  });
});
