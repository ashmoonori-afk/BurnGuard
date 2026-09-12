import { useT } from "@/i18n/t";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  RotateCcw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { formatLabel, type ExportJob } from "@/api/export";
import { exportJobState } from "./export-job-state";
import {
  DELIVERY_STAGE_LABEL,
  FINDING_SEVERITY_LABEL,
  exportDeliveryStage,
  offersFixRequest,
  platformFindings,
} from "./export-delivery";
import { platformGuideView } from "./platform-guide";

export type ExportRowActions = {
  readonly onRetry?: (job: ExportJob) => void;
  readonly onCancel?: (job: ExportJob) => void;
  readonly onDownload?: (job: ExportJob) => void;
  readonly onOpenGuide: (job: ExportJob) => void;
  readonly onRequestFix?: (job: ExportJob) => void;
  readonly busy: boolean;
};

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STAGE_ICON = {
  saving: Clock,
  rendering: Loader2,
  validating: Loader2,
  ready: CheckCircle2,
  failure: XCircle,
} as const;

const STAGE_ICON_CLASS = {
  saving: "text-muted-foreground",
  rendering: "animate-spin text-muted-foreground",
  validating: "animate-spin text-muted-foreground",
  ready: "text-accent",
  failure: "text-destructive",
} as const;

const ACTION_CLASS =
  "inline-flex min-h-8 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export default function ExportStatusRow({
  job,
  actions,
}: {
  readonly job: ExportJob;
  readonly actions: ExportRowActions;
}) {
  const t = useT();
  const state = exportJobState(job);
  const stage = exportDeliveryStage(job);
  const isPackage = platformGuideView(job.format) !== null;
  const findings = platformFindings(job);
  // `exportJobState` already words cancellation, corruption, and expiry; the
  // delivery stage words the live pipeline.
  const wordedByJobState =
    state.cancelled ||
    job.latest_attempt?.cancel_requested_at != null ||
    (job.status === "succeeded" && !state.canDownload);
  const label = wordedByJobState
    ? state.label
    : stage === "ready" && isPackage
      ? t("export.packageReady")
      : DELIVERY_STAGE_LABEL[stage];
  const Icon = state.cancelled ? Clock : STAGE_ICON[stage];
  const iconClass = `h-3.5 w-3.5 ${state.cancelled ? "text-muted-foreground" : STAGE_ICON_CLASS[stage]}`;
  const canFix = offersFixRequest(job) && actions.onRequestFix !== undefined;
  return (
    <li className="space-y-1 rounded-md px-1 py-1 text-xs">
      <div className="flex items-center gap-2">
        <Icon className={iconClass} aria-hidden="true" />
        <span className="flex-1 truncate">{formatLabel(job.format)}</span>
        {state.canDownload && (
          <button
            type="button"
            onClick={() => actions.onDownload?.(job)}
            disabled={actions.busy}
            aria-label={t("export.downloadFormat", { name: formatLabel(job.format) })}
            className={`${ACTION_CLASS} text-accent`}
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            {formatBytes(job.size_bytes)}
          </button>
        )}
        {isPackage && (
          <button
            type="button"
            onClick={() => actions.onOpenGuide(job)}
            aria-label={t("export.guideFormat", { name: formatLabel(job.format) })}
            className={`${ACTION_CLASS} text-muted-foreground hover:text-foreground`}
          >
            <BookOpen className="h-3 w-3" aria-hidden="true" />
            {t("export.viewGuide")}
          </button>
        )}
        {state.canRetry && actions.onRetry !== undefined && (
          <button
            type="button"
            onClick={() => actions.onRetry?.(job)}
            disabled={actions.busy}
            aria-label={t("export.retryFormat", { name: formatLabel(job.format) })}
            className={`${ACTION_CLASS} text-muted-foreground hover:text-foreground`}
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            {t("export.retry")}
          </button>
        )}
        <span className="text-[10px] text-muted-foreground" aria-live="polite">{label}</span>
        {state.active && actions.onCancel !== undefined && (
          <button
            type="button"
            disabled={actions.busy || job.latest_attempt?.cancel_requested_at != null}
            onClick={() => actions.onCancel?.(job)}
            aria-label={t("export.cancelFormat", { name: formatLabel(job.format) })}
            className="min-h-8 rounded px-2 py-1 text-xs underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {t("export.cancel")}
          </button>
        )}
      </div>
      {isPackage && stage === "ready" && job.status === "succeeded" && (
        <p className="text-pretty break-keep pl-6 text-[10px] text-muted-foreground">{t("export.packageNote")}</p>
      )}
      {findings.length > 0 && (
        <ul className="space-y-0.5 pl-6">
          {findings.map((finding) => (
            <li key={`${finding.code}-${finding.page}`} className="flex items-start gap-1 text-[10px]">
              <AlertTriangle
                className={finding.severity === "error" ? "mt-0.5 h-3 w-3 shrink-0 text-destructive" : "mt-0.5 h-3 w-3 shrink-0 text-warning"}
                aria-hidden="true"
              />
              <span className="text-pretty break-keep text-muted-foreground">
                <span className="font-medium text-foreground">
                  {FINDING_SEVERITY_LABEL[finding.severity]} · {finding.page}
                </span>{" "}
                {finding.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canFix && (
        <button
          type="button"
          onClick={() => actions.onRequestFix?.(job)}
          disabled={actions.busy}
          className={`${ACTION_CLASS} ml-6 text-accent`}
        >
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          {t("export.requestFix")}
        </button>
      )}
    </li>
  );
}
