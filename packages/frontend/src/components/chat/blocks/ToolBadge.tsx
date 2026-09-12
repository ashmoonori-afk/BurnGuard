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
}: {
  tool: string;
  state: "running" | "finished" | "error";
}) {
  const t = useT();
  const Icon =
    state === "running" ? Loader2 : state === "finished" ? Check : AlertCircle;
  const label = t(TOOL_STATE_MESSAGE_KEYS[state]);
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
        state === "running" && "border-border bg-muted text-muted-foreground",
        state === "finished" && "border-border bg-background text-foreground",
        state === "error" &&
          "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      <Wrench className="h-3 w-3" />
      <span className="font-medium">{tool}</span>
      <span className="text-muted-foreground">·</span>
      <Icon className={cn("h-3 w-3", state === "running" && "animate-spin")} />
      <span>{label}</span>
    </div>
  );
}
