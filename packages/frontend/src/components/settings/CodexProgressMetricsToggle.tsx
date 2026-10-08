import { useT } from "@/i18n/t";

/** Opt-in Codex progress signal; the note while on says where Codex metrics go instead. */
export default function CodexProgressMetricsToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
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
      {checked ? <p role="note" data-bg-codex-progress-note="on" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">{t("settings.codexProgressMetricsOn")}</p> : null}
    </div>
  );
}
