import type { ExportJob } from "@bg/shared";

export function exportJobState(job: ExportJob) {
  const attempt = job.latest_attempt;
  const terminal = attempt?.status;
  const active = job.status === "pending" || job.status === "running";
  const cancelled = terminal === "cancelled" || attempt?.stop_reason === "user_cancelled";
  const unavailable = terminal === "corrupt" || terminal === "expired" || (terminal === "validated" && attempt?.retention.output_available === false);
  return {
    active, cancelled,
    canDownload: job.status === "succeeded" && !unavailable && (attempt === null || terminal === "validated"),
    canRetry: job.status === "failed" || cancelled || unavailable,
    label: cancelled ? "취소됨" : terminal === "corrupt" ? "파일 손상" : terminal === "expired" || unavailable ? "보관 기간 종료" : attempt?.cancel_requested_at ? "취소하는 중…" : job.status === "succeeded" ? "완료" : job.status === "failed" ? "실패" : job.status === "running" ? "만드는 중…" : "대기 중",
  };
}
