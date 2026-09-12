import { useT } from "@/i18n/t";
import { useState } from "react";
import type { ExportJob } from "@/api/export";
import ExportStatusRow from "./ExportStatusRow";
import PlatformGuideDialog from "./PlatformGuideDialog";

export default function ExportStatusList({
  jobs,
  onRetry,
  retryDisabled,
  onCancel,
  onDownload,
  onRequestFix,
}: {
  jobs: ExportJob[];
  onRetry?: (job: ExportJob) => void;
  onCancel?: (job: ExportJob) => void;
  onDownload?: (job: ExportJob) => void;
  onRequestFix?: (job: ExportJob) => void;
  retryDisabled?: boolean;
}) {
  const t = useT();
  const [guideJob, setGuideJob] = useState<ExportJob | null>(null);
  if (jobs.length === 0) return null;
  return (
    <div className="px-2 py-1.5">
      <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
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
              onOpenGuide: setGuideJob,
              busy: retryDisabled === true,
            }}
          />
        ))}
      </ul>
      {guideJob !== null && (
        <PlatformGuideDialog
          format={guideJob.format}
          open
          onOpenChange={(open) => { if (!open) setGuideJob(null); }}
        />
      )}
    </div>
  );
}
