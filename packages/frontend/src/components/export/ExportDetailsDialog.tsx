import { useT, type MessageKey } from "@/i18n/t";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ExportJob } from "@/api/export";
import ExportOptionFields from "./ExportOptionFields";
import ExportStatusList from "./ExportStatusList";
import PrintPreflightSection from "./PrintPreflightSection";
import type { ExportMenuOption, ExportOptionValues } from "./export-options";

export type ExportDetailsSection = "settings" | "print" | "status";

const TITLE_KEY: Record<ExportDetailsSection, MessageKey> = {
  settings: "export.menu.settings",
  print: "export.preflight.title",
  status: "export.recent",
};

const HINT_KEY: Record<ExportDetailsSection, MessageKey> = {
  settings: "export.menu.settingsHint",
  print: "export.menu.printHint",
  status: "export.menu.recentHint",
};

export default function ExportDetailsDialog({
  section,
  onClose,
  projectId,
  options,
  values,
  onValuesChange,
  optionsDisabled,
  jobs,
  onRetry,
  onCancel,
  onDownload,
  onRequestFix,
  statusBusy,
}: {
  readonly section: ExportDetailsSection | null;
  readonly onClose: () => void;
  readonly projectId: string;
  readonly options: readonly ExportMenuOption[];
  readonly values: ExportOptionValues;
  readonly onValuesChange: (values: ExportOptionValues) => void;
  readonly optionsDisabled: boolean;
  readonly jobs: ExportJob[];
  readonly onRetry: (job: ExportJob) => void;
  readonly onCancel: (job: ExportJob) => void;
  readonly onDownload: (job: ExportJob) => void;
  readonly onRequestFix?: (job: ExportJob) => void;
  readonly statusBusy: boolean;
}) {
  const t = useT();
  if (section === null) return null;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[min(640px,calc(100dvh-2rem))] max-w-lg flex-col gap-4 overflow-hidden">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t(TITLE_KEY[section])}</DialogTitle>
          <DialogDescription>{t(HINT_KEY[section])}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {section === "settings" && (
            <ExportOptionFields options={options} values={values} disabled={optionsDisabled} onChange={onValuesChange} />
          )}
          {section === "print" && <PrintPreflightSection projectId={projectId} enabled />}
          {section === "status" && (
            jobs.length === 0
              ? <p className="px-1 py-4 text-sm text-muted-foreground">{t("export.menu.recentEmpty")}</p>
              : <ExportStatusList
                  jobs={jobs}
                  onRetry={onRetry}
                  onCancel={onCancel}
                  onDownload={onDownload}
                  retryDisabled={statusBusy}
                  {...(onRequestFix === undefined ? {} : { onRequestFix })}
                />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
