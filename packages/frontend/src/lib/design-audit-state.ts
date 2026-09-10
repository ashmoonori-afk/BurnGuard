import type { DesignAuditCheck, DesignAuditFinding, DesignAuditResult } from "@bg/shared";
import { ApiError } from "@/api/client";

export type DesignAuditErrorCode = "project_not_found" | "project_path_unavailable" | "stale_artifact_identity" | "audit_unavailable" | "stale_revision" | "stale_artifact_digest" | "stale_file_hash" | "stale_node_fingerprint" | "file_not_found" | "node_not_found" | "network_error" | "unknown_error";
export type DesignAuditActionContext = { readonly current: boolean; readonly running: boolean; readonly pendingFindingId: string | null };
export type DesignAuditUnknownCheck = DesignAuditCheck & { readonly status: "skipped" | "unmeasurable"; readonly reason: NonNullable<DesignAuditCheck["reason"]> };
export type DesignAuditGroups = {
  readonly mustFix: readonly DesignAuditFinding[];
  readonly recommended: readonly DesignAuditFinding[];
  readonly unknown: readonly DesignAuditUnknownCheck[];
  readonly passedCount: number;
};
export type DesignAuditViewState =
  | { readonly kind: "loading" }
  /** No report, no error, and no request in flight: the spinner must not be shown. */
  | { readonly kind: "idle" }
  | { readonly kind: "error_cold"; readonly errorCode: DesignAuditErrorCode }
  | { readonly kind: "error_warm"; readonly report: DesignAuditResult; readonly errorCode: DesignAuditErrorCode; readonly current: boolean }
  | { readonly kind: "stale"; readonly report: DesignAuditResult; readonly running: boolean }
  | { readonly kind: "must_fix" | "recommended" | "ready"; readonly report: DesignAuditResult; readonly running: boolean }
  | { readonly kind: "unavailable" };

type ViewInput = {
  readonly renderable: boolean;
  readonly report: DesignAuditResult | null;
  readonly pending: boolean;
  readonly rerunning: boolean;
  readonly errorCode: DesignAuditErrorCode | null;
  readonly currentDigest: string;
};

export function preferDesignAuditResult(current: DesignAuditResult | null, incoming: DesignAuditResult | null, projectId: string): DesignAuditResult | null {
  const validCurrent = current?.project_id === projectId ? current : null;
  if (incoming?.project_id !== projectId) return validCurrent;
  if (validCurrent === null) return incoming;
  if (incoming.artifact_revision !== validCurrent.artifact_revision) return incoming.artifact_revision > validCurrent.artifact_revision ? incoming : validCurrent;
  return incoming.created_at > validCurrent.created_at ? incoming : validCurrent;
}

export function isDesignAuditCurrent(report: DesignAuditResult, currentDigest: string): boolean {
  return report.artifact_digest === currentDigest;
}

export function groupDesignAuditResult(report: DesignAuditResult): DesignAuditGroups {
  const findings = report.checks.flatMap((item) => item.findings);
  const unknown = report.checks.filter((item): item is DesignAuditUnknownCheck =>
    (item.status === "skipped" || item.status === "unmeasurable") && item.reason !== null,
  );
  return {
    mustFix: findings.filter((item) => item.severity === "must_fix"),
    recommended: findings.filter((item) => item.severity === "recommended"),
    unknown,
    passedCount: report.checks.filter((item) => item.status === "pass").length,
  };
}

export function designAuditActionAvailability(finding: DesignAuditFinding, context: DesignAuditActionContext) {
  const applying = context.pendingFindingId === finding.id;
  return {
    canOpenFile: finding.source.rel_path.length > 0,
    canReveal: finding.source.node_bg_id !== null,
    canApplySafeFix: context.current && !context.running && context.pendingFindingId === null && finding.safe_fix !== undefined,
    applying,
  } as const;
}

export function designAuditControlAvailability(context: Pick<DesignAuditActionContext, "running" | "pendingFindingId">) {
  return { canRetry: !context.running && context.pendingFindingId === null } as const;
}

export function designAuditErrorCode(error: unknown): DesignAuditErrorCode {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "project_not_found": case "project_path_unavailable": case "stale_artifact_identity": case "audit_unavailable":
      case "stale_revision": case "stale_artifact_digest": case "stale_file_hash": case "stale_node_fingerprint":
      case "file_not_found": case "node_not_found": case "network_error": return error.code;
      default: return "unknown_error";
    }
  }
  return error instanceof TypeError ? "network_error" : "unknown_error";
}

export function designAuditViewState(input: ViewInput): DesignAuditViewState {
  if (!input.renderable) return { kind: "unavailable" };
  if (input.report === null) {
    if (input.errorCode !== null) return { kind: "error_cold", errorCode: input.errorCode };
    return input.pending || input.rerunning ? { kind: "loading" } : { kind: "idle" };
  }
  if (input.errorCode !== null) return { kind: "error_warm", report: input.report, errorCode: input.errorCode, current: isDesignAuditCurrent(input.report, input.currentDigest) };
  if (!isDesignAuditCurrent(input.report, input.currentDigest)) return { kind: "stale", report: input.report, running: input.rerunning || input.pending };
  return { kind: input.report.overall_status, report: input.report, running: input.rerunning || input.pending };
}
