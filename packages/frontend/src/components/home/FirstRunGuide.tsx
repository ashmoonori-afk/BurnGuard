import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CreateProjectResponse } from "@bg/shared";
import { detectBackends, getSettings, listDesignSystems } from "@/api/home";
import { useT } from "@/i18n/t";
import { backendLabel } from "@/lib/backend-display";
import { FIRST_RUN_CONNECTION_COPY, firstRunBackend, firstRunConnectionState } from "@/lib/first-run";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/state/uiStore";
import NewProjectPanel from "./NewProjectPanel";

/** A tool that is installed needs no action; every other state has exactly one: open Settings. */
const NEEDS_SETUP = new Set<ReturnType<typeof firstRunConnectionState>>(["missing", "probe-failed", "sign-in-required"]);

export default function FirstRunGuide({ onDismiss, onCreated }: {
  onDismiss: () => void;
  onCreated: (project: CreateProjectResponse) => void;
}) {
  const t = useT();
  const setSettingsOpen = useUIStore((state) => state.setSettingsOpen);
  const [pending, setPending] = useState(false);
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const detection = useQuery({ queryKey: ["backends", "detect"], queryFn: detectBackends });
  const systems = useQuery({ queryKey: ["design-systems", "all"], queryFn: () => listDesignSystems("all") });
  const backends = detection.data?.backends ?? [];

  return <section data-qa="first-run-guide" aria-labelledby="first-run-title" className="mb-8 rounded-xl border border-border bg-card p-4 sm:p-6">
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 id="first-run-title" className="text-lg font-semibold">{t("home.firstRun.title")}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{t("home.firstRun.hint")}</p>
      </div>
      <Button data-qa="first-run-dismiss" type="button" variant="outline" size="sm" className="shrink-0" disabled={pending} onClick={onDismiss}>{t("home.firstRun.dismiss")}</Button>
    </div>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      {backends.length > 0 ? <div>
        <h3 className="mb-2 text-sm font-semibold">{t("home.firstRun.providers")}</h3>
        <ul className="space-y-2">
          {backends.map((backend) => {
            const state = firstRunConnectionState(backend);
            return <li key={backend.id} data-connection-state={state} className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{backendLabel(backend.id)}</p>
                <p className="text-xs text-muted-foreground">{t(FIRST_RUN_CONNECTION_COPY[state])}</p>
              </div>
              {NEEDS_SETUP.has(state) ? <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => setSettingsOpen(true)}>{t("home.firstRun.setup")}</Button> : null}
            </li>;
          })}
        </ul>
      </div> : null}
      <div className={backends.length > 0 ? "" : "lg:col-span-2"}>
        {settings.data ? <NewProjectPanel guided type="prototype" designSystems={systems.data ?? []}
          defaultBackend={firstRunBackend(backends, settings.data.default_backend)}
          generationDefaults={settings.data.generation_defaults}
          systemsLoading={systems.isFetching} systemsError={systems.error}
          onRetrySystems={() => void systems.refetch()} onPendingChange={setPending} onCreated={onCreated} />
          : settings.isError ? <div role="alert" className="space-y-2">
            <p className="text-sm text-muted-foreground">{t("home.settingsError")}</p>
            <Button variant="outline" onClick={() => void settings.refetch()}>{t("home.settingsRetry")}</Button>
          </div> : <p role="status" className="text-sm text-muted-foreground">{t("home.settingsLoading")}</p>}
      </div>
    </div>
  </section>;
}
