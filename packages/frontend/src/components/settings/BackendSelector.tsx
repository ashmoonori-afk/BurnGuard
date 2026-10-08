import { Check, XCircle, ExternalLink } from "lucide-react";
import type { BackendDetectionResult, BackendId } from "@bg/shared";
import { BACKEND_INSTALL_URLS, BACKEND_PROBE_COMMANDS, backendLabel, backendProbeState } from "@/lib/backend-display";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/t";

export default function BackendSelector({
  value,
  onChange,
  detection,
}: {
  value: BackendId;
  onChange: (v: BackendId) => void;
  detection: BackendDetectionResult;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <div id="backend-selector-label" className="text-xs font-medium text-muted-foreground">
        {t("settings.defaultBackend")}
      </div>
      <div role="group" aria-labelledby="backend-selector-label" className="space-y-2">
        {detection.backends.map((b) => {
          const active = value === b.id;
          const state = backendProbeState(b);
          return (
            <button
              key={b.id}
              data-probe-state={state}
              type="button"
              aria-pressed={active}
              onClick={() => b.found && onChange(b.id)}
              disabled={!b.found}
              className={cn(
                "w-full rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-accent bg-accent/5"
                  : "border-border hover:bg-muted/50",
                !b.found && "opacity-60 cursor-not-allowed",
              )}
            >
              <div className="flex items-center gap-2">
                {state === "ready" ? (
                  <Check className="h-4 w-4 text-accent shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span className="text-sm font-medium capitalize">
                  {backendLabel(b.id)}
                </span>
                {state === "ready" && b.version && (
                  <span className="text-xs text-muted-foreground font-mono ml-auto">
                    {b.version}
                  </span>
                )}
              </div>
              {state === "probe_failed" ? (
                <div className="text-xs text-muted-foreground mt-2 space-y-1">
                  <div>{t("settings.backendProbeFailed", { command: BACKEND_PROBE_COMMANDS[b.id] })}</div>
                  <a href={BACKEND_INSTALL_URLS[b.id]} target="_blank" rel="noreferrer" className="text-accent inline-flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" />
                    {t("settings.installBackend", { name: backendLabel(b.id) })}
                  </a>
                </div>
              ) : state === "ready" ? (
                <div className="text-xs text-muted-foreground mt-2">
                  {t(b.id === "codex" ? b.authenticated === true ? "settings.codexAuthenticated" : "settings.codexInstalled" : b.id === "claude-code" ? "settings.claudeInstalled" : "settings.backendInstalled")}
                </div>
              ) : (
                <a href={BACKEND_INSTALL_URLS[b.id]} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground mt-2 inline-flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" />
                  {t("settings.installBackend", { name: backendLabel(b.id) })}
                </a>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
