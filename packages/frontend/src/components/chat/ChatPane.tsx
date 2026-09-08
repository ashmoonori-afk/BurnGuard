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
        title: "백엔드를 바꿨어요",
        body: `다음 턴부터 ${backendLabel(updated.backend_id)}를 사용해요.`,
        tone: "success",
      });
    },
    onError: (err) => {
      pushToast({
        title: "백엔드를 바꾸지 못했어요",
        body: apiErrorCopy(err),
        tone: "error",
      });
    },
  });

  const sessionRunning = session.status === "running";

  return (
    <aside className="w-[360px] shrink-0 border-r border-border bg-background flex flex-col min-h-0 overflow-hidden max-[900px]:h-[360px] max-[900px]:w-full max-[900px]:border-r-0 max-[900px]:border-b">
      <div className="flex items-stretch gap-1 px-3 pt-2 border-b border-border">
        <ChatTab
          id="chat"
          active={tab}
          setActive={setTab}
          icon={<MessageSquare className="h-3.5 w-3.5" />}
        >
          채팅
        </ChatTab>
        <ChatTab
          id="comments"
          active={tab}
          setActive={setTab}
          icon={<MessageCircleMore className="h-3.5 w-3.5" />}
        >
          코멘트
        </ChatTab>
        <div className="ml-auto flex items-center gap-1 pb-1 text-[10px]">
          <span className="text-muted-foreground">백엔드</span>
          <BackendToggle
            current={session.backend_id}
            disabled={switchBackend.isPending || sessionRunning}
            onSwitch={(next) => switchBackend.mutate(next)}
          />
        </div>
      </div>
      <div hidden={tab !== "chat"} className={tab === "chat" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
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
    <div className="flex overflow-hidden rounded border border-border">
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
            "max-[900px]:min-h-11 max-[900px]:min-w-11 px-1.5 py-0.5 font-mono uppercase transition-colors",
            opt === current
              ? "bg-foreground/90 text-background"
              : "bg-background text-muted-foreground hover:text-foreground",
            disabled && opt !== current && "opacity-40 cursor-not-allowed",
          )}
        >
          {opt === "claude-code" ? "cc" : "cx"}
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
      onClick={() => setActive(id)}
      aria-pressed={active === id}
      className={cn(
        "flex max-[900px]:min-h-11 items-center gap-1.5 px-2.5 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
        active === id
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
