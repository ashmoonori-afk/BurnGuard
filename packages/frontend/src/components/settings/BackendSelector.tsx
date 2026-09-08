import { Check, XCircle, ExternalLink } from "lucide-react";
import type { BackendDetectionResult, BackendId } from "@bg/shared";
import { cn } from "@/lib/utils";

export default function BackendSelector({
  value,
  onChange,
  detection,
}: {
  value: BackendId;
  onChange: (v: BackendId) => void;
  detection: BackendDetectionResult;
}) {
  return (
    <div className="space-y-2">
      <div id="backend-selector-label" className="text-xs font-medium text-muted-foreground">
        기본 백엔드
      </div>
      <div role="group" aria-labelledby="backend-selector-label" className="space-y-2">
        {detection.backends.map((b) => {
          const active = value === b.id;
          return (
            <button
              key={b.id}
              type="button"
              aria-pressed={active}
              onClick={() => b.found && onChange(b.id)}
              disabled={!b.found}
              className={cn(
                "w-full rounded-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-accent bg-accent/5"
                  : "border-border hover:bg-muted/50",
                !b.found && "opacity-60 cursor-not-allowed",
              )}
            >
              <div className="flex items-center gap-2">
                {b.found ? (
                  <Check className="h-4 w-4 text-accent shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span className="text-sm font-medium capitalize">
                  {b.id.replace("-", " ")}
                </span>
                {b.found && b.version && (
                  <span className="text-xs text-muted-foreground font-mono ml-auto">
                    {b.version}
                  </span>
                )}
              </div>
              {b.found ? (
                <div className="text-[11px] text-muted-foreground font-mono mt-1 truncate">
                  {b.binary_path}
                </div>
              ) : (
                b.install_hint && (
                  <div className="text-[11px] text-muted-foreground mt-1 inline-flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" />
                    {b.install_hint}
                  </div>
                )
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
