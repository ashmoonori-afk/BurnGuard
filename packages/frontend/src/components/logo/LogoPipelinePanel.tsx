import type { LogoActionV1, LogoSetV1 } from "@bg/shared";
import { Check, Loader2 } from "lucide-react";
import LogoDirectionPanel from "@/components/logo/LogoDirectionPanel";
import LogoMoodboardPanel from "@/components/logo/LogoMoodboardPanel";
import { useT, type MessageKey } from "@/i18n/t";
import { cn } from "@/lib/utils";

export type LogoPipelineStage = "inspiration" | "idea" | "design";

const STAGES: readonly { readonly id: LogoPipelineStage; readonly label: MessageKey }[] = [
  { id: "inspiration", label: "logo.pipeline.inspiration" },
  { id: "idea", label: "logo.pipeline.idea" },
  { id: "design", label: "logo.pipeline.design" },
];

/**
 * The logo workflow work surface: one connected stage stepper over the Inspiration
 * board and the Idea direction picker. A stage is reachable only once it has
 * something to show, and a stage counts as complete once a later one is reachable.
 * The Design stage renders no body - the view keeps the existing canvas and
 * candidate panels for it - so the pane owns exactly one scrollport, inside the
 * active step. Step bodies are keyed by project so no local draft (search terms,
 * selection, mix picks) crosses projects.
 */
export default function LogoPipelinePanel({
  projectId,
  brief,
  disabled,
  stage,
  ideaAvailable,
  designAvailable,
  onStageChange,
  onAction,
}: {
  readonly projectId: string;
  readonly brief: LogoSetV1;
  readonly disabled: boolean;
  readonly stage: LogoPipelineStage;
  readonly ideaAvailable: boolean;
  readonly designAvailable: boolean;
  readonly onStageChange: (stage: LogoPipelineStage) => void;
  readonly onAction: (action: LogoActionV1) => void;
}) {
  const t = useT();
  const available: Record<LogoPipelineStage, boolean> = {
    inspiration: true,
    idea: ideaAvailable,
    design: designAvailable,
  };
  const reached = designAvailable ? 2 : ideaAvailable ? 1 : 0;
  const showsBody = stage !== "design";

  return (
    <section
      aria-label={t("logo.pipeline.title")}
      className={cn("flex min-w-0 flex-col bg-card", showsBody ? "min-h-0 flex-1" : "shrink-0")}
    >
      <nav
        aria-label={t("logo.pipeline.title")}
        className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-2 sm:px-4"
      >
        <ol className="flex min-w-0 max-w-xl flex-1 items-center">
          {STAGES.map((entry, index) => {
            const current = entry.id === stage;
            const done = index < reached;
            const open = available[entry.id];
            const last = index === STAGES.length - 1;
            return (
              <li key={entry.id} className={cn("flex min-w-0 items-center", !last && "flex-1")}>
                <button
                  type="button"
                  aria-current={current ? "step" : undefined}
                  disabled={!open}
                  onClick={() => onStageChange(entry.id)}
                  className={cn(
                    "flex min-h-11 shrink-0 items-center gap-2 rounded-md px-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                    current
                      ? "font-semibold text-foreground"
                      : open
                        ? "font-medium text-muted-foreground hover:text-foreground"
                        : "font-medium text-muted-foreground/60",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-colors",
                      current
                        ? "bg-accent text-accent-foreground"
                        : done
                          ? "bg-accent/10 text-accent"
                          : "border border-border bg-card",
                      !open && "opacity-60",
                    )}
                  >
                    {done && !current ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : index + 1}
                  </span>
                  {t(entry.label)}
                  {done ? <span className="sr-only">, {t("logo.pipeline.stepDone")}</span> : null}
                </button>
                {last ? null : (
                  <span
                    aria-hidden="true"
                    className={cn("mx-1 h-0.5 min-w-2 flex-1 rounded-full sm:mx-2", done ? "bg-accent/50" : "bg-border")}
                  />
                )}
              </li>
            );
          })}
        </ol>
        {disabled ? (
          <p role="status" className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            <span className="max-sm:sr-only">{t("logo.pipeline.working")}</span>
          </p>
        ) : null}
      </nav>

      {showsBody ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-card">
          {stage === "inspiration" ? (
            <LogoMoodboardPanel
              key={projectId}
              projectId={projectId}
              brief={brief}
              disabled={disabled}
              onNext={() => onAction({ action: "ideate" })}
            />
          ) : (
            <LogoDirectionPanel key={projectId} projectId={projectId} disabled={disabled} onAction={onAction} />
          )}
        </div>
      ) : null}
    </section>
  );
}
