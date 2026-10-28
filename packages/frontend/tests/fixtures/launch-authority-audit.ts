import { DESIGN_AUDIT_CHECK_CODES, parseDesignAuditResult, type DesignAuditResult, type ProjectDetail } from "@bg/shared";

/** Authority readiness needs audit data, not an unrelated browser measurement. */
export function unmeasuredAuthorityAudit(project: Pick<ProjectDetail, "id" | "current_revision" | "current_digest">): DesignAuditResult {
  return parseDesignAuditResult({
    schema_version: 1,
    project_id: project.id,
    artifact_revision: project.current_revision,
    artifact_digest: project.current_digest,
    created_at: 1,
    overall_status: "recommended",
    checks: DESIGN_AUDIT_CHECK_CODES.map((code) => ({
      code, status: "unmeasurable", reason: "unresolvable_rendering", findings: [],
    })),
  });
}
