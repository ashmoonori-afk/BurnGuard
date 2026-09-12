import { t, useT } from "@/i18n/t";
import { useEffect, useState } from "react";
import { DEFAULT_GENERATION_STYLE, type DesignDirectionState, type GenerationStyle } from "@bg/shared";
import { Check, Compass, RotateCcw, StopCircle } from "lucide-react";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { DirectionCard } from "./DirectionCard";
import { GenerationStyleFields } from "./GenerationStyleFields";
import { directionActions, directionProgress } from "@/lib/design-direction-state";

type DirectionsViewProps = {
  readonly state: DesignDirectionState | null;
  readonly recovering: boolean;
  readonly actionPending: boolean;
  readonly cancelPending: boolean;
  readonly error: Error | null;
  readonly onGenerate: (preferences: GenerationStyle) => void;
  readonly onSavePreferences: (preferences: GenerationStyle) => void;
  readonly preferencesSaving: boolean;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
  readonly onSelect: (directionId: string) => void;
  readonly onUndo: () => void;
};

export function DirectionsView({
  state,
  recovering,
  actionPending,
  cancelPending,
  error,
  onGenerate,
  onSavePreferences,
  preferencesSaving,
  onCancel,
  onRetry,
  onSelect,
  onUndo,
}: DirectionsViewProps) {
  const t = useT();
  const savedPreferences = state?.creative_preferences ?? DEFAULT_GENERATION_STYLE;
  const [preferences, setPreferences] = useState(savedPreferences);
  useEffect(() => { setPreferences(savedPreferences); }, [state?.generation_id, savedPreferences.image_style, savedPreferences.copy_tone, savedPreferences.image_recipe]);
  const preferencesChanged = preferences.image_style !== savedPreferences.image_style || preferences.copy_tone !== savedPreferences.copy_tone || (preferences.image_recipe ?? "auto") !== (savedPreferences.image_recipe ?? "auto");
  const actions = directionActions(state);
  const selected =
    state?.directions.find((direction) => direction.id === state.selected_id) ?? null;

  if (recovering && state === null) {
    return (
      <DirectionShell busy>
        <div className="grid min-h-full place-items-center px-4 text-sm text-muted-foreground">
          {t("directions.loadingSaved")}
        </div>
      </DirectionShell>
    );
  }

  if (state === null) {
    return (
      <DirectionShell busy={actionPending}>
        <div className="grid min-h-full place-items-center px-4 py-12 text-center">
          <div className="w-full max-w-3xl rounded-2xl border border-border bg-card px-6 py-10 shadow-sm sm:px-10">
            <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-accent/10"><Compass className="h-7 w-7 text-accent" aria-hidden="true" /></div>
            <h1 className="text-xl font-semibold tracking-tight">{t("directions.introTitle")}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground [word-break:keep-all]">
              {t("directions.introBody")}
            </p>
            <p className="mt-3 text-xs leading-6 text-muted-foreground">{t("directions.introCompare")}</p>
            <GenerationStyleFields value={preferences} onChange={setPreferences} disabled={actionPending} />
            <p className="mt-3 text-xs text-muted-foreground">{t("directions.introPreferences")}</p>
            <Button
              type="button"
              variant="cta"
              className="mt-6 min-h-11"
              disabled={actionPending}
              onClick={() => onGenerate(preferences)}
            >
              {t("directions.generate")}
            </Button>
            <DirectionError error={error} />
          </div>
        </div>
      </DirectionShell>
    );
  }

  const progress = directionProgress(state);
  const loading = state.status === "loading";

  return (
    <DirectionShell busy={loading || actionPending}>
      <div className="mx-auto w-full max-w-[1440px] px-4 py-7 sm:px-7">
        <header className="flex items-start justify-between gap-4 max-[600px]:flex-col">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">{t("directions.title")}</h1>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground [word-break:keep-all]">
              {stateSummary(state, progress.resolved)}
            </p>
          </div>
          {loading ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 shrink-0"
              disabled={cancelPending || !actions.canCancel}
              onClick={onCancel}
            >
              <StopCircle aria-hidden="true" />
              {cancelPending ? t("directions.cancelPending") : t("directions.cancel")}
            </Button>
          ) : actions.canRetry ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 shrink-0"
              disabled={actionPending}
              onClick={onRetry}
            >
              <RotateCcw aria-hidden="true" />
              {t("directions.retryAll")}
            </Button>
          ) : null}
        </header>

        <GenerationStyleFields value={preferences} onChange={setPreferences} disabled={loading || actionPending || preferencesSaving} />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-xs text-muted-foreground">{preferencesSaving ? t("directions.preferencesSaving") : preferencesChanged ? t("directions.preferencesChanged") : t("directions.preferencesSaved")} {t("directions.layoutExample")}</p>
          <Button type="button" variant="outline" disabled={loading || actionPending || preferencesSaving || !preferencesChanged} onClick={() => onSavePreferences(preferences)}>
            {preferencesSaving ? t("directions.saving") : t("directions.savePreferences")}
          </Button>
        </div>
        {!loading ? <ContentOutline items={state.content_outline} /> : null}

        <section
          className="mt-6 grid min-w-0 grid-cols-3 gap-5 max-[1100px]:grid-cols-2 max-[600px]:grid-cols-1"
          aria-label={t("directions.candidates")}
        >
          {state.directions.map((direction) => (
            <DirectionCard
              key={direction.id}
              direction={direction}
              selected={state.selected_id === direction.id}
              selectable={actions.canSelect && !actionPending}
              onSelect={onSelect}
            />
          ))}
        </section>

        {!loading ? (
          <div className="mt-5 flex min-h-14 items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-2 max-[600px]:flex-wrap">
            <Check className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-sm [word-break:keep-all]">
              {selected === null
                ? t("directions.noSelection")
                : t("directions.selection", { name: selected.title })}
            </p>
            {actions.canUndo ? (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 shrink-0"
                disabled={actionPending}
                onClick={onUndo}
              >
                {t("directions.undo")}
              </Button>
            ) : null}
          </div>
        ) : null}
        <DirectionError error={error} />
      </div>
    </DirectionShell>
  );
}

