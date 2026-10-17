import { useT } from "@/i18n/t";
import type { ExportJob } from "@/api/export";
import ExportStatusRow from "./ExportStatusRow";

export default function ExportStatusList({
  jobs,
  onRetry,
  retryDisabled,
  onCancel,
  onDownload,
  onRequestFix,
  onOpenGuide,
}: {
  jobs: ExportJob[];
  onRetry?: (job: ExportJob) => void;
  onCancel?: (job: ExportJob) => void;
  onDownload?: (job: ExportJob) => void;
  onRequestFix?: (job: ExportJob) => void;
  onOpenGuide: (job: ExportJob) => void;
  retryDisabled?: boolean;
}) {
  const t = useT();
  if (jobs.length === 0) return null;
  return (
    <div className="px-2 py-1.5">
      <div className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {t("export.recent")}
      </div>
      <ul className="space-y-1">
        {jobs.slice(0, 5).map((job) => (
          <ExportStatusRow
            key={job.id}
            job={job}
            actions={{
              onRetry,
              onCancel,
              onDownload,
              onRequestFix,
              onOpenGuide,
              busy: retryDisabled === true,
            }}
          />
        ))}
      </ul>
    </div>
  );
}
