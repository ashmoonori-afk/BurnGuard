import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ChevronRight, Loader2, MessageSquare, Wrench } from "lucide-react";
import type { NormalizedEvent, SessionInfo } from "@bg/shared";
import AgentMessage, { TurnStanding } from "./blocks/AgentMessage";
import ThinkingBlock from "./blocks/ThinkingBlock";
import ToolBadge from "./blocks/ToolBadge";
import ErrorCard from "./blocks/ErrorCard";
import UsageFooter from "./blocks/UsageFooter";
import UserMessage from "./blocks/UserMessage";
import { useT, type MessageKey } from "@/i18n/t";
import { toolBadgeCopy, type ToolBadgeState } from "@/lib/tool-badge-copy";
import { projectTurnStates } from "@/lib/turn-disposition";
import { cn } from "@/lib/utils";

const STICK_THRESHOLD_PX = 80;

// BurnGuard's own stages say where the turn is and why it waits, so they stay in the conversation.
// Provider tool calls (commands, reads, searches, edits, and their failed attempts) are routine: a
// failure that matters ends the turn with a status.error card, so they share one quiet disclosure.
const PIPELINE_TOOL_KEYS: ReadonlySet<MessageKey> = new Set<MessageKey>([
  "chat.tool.resumeStalled",
  "chat.tool.resumeIncomplete",
  "chat.tool.saveArtifact",
  "chat.tool.phasePlan",
  "chat.tool.phaseContent",
  "chat.tool.designReview",
  "chat.tool.deckReview",
  "chat.tool.logoRepair",
  "chat.tool.importInit",
]);

export default function MessageStream({
  events,
  session,
  projectDir,
  onOpenFile,
  onRevertTurn,
  revertingTurnId,
}: {
  events: NormalizedEvent[];
  session: SessionInfo;
  projectDir?: string;
  onOpenFile?: (relPath: string) => void;
  onRevertTurn?: (turnId: string) => void;
  revertingTurnId?: string | null;
}) {
  const t = useT();
  const groups = useMemo(() => buildGroups(events), [events]);
  const turnStates = useMemo(() => projectTurnStates(events), [events]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Sticky-bottom mode: when true, the next render snaps the scroll
  // position to the new content height so streaming chunks stay visible.
  // Flips off the moment the user scrolls up; flips back on once they
  // return within the threshold (or click the Jump-to-latest pill).
  const stickToBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowJump(false);
    } else {
      setShowJump(true);
    }
  }, [events]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distance < STICK_THRESHOLD_PX;
    stickToBottomRef.current = nearBottom;
    if (nearBottom) {
      setShowJump(false);
    }
  }

  function jumpToBottom() {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
    setShowJump(false);
  }

  return (
    <div className="flex-1 min-h-0 relative">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="chat-scroll absolute inset-0 space-y-4 overflow-y-auto px-4 pt-5"
      >
        {groups.length === 0 && (
          <div className="py-4">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MessageSquare className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="text-sm font-semibold tracking-tight">{t("chat.stream.emptyTitle")}</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t("chat.stream.emptyBody")}</p>

          </div>
        )}
        {groups.map((g, i) => {
          switch (g.kind) {
            case "user":
              return (
                <UserMessage
                  key={g.ev.id}
                  text={g.ev.text}
                  attachmentCount={g.ev.attachmentCount}
                  turnId={g.ev.turnId}
                  onRevert={onRevertTurn}
                  reverting={revertingTurnId === g.ev.turnId}
                />
              );
            case "message":
              return (
                <AgentMessage
                  key={`msg-${i}`}
                  text={g.text}
                  projectDir={projectDir}
                  turnId={g.turnId}
                  disposition={turnStates.get(g.turnId)?.disposition ?? "pending"}
                />
              );
            case "stopped":
              return <TurnStanding key={`stopped-${g.turnId}`} turnId={g.turnId} disposition={turnStates.get(g.turnId)?.disposition ?? "stopped"} />;
            case "thinking":
              return <ThinkingBlock key={g.ev.id} text={g.ev.text} />;
            case "tool":
              return (
                <ToolBadge
                  key={g.started.id}
                  tool={g.started.tool}
                  input={g.started.input}
                  state={
                    g.finished
                      ? g.finished.ok
                        ? "finished"
                        : "error"
                      : "running"
                  }
                />
              );
            case "activity":
              return <ToolActivity key={g.steps[0].started.id} steps={g.steps} />;
            case "error":
              return (
                <ErrorCard
                  key={g.ev.id}
                  message={g.ev.message}
                  code={g.ev.code}
                  reason={g.ev.reason}
                  notApplied={g.ev.notApplied}
                  recoverable={g.ev.recoverable}
                />
              );
          }
        })}
        <UsageFooter usage={session.usage} />
      </div>

      {showJump && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="absolute bottom-10 right-4 z-10 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={t("chat.stream.jumpTitle")}
        >
          <ArrowDown className="h-3 w-3" />
          {t("chat.stream.newMessage")}
        </button>
      )}
    </div>
  );
}

