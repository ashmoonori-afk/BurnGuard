import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileDown,
  FileType2,
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
import ExportStatusList from "./ExportStatusList";
import { exportJobState } from "./export-job-state";
import { apiErrorCopy } from "@/lib/error-copy";
import {
  buildExportMenuModel,
  classifyChromiumFailure,
  CHROMIUM_FAILURE_MESSAGE,
  EXPORT_DISABLED_LABEL,
} from "./export-options";
import ExportOptionFields from "./ExportOptionFields";
import { platformFindings } from "./export-delivery";
import { platformFixRequest } from "@/lib/platform-fix-request";
import { useExportOptionValues } from "./useExportOptionValues";

const OPTION_ICON: Record<ExportFormat, LucideIcon> = {
  html_zip: FileDown,
  pdf: FileType2,
  png: Download,
  pptx: Presentation,
  handoff: PackagePlus,
  png_zip: Download,
  cafe24_package: PackagePlus,
  imweb_package: PackagePlus,
};

export type ExportQualityGate = { readonly mustFixCount: number } | null;

export default function ExportMenu({ projectId, projectType, projectOptionsJson, qualityGate, onOpenQuality, platformFix }: {
  readonly projectId: string;
  readonly projectType: ProjectType;
  readonly projectOptionsJson: string | null;
  readonly qualityGate: ExportQualityGate;
  readonly onOpenQuality: () => void;
  /** Sends lint findings through the chat composer; absent when the view has no session. */
  readonly platformFix?: { readonly disabled: boolean; readonly onRequest: (prompt: string) => void };
}) {
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const [open, setOpen] = useState(false);
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
      pushToast({ title: "내보내기를 예약했어요", tone: "info" });
    },
    onError: (err) => {
      pushToast({
        title: "내보내기를 시작하지 못했어요",
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
    onSuccess: (_data, { action }) => { if (action !== "download") pushToast({ title: action === "cancel" ? "취소 요청을 보냈어요" : "같은 설정으로 다시 내보내요", tone: "info" }); },
    onError: (error) => pushToast({ title: "내보내기 요청을 완료하지 못했어요", body: apiErrorCopy(error), tone: "error" }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: ["project", projectId, "exports"] }); },
  });

  const jobs = jobsQuery.data ?? [];
  const menuModel = buildExportMenuModel(projectType, projectOptionsJson, optionValues);

  // Surface async failures via a toast — the createMutation onError only
  // catches synchronous create-call errors. Background pipeline failures
  // (chromium missing, Playwright crash, etc.) only surface through the
  // poll, and previously sat silently as a "failed" status indicator.
  // Tracks last-seen status per job so a job that was already failed at
  // mount, or that we've already toasted, doesn't fire again on every poll.
  const lastStatusRef = useRef<Map<string, ExportStatus>>(new Map());
  const isInitialLoadRef = useRef(true);
  useEffect(() => {
    if (isInitialLoadRef.current) {
      for (const job of jobs) lastStatusRef.current.set(job.id, job.status);
      if (jobs.length > 0 || jobsQuery.status === "success") {
        isInitialLoadRef.current = false;
      }
      return;
    }
    for (const job of jobs) {
      const previous = lastStatusRef.current.get(job.id);
      lastStatusRef.current.set(job.id, job.status);
      if (job.status === "failed" && previous !== "failed" && !exportJobState(job).cancelled) {
        const chromiumFailure = classifyChromiumFailure(job.error_message);
        const auditFailed = isDesignAuditExportFailure(job);
        pushToast({
          title: `내보내기에 실패했어요 (${formatLabel(job.format)})`,
          body: auditFailed
            ? "내보내기 전 품질 점검에서 고쳐야 할 문제가 발견됐어요."
            : chromiumFailure !== null
              ? CHROMIUM_FAILURE_MESSAGE[chromiumFailure]
              : apiErrorCopy({ code: job.latest_attempt?.stop_reason }),
          tone: "error",
        });
      }
    }
  }, [jobs, pushToast, jobsQuery.status]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="cta"
          size="sm"
          className="min-h-10 gap-2 px-4 focus:ring-2 focus:ring-ring focus:ring-offset-1 max-[900px]:min-h-11"
          aria-label="내보내기"
        >
          <Download className="h-3.5 w-3.5" /> 내보내기
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent data-export-menu-content align="end" className="z-[100] w-80 max-w-[calc(100vw-24px)] p-2">
        <DropdownMenuLabel>내보내기 형식</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {jobsQuery.isError && <div role="alert" className="p-2 text-xs"><p>내보내기 목록을 불러오지 못했어요.</p><button type="button" className="mt-2 underline" onClick={() => void jobsQuery.refetch()}>다시 시도</button></div>}
        {qualityGate !== null && <div className="mx-2 mb-2 rounded-md border border-destructive/30 bg-destructive/10 p-2">
          <p className="text-pretty break-keep text-xs text-foreground">고쳐야 할 문제 {qualityGate.mustFixCount}개가 있어 내보내기를 {"시작할\u00A0수\u00A0없어요."}</p>
          <Button type="button" variant="outline" size="sm" className="mt-2 h-8 w-full max-[900px]:min-h-11" onClick={openQuality}>품질 점검 열기</Button>
        </div>}
        {!menuModel.ok && (
          <p className="mx-2 rounded-md border border-warning/30 bg-warning/15 p-2 text-pretty break-keep text-xs">
            {menuModel.message}
          </p>
        )}
        <ExportOptionFields
          options={menuModel.options}
          values={optionValues}
          disabled={createMutation.isPending}
          onChange={setOptionValues}
        />
        {menuModel.options.map((option) => {
          const Icon = OPTION_ICON[option.format];
          const disabled =
            option.disabledReason !== undefined || createMutation.isPending;
          return (
            <DropdownMenuItem
              key={option.key}
              className="min-h-11 gap-3 rounded-md px-3"
              disabled={disabled}
              onClick={(event) => {
                if (disabled) return;
                if (qualityGate !== null) {
                  event.preventDefault();
                  openQuality();
                  return;
                }
                // Keep the dropdown open so the user can watch the status list.
                event.preventDefault();
                createMutation.mutate({
                  format: option.format,
                  options: option.options,
                });
              }}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="flex-1">
                {option.label}
                {option.note !== undefined && (
                  <span className="mt-0.5 block text-pretty break-keep text-[10px] font-normal text-muted-foreground">
                    {option.note}
                  </span>
                )}
              </span>
              {option.disabledReason !== undefined && (
                <span className="text-[10px] text-muted-foreground">
                  {EXPORT_DISABLED_LABEL[option.disabledReason]}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
        {jobs.some(isDesignAuditExportFailure) && <div className="mx-2 mt-2 rounded-md bg-warning/15 p-2">
          <p className="break-keep text-xs">최근 내보내기가 품질 점검에서 중단됐어요.</p>
          <Button type="button" variant="outline" size="sm" className="mt-2 h-8 w-full max-[900px]:min-h-11" onClick={openQuality}>품질 점검 열기</Button>
        </div>}
        {jobs.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <ExportStatusList
              jobs={jobs}
              onRetry={(job) => {
                if (qualityGate !== null) { openQuality(); return; }
                actionMutation.mutate({ action: "retry", job });
              }}
              onCancel={(job) => actionMutation.mutate({ action: "cancel", job })}
              onDownload={(job) => actionMutation.mutate({ action: "download", job })}
              retryDisabled={createMutation.isPending || actionMutation.isPending}
              {...(platformFix === undefined || platformFix.disabled
                ? {}
                : {
                    onRequestFix: (job: ExportJob) => {
                      const prompt = platformFixRequest(platformFindings(job));
                      if (prompt === null) return;
                      setOpen(false);
                      platformFix.onRequest(prompt);
                    },
                  })}
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function isDesignAuditExportFailure(job: { readonly error_message: string | null; readonly latest_attempt: { readonly stop_reason: string | null } | null }): boolean {
  return job.latest_attempt?.stop_reason === "validation_failed" && job.error_message?.startsWith("Design audit found ") === true;
}
