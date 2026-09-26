import { t } from "@/i18n/t";
import type { ExportJob, ExportStatus } from "@bg/shared";

export type ExportTransition = { readonly job: ExportJob; readonly outcome: "succeeded" | "failed" };

/**
 * Terminal transitions since the last poll. `seen` is updated in place so each
 * job reports once; the initial load only records what is already there, so a
 * job that was terminal at mount never fires.
 */
export function exportTransitions(seen: Map<string, ExportStatus>, jobs: readonly ExportJob[], options: { readonly initial?: boolean } = {}): readonly ExportTransition[] {
  const transitions: ExportTransition[] = [];
  for (const job of jobs) {
    const previous = seen.get(job.id);
    seen.set(job.id, job.status);
    if (options.initial === true) continue;
    if (job.status === "failed" && previous !== "failed" && !exportJobState(job).cancelled) transitions.push({ job, outcome: "failed" });
    else if (job.status === "succeeded" && previous !== "succeeded") transitions.push({ job, outcome: "succeeded" });
  }
  return transitions;
}

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
