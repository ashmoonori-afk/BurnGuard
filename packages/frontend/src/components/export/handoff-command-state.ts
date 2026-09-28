import type { ExportJob, HandoffContinuation } from "@bg/shared";
import { exportJobState } from "./export-job-state";

export function handoffCommands(job: ExportJob): HandoffContinuation | null {
  if (
    job.format !== "handoff" ||
    job.handoff_continuation === null ||
    !exportJobState(job).canDownload
  ) {
    return null;
  }
  return job.handoff_continuation;
}
