import { cn } from "@/lib/utils";
import { Loader2, Check, AlertCircle, Wrench } from "lucide-react";
import { useT, type MessageKey } from "@/i18n/t";

const TOOL_STATE_MESSAGE_KEYS: Record<"running" | "finished" | "error", MessageKey> = {
  running: "chat.tool.running",
  finished: "chat.tool.finished",
  error: "chat.tool.error",
};

export default function ToolBadge({
  tool,
  state,
  input,
}: {
  tool: string;
  state: "running" | "finished" | "error";
  input?: unknown;
}) {
  const t = useT();
  const Icon =
    state === "running" ? Loader2 : state === "finished" ? Check : AlertCircle;
  const label = t(tool === "generation_design_review" && state === "error" ? "chat.tool.reviewIncomplete" : TOOL_STATE_MESSAGE_KEYS[state]);
  const names: Record<string, MessageKey> = {
    generation_resume_stalled: "chat.tool.resumeStalled",
    generation_resume_incomplete: "chat.tool.resumeIncomplete",
    generation_tool_failed: "chat.tool.providerFailed",
    generation_save: "chat.tool.saveArtifact",
    generation_phase_plan: "chat.tool.phasePlan",
    generation_design_review: "chat.tool.designReview",
    generation_phase_content: "chat.tool.phaseContent",
  };
  const progress = input && typeof input === "object" && "from" in input && "to" in input && "total" in input && [input.from, input.to, input.total].every(value => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 80) ? input : null;
  return (
    <div
      className={cn(
        "inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
        state === "running" && "border-border bg-muted text-muted-foreground",
        state === "finished" && "border-border bg-background text-foreground",
        state === "error" &&
          "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      <Wrench className="h-3 w-3" />
      <span className="font-medium">{names[tool] ? t(names[tool]) : tool}</span>
      {tool === "generation_phase_content" && progress && <span>{String(progress.from)}–{String(progress.to)} / {String(progress.total)}</span>}
      <span className="text-muted-foreground">·</span>
      <Icon className={cn("h-3 w-3", state === "running" && "animate-spin")} />
      <span>{label}</span>
    </div>
  );
}
