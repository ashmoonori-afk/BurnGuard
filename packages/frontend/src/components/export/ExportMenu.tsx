import { useT } from "@/i18n/t";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileDown,
  History,
  ScanSearch,
  SlidersHorizontal,
  FileType2,
  PenTool,
  Presentation,
  PackagePlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { ExportStatus, ProjectType } from "@bg/shared";
import type { ExportQualityGate } from "@/lib/design-audit-state";
import {
  createExport,
  cancelExport,
  retryExport,
  readExportDownload,
  formatLabel,
  listExports,
  type ExportFormat,
  type ExportOptions,
  type ExportJob,
} from "@/api/export";
import { useUIStore } from "@/state/uiStore";
import { cn } from "@/lib/utils";
import ExportDetailsDialog, { type ExportDetailsSection } from "./ExportDetailsDialog";
import { exportTransitions } from "./export-job-state";
import { apiErrorCopy } from "@/lib/error-copy";
import {
  buildExportMenuModel,
  classifyChromiumFailure,
  classifyRenderPhaseFailure,
  renderPhaseFailureMessage,
  CHROMIUM_FAILURE_MESSAGE,
  EXPORT_DISABLED_LABEL,
} from "./export-options";
import { platformCheckFailureCopy, platformFindings } from "./export-delivery";
import { platformFixRequest } from "@/lib/platform-fix-request";
import { useExportOptionValues } from "./useExportOptionValues";
import { countsAsStarExport } from "@/lib/star-prompt";

const OPTION_ICON: Record<ExportFormat, LucideIcon> = {
  html_zip: FileDown,
  pdf: FileType2,
  png: Download,
  pptx: Presentation,
  handoff: PackagePlus,
  png_zip: Download,
  cafe24_package: PackagePlus,
  imweb_package: PackagePlus,
  svg: PenTool,
};

export type { ExportQualityGate };

