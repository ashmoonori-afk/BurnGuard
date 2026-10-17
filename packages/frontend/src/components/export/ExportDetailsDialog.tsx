import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
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
import { platformGuideView } from "./platform-guide";
import { PlatformGuideContent } from "./PlatformGuideDialog";

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
  const [guideJob, setGuideJob] = useState<ExportJob | null>(null);
  const guideOpenerRef = useRef<HTMLElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const guide = guideJob === null ? null : platformGuideView(guideJob.format);
  useEffect(() => {
    if (guideJob !== null) backRef.current?.focus({ preventScroll: true });
    else if (section === "status") guideOpenerRef.current?.focus({ preventScroll: true });
  }, [guideJob, section]);
  if (section === null) return null;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) { setGuideJob(null); guideOpenerRef.current = null; onClose(); } }}>
      <DialogContent className="flex max-h-[min(640px,calc(100dvh-2rem))] max-w-lg flex-col gap-4 overflow-hidden">
        {guide !== null && <button ref={backRef} type="button" onClick={() => setGuideJob(null)} className="inline-flex min-h-9 shrink-0 items-center gap-2 self-start rounded-control px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t("export.guide.back")}</button>}
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{guide?.title ?? t(TITLE_KEY[section])}</DialogTitle>
          <DialogDescription>{guide?.summary ?? t(HINT_KEY[section])}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {guide !== null && guideJob !== null && <PlatformGuideContent format={guideJob.format} />}
          {guide === null && section === "settings" && (
            <ExportOptionFields options={options} values={values} disabled={optionsDisabled} onChange={onValuesChange} />
          )}
          {guide === null && section === "print" && <PrintPreflightSection projectId={projectId} enabled />}
          {section === "status" && (
            jobs.length === 0 && guide === null
              ? <p className="px-1 py-4 text-sm text-muted-foreground">{t("export.menu.recentEmpty")}</p>
              : jobs.length > 0 && <div className={guide !== null ? "hidden" : undefined}><ExportStatusList
                  jobs={jobs}
                  onRetry={onRetry}
                  onCancel={onCancel}
                  onDownload={onDownload}
                  retryDisabled={statusBusy}
                  onOpenGuide={(job) => {
                    const active = document.activeElement;
                    guideOpenerRef.current = active instanceof HTMLElement ? active : null;
                    setGuideJob(job);
                  }}
                  {...(onRequestFix === undefined ? {} : { onRequestFix })}
                /></div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
