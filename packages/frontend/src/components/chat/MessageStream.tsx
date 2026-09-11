import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, MessageSquare } from "lucide-react";
import type { NormalizedEvent, SessionInfo } from "@bg/shared";
import AgentMessage from "./blocks/AgentMessage";
import ThinkingBlock from "./blocks/ThinkingBlock";
import ToolBadge from "./blocks/ToolBadge";
import ErrorCard from "./blocks/ErrorCard";
import UsageFooter from "./blocks/UsageFooter";
import UserMessage from "./blocks/UserMessage";

const STICK_THRESHOLD_PX = 80;

export default function MessageStream({
  events,
  session,
  onOpenFile,
  onRevertTurn,
  revertingTurnId,
}: {
  events: NormalizedEvent[];
  session: SessionInfo;
  onOpenFile?: (relPath: string) => void;
  onRevertTurn?: (turnId: string) => void;
  revertingTurnId?: string | null;
}) {
  const groups = useMemo(() => buildGroups(events), [events]);
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
            <h2 className="text-sm font-semibold tracking-tight">무엇을 만들어 볼까요?</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">목적과 원하는 내용을 알려 주세요. 완성된 결과를 보면서 계속 다듬을 수 있어요.</p>

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
              return <AgentMessage key={`msg-${i}`} text={g.text} />;
            case "thinking":
              return <ThinkingBlock key={g.ev.id} text={g.ev.text} />;
            case "tool":
              return (
                <ToolBadge
                  key={g.started.id}
                  tool={g.started.tool}
                  state={
                    g.finished
                      ? g.finished.ok
                        ? "finished"
                        : "error"
                      : "running"
                  }
                />
              );
            case "error":
              return (
                <ErrorCard
                  key={g.ev.id}
                  message={g.ev.message}
                  code={g.ev.code}
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
          title="최신으로 이동"
        >
          <ArrowDown className="h-3 w-3" />
          새 메시지
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

type Group =
  | { kind: "user"; ev: UserMessageEv }
  | { kind: "message"; text: string }
  | { kind: "thinking"; ev: ThinkingEv }
  | { kind: "tool"; started: ToolStarted; finished: ToolFinished | null }
  | { kind: "error"; ev: ErrorEv };

function buildGroups(events: NormalizedEvent[]): Group[] {
  const finishedById = new Map<string, ToolFinished>();
  for (const ev of events) {
    if (ev.type === "tool.finished") finishedById.set(ev.toolCallId, ev);
  }

  const groups: Group[] = [];
  let textBuf = "";
  const flushText = () => {
    if (textBuf) {
      groups.push({ kind: "message", text: textBuf });
      textBuf = "";
    }
  };

  for (const ev of events) {
    switch (ev.type) {
      case "chat.user_message":
        flushText();
        groups.push({ kind: "user", ev });
        break;
      case "chat.delta":
        textBuf += ev.text;
        break;
      case "chat.message_end":
        flushText();
        break;
      case "chat.thinking":
        flushText();
        groups.push({ kind: "thinking", ev });
        break;
      case "tool.started":
        flushText();
        groups.push({
          kind: "tool",
          started: ev,
          finished: finishedById.get(ev.toolCallId) ?? null,
        });
        break;
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
