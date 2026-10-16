import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CreateProjectResponse } from "@bg/shared";
import { detectBackends, getSettings, listDesignSystems } from "@/api/home";
import { useT } from "@/i18n/t";
import { firstRunBackend } from "@/lib/first-run";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/state/uiStore";
import NewProjectPanel from "./NewProjectPanel";

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

  return <section data-qa="first-run-guide" aria-labelledby="first-run-title" className="mb-6 max-w-3xl space-y-4 rounded-xl border border-border bg-card p-4 sm:p-6">
    <div>
      <div className="flex items-start justify-between gap-4">
        <h2 id="first-run-title" className="text-lg font-semibold">{t("home.firstRun.title")}</h2>
        <Button data-qa="first-run-dismiss" type="button" variant="ghost" className="min-h-11 shrink-0" disabled={pending} onClick={onDismiss}>{t("home.firstRun.dismiss")}</Button>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("home.firstRun.hint")}</p>
      <button type="button" onClick={() => setSettingsOpen(true)} className="mt-2 min-h-11 rounded-md text-left text-sm text-accent underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("home.firstRun.connections")}</button>
    </div>
    {settings.data ? <NewProjectPanel guided type="prototype" designSystems={systems.data ?? []}
      defaultBackend={firstRunBackend(detection.data?.backends ?? [], settings.data.default_backend)}
      generationDefaults={settings.data.generation_defaults}
      systemsLoading={systems.isFetching} systemsError={systems.error}
      onRetrySystems={() => void systems.refetch()} onPendingChange={setPending} onCreated={onCreated} />
      : settings.isError ? <div role="alert" className="space-y-2">
        <p className="text-sm text-muted-foreground">{t("home.settingsError")}</p>
        <Button variant="outline" onClick={() => void settings.refetch()}>{t("home.settingsRetry")}</Button>
      </div> : <p role="status" className="text-sm text-muted-foreground">{t("home.settingsLoading")}</p>}
  </section>;
}