function DirectionShell({
  busy,
  children,
}: {
  readonly busy: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <main
      className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-muted/30"
      aria-busy={busy}
    >
      {children}
    </main>
  );
}

function ContentOutline({ items }: { readonly items: readonly string[] }) {
  const t = useT();
  return (
    <section className="mt-5 rounded-lg border border-border bg-muted/50 p-4">
      <h2 className="text-xs font-medium text-muted-foreground">{t("directions.outline")}</h2>
      <ol className="mt-2 grid gap-1 text-sm min-[1000px]:grid-cols-2">
        {items.map((item, index) => (
          <li
            key={`${index}-${item}`}
            className="min-w-0 break-words [word-break:keep-all]"
          >
            <span className="mr-2 font-mono text-xs text-muted-foreground">{index + 1}</span>
            {item}
          </li>
        ))}
      </ol>
    </section>
  );
}

function stateSummary(state: DesignDirectionState, resolved: number): string {
  switch (state.status) {
    case "loading":
      return t("directions.summary.loading", { count: resolved });
    case "ready":
      return t("directions.summary.ready");
    case "partial":
      return t("directions.summary.partial");
    case "failed":
      return t("directions.summary.failed");
    case "cancelled":
      return t("directions.summary.cancelled");
    default: {
      const unreachable: never = state.status;
      return unreachable;
    }
  }
}

function DirectionError({ error }: { readonly error: Error | null }) {
  useT();
  if (error === null) return null;
  return (
    <p role="alert" className="mt-4 text-sm text-destructive">
      {boundedError(error)}
    </p>
  );
}

function boundedError(error: Error): string {
  if (!(error instanceof ApiError)) return t("directions.error.request");
  if (error.code === "session_busy") return t("directions.error.sessionBusy");
  if (error.code === "operation_active" || error.code === "generation_conflict") {
    return t("directions.error.active");
  }
  if (error.code === "revision_conflict") return t("directions.error.conflict");
  if (error.code === "operation_not_active") return t("directions.error.finished");
  return t("directions.error.direction");
}