type UserMessageEv = Extract<NormalizedEvent, { type: "chat.user_message" }>;
type ToolStarted = Extract<NormalizedEvent, { type: "tool.started" }>;
type ToolFinished = Extract<NormalizedEvent, { type: "tool.finished" }>;
type ThinkingEv = Extract<NormalizedEvent, { type: "chat.thinking" }>;
type ErrorEv = Extract<NormalizedEvent, { type: "status.error" }>;
type ToolStep = { started: ToolStarted; finished: ToolFinished | null };

type Group =
  | { kind: "user"; ev: UserMessageEv }
  | { kind: "message"; turnId: string; text: string }
  | { kind: "stopped"; turnId: string }
  | { kind: "thinking"; ev: ThinkingEv }
  | { kind: "tool"; started: ToolStarted; finished: ToolFinished | null }
  | { kind: "activity"; steps: ToolStep[] }
  | { kind: "error"; ev: ErrorEv };

function buildGroups(events: NormalizedEvent[]): Group[] {
  const finishedById = new Map<string, ToolFinished>();
  for (const ev of events) {
    if (ev.type === "tool.finished") finishedById.set(ev.toolCallId, ev);
  }

  const groups: Group[] = [];
  let textBuf = "";
  // Streamed text belongs to the turn that produced it, so the bubble can say whether that turn
  // reached the project. A delta from a different turn closes the buffer instead of joining it.
  let textTurnId = "";
  // The open user turn and whether any bubble (its own or a repair/review child's) followed it.
  let userTurnId = "";
  let messageSinceUser = false;
  const flushText = () => {
    if (textBuf) {
      groups.push({ kind: "message", turnId: textTurnId, text: textBuf });
      messageSinceUser = true;
      textBuf = "";
    }
  };

  for (const ev of events) {
    switch (ev.type) {
      case "chat.user_message":
        flushText();
        userTurnId = ev.turnId;
        messageSinceUser = false;
        groups.push({ kind: "user", ev });
        break;
      case "status.idle":
        if (ev.stopReason === "requires_action") break;
        if (ev.stopReason === "interrupted") {
          // A turn stopped before it wrote any message has no bubble to carry its standing.
          flushText();
          if (userTurnId && !messageSinceUser) groups.push({ kind: "stopped", turnId: userTurnId });
        }
        userTurnId = "";
        break;
      case "chat.delta":
        if (textBuf && ev.turnId !== textTurnId) flushText();
        textTurnId = ev.turnId;
        textBuf += ev.text;
        break;
      case "chat.message_end":
        flushText();
        break;
      case "chat.thinking":
        flushText();
        groups.push({ kind: "thinking", ev });
        break;
      case "tool.started": {
        flushText();
        const step: ToolStep = { started: ev, finished: finishedById.get(ev.toolCallId) ?? null };
        if (PIPELINE_TOOL_KEYS.has(toolBadgeCopy(ev.tool, "running").nameKey)) {
          groups.push({ kind: "tool", ...step });
          break;
        }
        // Consecutive routine steps join one disclosure; any other block closes it.
        const last = groups[groups.length - 1];
        if (last?.kind === "activity") last.steps.push(step);
        else groups.push({ kind: "activity", steps: [step] });
        break;
      }
      case "status.error":
        flushText();
        groups.push({ kind: "error", ev });
        break;
      default:
        // tolerated: tool.finished, tool.permission_required, status.*,
        // usage.*, file.changed. file.changed still fires in the backend
        // so ProjectView can refresh the iframe + re-index, but we no
        // longer render it as a chat block — every Tweaks / Edit PATCH
        // produced a "deck.html" line that spammed the stream without
        // adding user value.
        break;
    }
  }
  flushText();
  return groups;
}

/** Routine provider steps: one closed, keyboard-reachable line; every step stays listed inside. */
function ToolActivity({ steps }: { steps: readonly ToolStep[] }) {
  const t = useT();
  const running = steps.some((step) => step.finished === null);
  const Icon = running ? Loader2 : Wrench;
  return (
    <details data-qa="tool-activity" className="group text-xs text-muted-foreground">
      <summary className="flex min-h-7 w-fit cursor-pointer list-none items-center gap-1.5 rounded-md hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[900px]:min-h-11 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
        <Icon className={cn("h-3 w-3 shrink-0", running && "motion-safe:animate-spin")} aria-hidden="true" />
        <span>{t(running ? "chat.polish.activityRunning" : "chat.polish.activity", { count: steps.length })}</span>
      </summary>
      <ul className="ml-1.5 mt-1 space-y-0.5 border-l border-border pl-3">
        {steps.map(({ started, finished }) => {
          const state: ToolBadgeState = finished === null ? "running" : finished.ok ? "finished" : "error";
          const copy = toolBadgeCopy(started.tool, state);
          return (
            <li key={started.id} data-qa="tool-activity-step" data-tool-state={state} className="leading-5">
              {t(copy.nameKey)} · {t(copy.stateKey)}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
