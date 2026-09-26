import type { PlatformFindingView } from "@/components/export/export-delivery";
import { t } from "@/i18n/t";

const MAX_FINDINGS = 20;

/**
 * Sent through the same `user.message` path as the quality repair flow, with a
 * bounded payload: only the code, the page, and the explanation the user just
 * read. Nothing about the job, the attempt, or the digests crosses over.
 */
export function platformFixRequest(
  findings: readonly PlatformFindingView[],
): string | null {
  if (findings.length === 0) return null;
  const bounded = findings.slice(0, MAX_FINDINGS).map((finding) => ({
    code: finding.code,
    page: finding.page,
    message: finding.message,
  }));
  return `${t("export.fixRequest.intro")}
${JSON.stringify(bounded)}
${t("export.fixRequest.outro")}`;
}
