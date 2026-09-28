import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import type {
  RuntimeBackendDiagnostic,
  RuntimeCapability,
  RuntimeDiagnostics,
  RuntimeFailureDiagnostic,
} from "@bg/shared";
import {
  getRuntimeDiagnostics,
  resumeProjectFromSavedFiles,
} from "@/api/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { localeTag, useLocaleStore } from "@/i18n/locale";
import { useT, type MessageKey } from "@/i18n/t";
import { apiErrorCopy } from "@/lib/error-copy";
import { backendLabel } from "@/lib/backend-display";

const CAPABILITY_KEYS: Readonly<Record<RuntimeCapability, MessageKey>> = {
  text_generation: "settings.runtimeCapabilityText",
  file_edits: "settings.runtimeCapabilityFiles",
  tool_events: "settings.runtimeCapabilityTools",
  usage: "settings.runtimeCapabilityUsage",
  image_generation: "settings.runtimeCapabilityImages",
};

interface RuntimeDiagnosticsPanelProps {
  readonly diagnostics: RuntimeDiagnostics | null;
  readonly pending: boolean;
  readonly error: unknown;
  readonly resumingProjectId: string | null;
  readonly resumedProjectId: string | null;
  readonly onRefresh: () => void;
  readonly onResume: (failure: RuntimeFailureDiagnostic) => void;
}

export default function RuntimeDiagnosticsSection() {
  const queryClient = useQueryClient();
  const [resumedProjectId, setResumedProjectId] = useState<string | null>(null);
  const diagnostics = useQuery({
    queryKey: ["settings", "runtime-diagnostics"],
    queryFn: getRuntimeDiagnostics,
    refetchOnWindowFocus: false,
  });
  const resume = useMutation({
    mutationFn: resumeProjectFromSavedFiles,
    onSuccess: (result) => {
      setResumedProjectId(result.project_id);
      void queryClient.invalidateQueries({ queryKey: ["settings", "runtime-diagnostics"] });
    },
  });
  return (
    <RuntimeDiagnosticsPanel
      diagnostics={diagnostics.data ?? null}
      pending={diagnostics.isPending}
      error={resume.error ?? diagnostics.error}
      resumingProjectId={resume.isPending ? resume.variables.projectId : null}
      resumedProjectId={resumedProjectId}
      onRefresh={() => void diagnostics.refetch()}
      onResume={(failure) => resume.mutate({ projectId: failure.project_id, sessionId: failure.session_id })}
    />
  );
}

export function RuntimeDiagnosticsPanel({
  diagnostics,
  pending,
  error,
  resumingProjectId,
  resumedProjectId,
  onRefresh,
  onResume,
}: RuntimeDiagnosticsPanelProps) {
  const t = useT();
  return (
    <section id="settings-runtime" aria-labelledby="settings-runtime-title" className="scroll-mt-6 space-y-5 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="settings-runtime-title" className="text-base font-semibold">{t("settings.runtime")}</h2>
          <p className="text-pretty text-sm leading-6 text-muted-foreground">{t("settings.runtimeHint")}</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onRefresh} disabled={pending}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {t("settings.runtimeRefresh")}
        </Button>
      </div>

      {error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground">{apiErrorCopy(error)}</p> : null}
      {pending && diagnostics === null ? <p role="status" className="text-sm text-muted-foreground">{t("settings.runtimeChecking")}</p> : null}

      {diagnostics ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {diagnostics.backends.map((backend) => <BackendDiagnosticCard key={backend.id} backend={backend} />)}
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">{t("settings.runtimeRecentFailures")}</h3>
            {diagnostics.recent_failures.length === 0
              ? <p className="text-sm text-muted-foreground">{t("settings.runtimeNoFailures")}</p>
              : diagnostics.recent_failures.map((failure) => (
                <FailureRow
                  key={`${failure.session_id}:${failure.failed_at}`}
                  failure={failure}
                  resuming={resumingProjectId === failure.project_id}
                  resumed={resumedProjectId === failure.project_id}
                  onResume={onResume}
                />
              ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function BackendDiagnosticCard({ backend }: { readonly backend: RuntimeBackendDiagnostic }) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  return (
    <article data-backend-id={backend.id} data-cli-status={backend.cli.status} className="min-w-0 space-y-3 rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">{backendLabel(backend.id)}</h3>
        <Badge variant={backend.cli.status === "detected" ? "accent" : "outline"}>{t(backend.cli.status === "detected" ? "settings.runtimeDetected" : "settings.runtimeMissing")}</Badge>
      </div>
      <dl className="grid grid-cols-[auto,minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t("settings.runtimeVersion")}</dt>
        <dd className="truncate font-mono">{backend.cli.version ?? t("settings.runtimeNotReported")}</dd>
        <dt className="text-muted-foreground">{t("settings.runtimeTransport")}</dt>
        <dd data-prompt-transport={backend.prompt_transport} className="font-mono">{t(backend.prompt_transport === "stdin" ? "settings.runtimeTransportStdin" : "settings.runtimeTransportFile")}</dd>
        <dt className="text-muted-foreground">{t("settings.runtimeModels")}</dt>
        <dd data-model-source={backend.model_catalog.source}>{modelFreshness(backend, t, localeTag(locale))}</dd>
      </dl>
      <div className="flex flex-wrap gap-1.5">
        {backend.capabilities.map((capability) => <Badge key={capability} data-capability={capability} variant="secondary">{t(CAPABILITY_KEYS[capability])}</Badge>)}
      </div>
    </article>
  );
}

function FailureRow({
  failure,
  resuming,
  resumed,
  onResume,
}: {
  readonly failure: RuntimeFailureDiagnostic;
  readonly resuming: boolean;
  readonly resumed: boolean;
  readonly onResume: (failure: RuntimeFailureDiagnostic) => void;
}) {
  const t = useT();
  return (
    <article data-failure-stage={failure.stage} data-failure-code={failure.code} className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={failure.project_name}>{failure.project_name}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t(`settings.runtimeStage.${failure.stage}`)} · <code>{failure.code}</code></p>
      </div>
      {resumed
        ? <Button asChild type="button" size="sm" variant="outline"><a data-resume-project-id={failure.project_id} href={`/projects/${encodeURIComponent(failure.project_id)}`}>{t("settings.runtimeContinue")}<ArrowUpRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" /></a></Button>
        : failure.can_resume
          ? <Button type="button" size="sm" variant="outline" data-resume-project-id={failure.project_id} disabled={resuming} onClick={() => onResume(failure)}>{t(resuming ? "settings.runtimeResuming" : "settings.runtimeResume")}</Button>
          : null}
    </article>
  );
}

function modelFreshness(
  backend: RuntimeBackendDiagnostic,
  translate: ReturnType<typeof useT>,
  locale: string,
): string {
  if (backend.model_catalog.source === "not_tracked") return translate("settings.runtimeModelsNotTracked");
  if (backend.model_catalog.fetched_at === null) return translate("settings.runtimeModelsBundled");
  return translate("settings.runtimeModelsCached", {
    date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(backend.model_catalog.fetched_at),
  });
}
