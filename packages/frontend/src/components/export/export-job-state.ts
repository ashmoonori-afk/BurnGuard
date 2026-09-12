import { t } from "@/i18n/t";
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
    label: cancelled ? t("export.state.cancelled") : terminal === "corrupt" ? t("export.state.corrupt") : terminal === "expired" || unavailable ? t("export.state.expired") : attempt?.cancel_requested_at ? t("export.state.cancelling") : job.status === "succeeded" ? t("export.stage.ready") : job.status === "failed" ? t("export.stage.failure") : job.status === "running" ? t("export.state.running") : t("export.state.pending"),
  };
}
