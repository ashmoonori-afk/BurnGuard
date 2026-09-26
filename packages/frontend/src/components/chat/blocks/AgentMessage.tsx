import { CheckCircle2, CircleMinus, CircleSlash, Loader2, OctagonX, PauseCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TurnDisposition } from "@/lib/turn-disposition";
import { useT, type MessageKey } from "@/i18n/t";

const DISPOSITION_COPY: Record<TurnDisposition, { readonly key: MessageKey; readonly icon: LucideIcon; readonly tone: string }> = {
  pending: { key: "chat.turn.pending", icon: Loader2, tone: "text-muted-foreground" },
  committed: { key: "chat.turn.committed", icon: CheckCircle2, tone: "text-muted-foreground" },
  unchanged: { key: "chat.turn.unchanged", icon: CircleMinus, tone: "text-muted-foreground" },
  not_applied: { key: "chat.turn.not_applied", icon: CircleSlash, tone: "text-destructive" },
  rejected: { key: "chat.turn.rejected", icon: OctagonX, tone: "text-destructive" },
  stopped: { key: "chat.turn.stopped", icon: PauseCircle, tone: "text-muted-foreground" },
};

/**
 * One agent message plus where its turn stands.
 *
 * The standing is always shown: a message whose turn has not published yet says so rather than
 * sitting on screen looking saved, and a refused turn's own text is kept but marked not applied.
 */
export default function AgentMessage({
  text,
  turnId,
  disposition,
}: {
  text: string;
  turnId: string;
  disposition: TurnDisposition;
}) {
  const t = useT();
  const { key, icon: Icon, tone } = DISPOSITION_COPY[disposition];
  const refused = disposition === "not_applied" || disposition === "rejected";
  return (
    <div
      data-qa="agent-message"
      data-turn-id={turnId}
      data-turn-disposition={disposition}
      className={refused ? "rounded-md border border-destructive/30 bg-destructive/5 p-3" : undefined}
    >
      <div className={`whitespace-pre-wrap break-words text-sm leading-7 ${refused ? "text-muted-foreground" : "text-foreground"}`}>
        {text}
      </div>
      <div
        data-qa={disposition === "not_applied" ? "turn-not-applied" : "turn-standing"}
        className={`mt-1.5 flex items-start gap-1.5 text-[11px] leading-5 ${tone}`}
      >
        <Icon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{t(key)}</span>
      </div>
    </div>
  );
}