export default function ExportMenu({ projectId, projectType, projectOptionsJson, qualityGate, onOpenQuality, platformFix }: {
  readonly projectId: string;
  readonly projectType: ProjectType;
  readonly projectOptionsJson: string | null;
  readonly qualityGate: ExportQualityGate;
  readonly onOpenQuality: () => void;
  /** Sends lint findings through the chat composer; absent when the view has no session. */
  readonly platformFix?: { readonly disabled: boolean; readonly onRequest: (prompt: string) => void };
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const oweStarPrompt = useUIStore((s) => s.oweStarPrompt);
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<ExportDetailsSection | null>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const pendingDetailsRef = useRef<ExportDetailsSection | null>(null);
  const [optionValues, setOptionValues] = useExportOptionValues(projectId);
  const openQuality = () => {
    setOpen(false);
    onOpenQuality();
  };

  // Poll while any job is still pending/running. Once everything settles to
  // succeeded/failed, polling stops and the list stays static until a new
  // export is queued.
  const jobsQuery = useQuery({
    queryKey: ["project", projectId, "exports"],
    queryFn: () => listExports(projectId),
    refetchInterval: (query) => {
      const data = query.state.data ?? [];
      const hasActive = data.some(
        (j) => j.status === "pending" || j.status === "running",
      );
      return hasActive ? 1000 : false;
    },
  });

  const createMutation = useMutation({
    mutationFn: (input: { format: ExportFormat; options?: ExportOptions }) =>
      createExport(projectId, input.format, input.options),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["project", projectId, "exports"],
      });
      pushToast({ title: t("export.queued"), tone: "info" });
    },
    onError: (err) => {
      pushToast({
        title: t("export.startFailed"),
        body: apiErrorCopy(err),
        tone: "error",
      });
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ action, job }: { action: "cancel" | "retry" | "download"; job: ExportJob }) => {
      if (action === "cancel") return cancelExport(job.id);
      if (action === "retry") return retryExport(job);
      const download = await readExportDownload(job.id);
      const url = URL.createObjectURL(download.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = download.filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onSuccess: (_data, { action }) => { if (action !== "download") pushToast({ title: action === "cancel" ? t("export.cancelRequested") : t("export.retryRequested"), tone: "info" }); },
    onError: (error) => pushToast({ title: t("export.requestFailed"), body: apiErrorCopy(error), tone: "error" }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: ["project", projectId, "exports"] }); },
  });

  const jobs = jobsQuery.data ?? [];
  const menuModel = buildExportMenuModel(projectType, projectOptionsJson, optionValues);
  const hasSettingsFields = menuModel.options.some((option) => option.disabledReason === undefined && (option.fields?.length ?? 0) > 0);
  const activeJobs = jobs.filter((job) => job.status === "pending" || job.status === "running").length;

  // Surface async outcomes via a toast — the createMutation onError only
  // catches synchronous create-call errors. Background pipeline failures
  // (chromium missing, Playwright crash, etc.) and completions only surface
  // through the poll. Tracks last-seen status per job so a job that was
  // already terminal at mount, or that we've already toasted, doesn't fire
  // again on every poll; the dropdown stays the primary status signal.
  const lastStatusRef = useRef<Map<string, ExportStatus>>(new Map());
  const isInitialLoadRef = useRef(true);
  useEffect(() => {
    if (isInitialLoadRef.current) {
      exportTransitions(lastStatusRef.current, jobs, { initial: true });
      if (jobs.length > 0 || jobsQuery.status === "success") {
        isInitialLoadRef.current = false;
      }
      return;
    }
    for (const { job, outcome } of exportTransitions(lastStatusRef.current, jobs)) {
      if (outcome === "succeeded") {
        pushToast({ title: t("export.succeededFormat", { name: formatLabel(job.format) }), tone: "info" });
        if (countsAsStarExport(job)) oweStarPrompt();
        continue;
      }
      const chromiumFailure = classifyChromiumFailure(job.error_message);
      const phaseFailure = classifyRenderPhaseFailure(job.error_message);
      const platformCopy = platformCheckFailureCopy(job);
      pushToast({
        title: t("export.failedFormat", { name: formatLabel(job.format) }),
        body: platformCopy !== null
          ? t(platformCopy)
          : phaseFailure !== null
            ? renderPhaseFailureMessage(phaseFailure)
            : chromiumFailure !== null
              ? CHROMIUM_FAILURE_MESSAGE[chromiumFailure]
              : apiErrorCopy({ code: job.latest_attempt?.stop_reason }),
        tone: "error",
      });
    }
  }, [jobs, pushToast, oweStarPrompt, jobsQuery.status, t]);

  return (
    <>
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={exportTriggerRef}
          variant="cta"
          size="sm"
          className="min-h-10 gap-2 px-4 focus:ring-2 focus:ring-ring focus:ring-offset-1 max-[900px]:min-h-11"
          aria-label={t("export.title")}
        >
          <Download className="h-3.5 w-3.5" /> {t("export.title")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-export-menu-content
        onPointerDownOutside={(event) => {
          // The exiting menu can still observe the pointer that reopens its trigger.
          const target = event.detail.originalEvent.target;
          if (target instanceof Node && exportTriggerRef.current?.contains(target)) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          const next = pendingDetailsRef.current;
          if (next === null) return;
          pendingDetailsRef.current = null;
          event.preventDefault();
          setDetails(next);
        }}
        align="end" collisionPadding={12} className="z-[100] max-h-[var(--radix-dropdown-menu-content-available-height)] w-80 max-w-[calc(100vw-24px)] overflow-y-auto p-2">
        <DropdownMenuLabel>{t("export.formats")}</DropdownMenuLabel>
        {jobsQuery.isError && <div role="alert" className="p-2 text-xs"><p>{t("export.listFailed")}</p><button type="button" className="mt-2 min-h-8 underline" onClick={() => void jobsQuery.refetch()}>{t("export.retry")}</button></div>}
        {qualityGate !== null && <div className="mx-1 mb-2 rounded-control border border-destructive/30 bg-destructive/10 p-2">
          <p className="text-pretty break-keep text-xs text-foreground">{t(qualityGate.copyKey, { count: qualityGate.mustFixCount })}</p>
          <Button type="button" variant="outline" size="sm" className="mt-2 h-8 w-full max-[900px]:min-h-11" onClick={openQuality}>{t("export.openQuality")}</Button>
        </div>}
        {!menuModel.ok && (
          <p className="mx-1 mb-2 rounded-control border border-warning/30 bg-warning/15 p-2 text-pretty break-keep text-xs">
            {menuModel.message}
          </p>
        )}
        {menuModel.options.map((option) => {
          const Icon = OPTION_ICON[option.format];
          const unavailable = option.disabledReason !== undefined;
          const disabled = unavailable || createMutation.isPending;
          return (
            <DropdownMenuItem
              key={option.key}
              className={cn("min-h-11 gap-3 rounded-control px-3 data-[disabled]:opacity-100", unavailable && "text-muted-foreground")}
              disabled={disabled}
              onClick={(event) => {
                if (disabled) return;
                event.preventDefault();
                createMutation.mutate({
                  format: option.format,
                  options: option.options,
                });
              }}
            >
              <Icon className={cn("h-4 w-4 shrink-0", unavailable && "opacity-70")} aria-hidden="true" />
              <span className="min-w-0 flex-1 text-sm">
                {option.label}
                {option.note !== undefined && (
                  <span className="mt-0.5 block text-pretty break-keep text-xs font-normal text-muted-foreground">
                    {option.note}
                  </span>
                )}
                {option.disabledReason !== undefined && (
                  <span className="mt-0.5 block text-pretty break-keep text-xs font-normal text-muted-foreground">
                    {EXPORT_DISABLED_LABEL[option.disabledReason]}
                  </span>
                )}
              </span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        {hasSettingsFields && (
          <DropdownMenuItem className="min-h-11 gap-3 rounded-control px-3" onSelect={() => { pendingDetailsRef.current = "settings"; }}>
            <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-sm">
              {t("export.menu.settings")}
              <span className="mt-0.5 block text-pretty break-keep text-xs font-normal text-muted-foreground">{t("export.menu.settingsHint")}</span>
            </span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className="min-h-11 gap-3 rounded-control px-3" onSelect={() => { pendingDetailsRef.current = "print"; }}>
          <ScanSearch className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-sm">
            {t("export.preflight.title")}
            <span className="mt-0.5 block text-pretty break-keep text-xs font-normal text-muted-foreground">{t("export.menu.printHint")}</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11 gap-3 rounded-control px-3" onSelect={() => { pendingDetailsRef.current = "status"; }}>
          <History className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-sm">
            {t("export.recent")}
            <span className="mt-0.5 block text-pretty break-keep text-xs font-normal text-muted-foreground">
              {activeJobs > 0 ? t("export.menu.recentActive", { count: activeJobs }) : t("export.menu.recentHint")}
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
      <ExportDetailsDialog
        section={details}
        onClose={() => setDetails(null)}
        returnFocusRef={exportTriggerRef}
        projectId={projectId}
        options={menuModel.options}
        values={optionValues}
        onValuesChange={setOptionValues}
        optionsDisabled={createMutation.isPending}
        jobs={jobs}
        onRetry={(job) => { actionMutation.mutate({ action: "retry", job }); }}
        onCancel={(job) => actionMutation.mutate({ action: "cancel", job })}
        onDownload={(job) => actionMutation.mutate({ action: "download", job })}
        statusBusy={createMutation.isPending || actionMutation.isPending}
        {...(platformFix === undefined || platformFix.disabled
          ? {}
          : {
              onRequestFix: (job: ExportJob) => {
                const prompt = platformFixRequest(platformFindings(job));
                if (prompt === null) return;
                setDetails(null);
                platformFix.onRequest(prompt);
              },
            })}
      />
    </>
  );
}
