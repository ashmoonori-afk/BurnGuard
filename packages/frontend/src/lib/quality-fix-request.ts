import type { BackendId, DesignAuditFinding, DesignAuditResult } from "@bg/shared";
import { t } from "@/i18n/t";

/** The prose follows the UI locale; the JSON payload line is byte-identical across locales. */
export function qualityFixRequest(report: DesignAuditResult, options: { readonly backendId?: BackendId; readonly findings?: readonly DesignAuditFinding[] } = {}): string {
  const findings = (options.findings ?? report.checks.flatMap((check) => check.findings)).map((finding) => ({
    file: finding.source.rel_path, node: finding.source.node_bg_id,
    check: finding.check_code, severity: finding.severity,
    action: finding.targeted_action, evidence: finding.evidence.slice(0, 200),
  }));
  // Only a Codex session exposes an image generation delegate; other sessions must not be told to invent one.
  const image = t(options.backendId === "codex" ? "modes.quality.fixRequest.imageCodex" : "modes.quality.fixRequest.imageNeutral");
  return `${t("modes.quality.fixRequest.intro", { revision: report.artifact_revision, digest: report.artifact_digest })}
${JSON.stringify(findings)}
${t("modes.quality.fixRequest.outro", { image })}`;
}
