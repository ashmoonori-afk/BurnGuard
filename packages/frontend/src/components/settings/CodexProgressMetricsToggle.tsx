import type { SettingsPatch, SettingsSummary } from "@bg/shared";
import { useT } from "@/i18n/t";

/**
 * Only a value the user changed becomes an explicit choice; an untouched toggle keeps the automatic
 * default, which follows whether the user has their own Codex OpenTelemetry destination.
 */
export function codexProgressMetricsPatch(loaded: SettingsSummary | undefined, checked: boolean): Pick<SettingsPatch, "codex_progress_metrics"> {
  return loaded?.codex_progress_metrics === checked ? {} : { codex_progress_metrics: checked };
}

/** Codex progress signal, on by default; the note appears when the user has their own Codex OTel destination. */
export default function CodexProgressMetricsToggle({ checked, userOtelConfigured, onChange }: { checked: boolean; userOtelConfigured: boolean; onChange: (checked: boolean) => void }) {
  const t = useT();
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          role="switch"
          aria-checked={checked}
          aria-describedby="codex-progress-metrics-hint"
          data-bg-setting="codex_progress_metrics"
          className="h-4 w-4 accent-accent"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        {t("settings.codexProgressMetrics")}
      </label>
      <p id="codex-progress-metrics-hint" className="text-xs text-muted-foreground">{t("settings.codexProgressMetricsHint")}</p>
      {userOtelConfigured ? <p role="note" data-bg-codex-progress-note="user-otel" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">{t("settings.codexProgressMetricsUserOtel")}</p> : null}
    </div>
  );
}
