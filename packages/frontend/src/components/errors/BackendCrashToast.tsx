import { X } from "lucide-react";
import { useUIStore } from "@/state/uiStore";
import { cn } from "@/lib/utils";

/**
 * Global toast container. Sits above all content at bottom-right.
 * Call `useUIStore.getState().pushToast({...})` to enqueue.
 */
export default function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts);
  const dismiss = useUIStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-toast space-y-2 w-80 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : undefined}
          className={cn(
            "pointer-events-auto rounded-md border shadow-app-3 bg-background p-3",
            t.tone === "error" && "border-destructive/40",
            t.tone === "warn" && "border-yellow-300",
            t.tone === "success" && "border-accent/40",
          )}
        >
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{t.title}</div>
              {t.body && (
                <div className="text-xs text-muted-foreground mt-0.5 break-words">
                  {t.body}
                </div>
              )}
              {t.action !== undefined ? <button type="button" className="mt-2 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { t.action?.onSelect(); dismiss(t.id); }}>{t.action.label}</button> : null}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="닫기"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
