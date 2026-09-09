import { useState, type ReactNode } from "react";
import { MessageSquare, MessageCircleMore } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BackendId, Comment, FileInfo, NormalizedEvent, SessionInfo } from "@bg/shared";
import MessageStream from "./MessageStream";
import Composer from "./Composer";
import CommentPanel from "@/components/modes/CommentPanel";
import type { ReadyAttachmentSource } from "./attachment-intake";
import { switchSessionBackend } from "@/api/session";
import { useUIStore } from "@/state/uiStore";
import { cn } from "@/lib/utils";
import { apiErrorCopy } from "@/lib/error-copy";

type Tab = "chat" | "comments";

export default function ChatPane({
  events,
  session,
  composerDisabled,
  canInterrupt,
  turnElapsedMs,
  interruptPending,
  onInterrupt,
  onSend,
  onOpenFile,
  onRevertTurn,
  revertingTurnId,
  composerInitialText,
  statusSlot,
  projectFiles,
  comments,
  activeRelPath,
  activeSlideIdx,
  focusedCommentId,
  onFocusComment,
  onUpdateCommentBody,
  onToggleCommentResolved,
}: {
  events: NormalizedEvent[];
  session: SessionInfo;
  composerDisabled?: boolean;
  canInterrupt?: boolean;
  turnElapsedMs?: number | null;
  interruptPending?: boolean;
  onInterrupt?: () => void;
  onSend: (
    text: string,
    files: readonly ReadyAttachmentSource[],
    signal: AbortSignal,
  ) => void | Promise<void>;
  onOpenFile?: (relPath: string) => void;
  onRevertTurn?: (turnId: string) => void;
  revertingTurnId?: string | null;
  composerInitialText?: string;
  statusSlot?: ReactNode;
  projectFiles: readonly FileInfo[];
  comments: Comment[];
  activeRelPath: string | null;
  activeSlideIdx: number | null;
  focusedCommentId: string | null;
  onFocusComment: (id: string | null) => void;
  onUpdateCommentBody: (id: string, body: string) => void;
  onToggleCommentResolved: (id: string, resolved: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>("chat");
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);

  const switchBackend = useMutation({
    mutationFn: (backendId: BackendId) =>
      switchSessionBackend(session.id, backendId),
    onSuccess: (updated) => {
      queryClient.setQueryData<SessionInfo>(
        ["project", updated.project_id, "session"],
        updated,
      );
      pushToast({
        title: "AI 모델을 바꿨어요",
        body: `다음 턴부터 ${backendLabel(updated.backend_id)}를 사용해요.`,
        tone: "success",
      });
    },
    onError: (err) => {
      pushToast({
        title: "AI 모델을 바꾸지 못했어요",
        body: apiErrorCopy(err),
        tone: "error",
      });
    },
  });

  const sessionRunning = session.status === "running";
  const openCommentCount = comments.filter((comment) => comment.resolved_at === null).length;

  return (
    <aside aria-label="AI 대화와 코멘트" className="flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden bg-background min-[901px]:w-[340px] min-[901px]:border-r min-[901px]:border-border">
      <div className="flex shrink-0 items-stretch gap-4 border-b border-border px-4 pt-2">
        <ChatTab
          id="chat"
          active={tab}
          setActive={setTab}
          icon={<MessageSquare className="h-3.5 w-3.5" />}
        >
          대화
        </ChatTab>
        <ChatTab
          id="comments"
          active={tab}
          setActive={setTab}
          icon={<MessageCircleMore className="h-3.5 w-3.5" />}
        >
          코멘트 {openCommentCount > 0 && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{openCommentCount}</span>}
        </ChatTab>
      </div>
      <div hidden={tab !== "chat"} className={tab === "chat" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground">AI 모델</span>
          <BackendToggle
            current={session.backend_id}
            disabled={switchBackend.isPending || sessionRunning}
            onSwitch={(next) => switchBackend.mutate(next)}
          />
        </div>
          <MessageStream
            events={events}
            session={session}
            onOpenFile={onOpenFile}
            onRevertTurn={onRevertTurn}
            revertingTurnId={revertingTurnId}
          />
          {statusSlot !== undefined && statusSlot !== null && (
            <div className="shrink-0">{statusSlot}</div>
          )}
          <Composer
            key={session.id}
            sessionId={session.id}
            onSend={onSend}
            disabled={composerDisabled}
            canInterrupt={canInterrupt}
            turnElapsedMs={turnElapsedMs}
            interruptPending={interruptPending}
            onInterrupt={onInterrupt}
            initialText={composerInitialText}
            projectFiles={projectFiles}
          />
      </div>
      {tab === "comments" && (
        <CommentPanel
          comments={comments}
          activeRelPath={activeRelPath}
          activeSlideIdx={activeSlideIdx}
          focusedId={focusedCommentId}
          onFocus={onFocusComment}
          onUpdateBody={onUpdateCommentBody}
          onToggleResolved={onToggleCommentResolved}
        />
      )}
    </aside>
  );
}

function BackendToggle({
  current,
  disabled,
  onSwitch,
}: {
  current: BackendId;
  disabled: boolean;
  onSwitch: (next: BackendId) => void;
}) {
  const options: BackendId[] = ["claude-code", "codex"];
  return (
    <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-0.5" role="group" aria-label="AI 모델 선택">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => {
            if (disabled || opt === current) return;
            onSwitch(opt);
          }}
          disabled={disabled}
          aria-pressed={opt === current}
          title={
            disabled && opt !== current
              ? "턴 실행 중에는 바꿀 수 없어요"
              : opt === current
                ? `사용 중: ${backendLabel(opt)}`
                : `다음 턴부터 ${backendLabel(opt)} 사용`
          }
          className={cn(
            "min-h-8 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[900px]:min-h-11 max-[900px]:min-w-11",
            opt === current
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
            disabled && opt !== current && "opacity-40 cursor-not-allowed",
          )}
        >
          {backendLabel(opt)}
        </button>
      ))}
    </div>
  );
}

function backendLabel(id: BackendId): string {
  return id === "claude-code" ? "Claude Code" : "Codex";
}

function ChatTab({
  id,
  active,
  setActive,
  icon,
  children,
}: {
  id: Tab;
  active: Tab;
  setActive: (t: Tab) => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => setActive(id)}
      aria-pressed={active === id}
      className={cn(
        "flex min-h-11 items-center gap-2 border-b-2 -mb-px px-1 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active === id
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
