import { X } from "lucide-react";
import { useUIStore } from "@/state/uiStore";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/t";
import { toastToneStyle } from "./toast-tone";

/**
 * Global toast container. Sits above all content at bottom-right.
 * Call `useUIStore.getState().pushToast({...})` to enqueue.
 */
export default function ToastContainer() {
  const translate = useT();
  const toasts = useUIStore((s) => s.toasts);
  const dismiss = useUIStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-toast space-y-2 w-[min(20rem,calc(100vw-2rem))] pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const tone = toastToneStyle(t.tone);
        const ToneIcon = tone.icon;
        return (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : undefined}
          data-tone={t.tone ?? "info"}
          className={cn(
            "pointer-events-auto rounded-card border bg-popover p-3 text-popover-foreground shadow-app-3",
            tone.border,
          )}
        >
          <div className="flex items-start gap-2">
            <ToneIcon aria-hidden="true" className={cn("mt-0.5 h-4 w-4 shrink-0", tone.iconColor)} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{t.title}</div>
              {t.body && (
                <div className="text-xs text-muted-foreground mt-0.5 break-words">
                  {t.body}
                </div>
              )}
              {t.action !== undefined ? <button type="button" className="mt-2 rounded-control border border-border px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover" onClick={() => { t.action?.onSelect(); dismiss(t.id); }}>{t.action.label}</button> : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="-mr-1.5 -mt-1.5 grid min-h-9 min-w-9 place-items-center rounded-control text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
              aria-label={translate("shell.close")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        );
      })}
    </div>
  );
}
