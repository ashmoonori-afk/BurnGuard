import {
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  RotateCcw,
  XCircle,
} from "lucide-react";
import {
  formatLabel,
  type ExportJob,
} from "@/api/export";
import { exportJobState } from "./export-job-state";

function formatBytes(bytes: number | null | undefined) {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ExportStatusList({
  jobs,
  onRetry,
  retryDisabled,
  onCancel,
  onDownload,
}: {
  jobs: ExportJob[];
  onRetry?: (job: ExportJob) => void;
  onCancel?: (job: ExportJob) => void;
  onDownload?: (job: ExportJob) => void;
  retryDisabled?: boolean;
}) {
  if (jobs.length === 0) return null;
  return (
    <div className="px-2 py-1.5">
      <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        최근 내보내기
      </div>
      <ul className="space-y-1">
        {jobs.slice(0, 5).map((j) => {
          const state = exportJobState(j);
          const Icon =
            state.cancelled
              ? Clock
              : j.status === "succeeded"
              ? CheckCircle2
              : j.status === "failed"
                ? XCircle
                : j.status === "running"
                  ? Loader2
                  : Clock;
          const iconClass =
            "h-3.5 w-3.5 " +
            (state.cancelled
              ? "text-muted-foreground"
              : j.status === "running"
              ? "animate-spin text-muted-foreground"
              : j.status === "succeeded"
                ? "text-accent"
                : j.status === "failed"
                  ? "text-destructive"
                  : "text-muted-foreground");
          const canDownload = state.canDownload;
          const canRetry = state.canRetry && Boolean(onRetry);
          return (
            <li
              key={j.id}
              className="flex items-center gap-2 px-1 text-xs"
              title={state.label}
            >
              <Icon className={iconClass} />
              <span className="flex-1 truncate">{formatLabel(j.format)}</span>
              {canDownload && (
                <button
                  type="button"
                  onClick={() => onDownload?.(j)}
                  disabled={retryDisabled}
                  aria-label={`${formatLabel(j.format)} 다운로드`}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/10"
                >
                  <Download className="h-3 w-3" />
                  {formatBytes(j.size_bytes)}
                </button>
              )}
              {canRetry && (
                <button
                  type="button"
                  onClick={() => onRetry?.(j)}
                  disabled={retryDisabled}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent/10 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                  title="이 내보내기 다시 시도"
                >
                  <RotateCcw className="h-3 w-3" />
                  다시 시도
                </button>
              )}
                <span className="text-[10px] text-muted-foreground" aria-live="polite">
                  {state.label}
                </span>
              {state.active && onCancel && <button type="button" disabled={retryDisabled || j.latest_attempt?.cancel_requested_at != null} onClick={() => onCancel(j)} className="rounded px-2 py-1 text-xs underline disabled:opacity-50">취소</button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
