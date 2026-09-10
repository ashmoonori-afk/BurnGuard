import type { PlatformFindingView } from "@/components/export/export-delivery";

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
  return `플랫폼 패키지 내보내기 점검에서 발견된 문제를 수정해 주세요.
${JSON.stringify(bounded)}
해당 페이지의 실제 원인을 고치고, 기존 콘텐츠와 디자인 방향은 유지하세요. 점검을 끄거나 기준을 낮추는 방식으로 통과시키지 마세요. 수정이 끝나면 다시 내보내기를 실행합니다. 변경 내용과 남은 문제만 간결하게 알려 주세요.`;
}
