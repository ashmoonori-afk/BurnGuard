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
        기본 생성 도구
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
                "w-full rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
                  {b.id === "claude-code" ? "Claude Code" : "Codex"}
                </span>
                {b.found && b.version && (
                  <span className="text-xs text-muted-foreground font-mono ml-auto">
                    {b.version}
                  </span>
                )}
              </div>
              {b.found ? (
                <div className="text-xs text-muted-foreground mt-2">
                  {b.id === "codex" ? b.authenticated === true ? "Codex 로그인을 확인했어요." : "설치는 확인했어요. 그래픽 생성에는 Codex 로그인이 필요해요." : "설치를 확인했어요. 로그인 또는 CommandCode API 키로 생성할 수 있어요."}
                </div>
              ) : (
                b.install_hint && (
                  <div className="text-xs text-muted-foreground mt-2 inline-flex items-center gap-1">
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
