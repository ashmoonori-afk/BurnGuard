import { useEffect, useRef, useState } from "react";
import type { Comment } from "@bg/shared";
import { cn } from "@/lib/utils";

export default function CommentPanel({
  comments,
  activeRelPath,
  activeSlideIdx,
  focusedId,
  onFocus,
  onUpdateBody,
  onToggleResolved,
  onRequestEdit,
  editDisabled,
}: {
  comments: Comment[];
  activeRelPath: string | null;
  activeSlideIdx: number | null;
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  onUpdateBody: (id: string, body: string) => void;
  onToggleResolved: (id: string, resolved: boolean) => void;
  onRequestEdit?: (comment: Comment, body: string) => Promise<void>;
  editDisabled?: boolean;
}) {
  const visible = activeRelPath
    ? comments.filter((c) => {
        if (c.rel_path !== activeRelPath) return false;
        if (c.resolved_at !== null) return false;
        if (activeSlideIdx != null) {
          const pinSlide = c.slide_index ?? 0;
          if (pinSlide !== activeSlideIdx) return false;
        }
        return true;
      })
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-3 py-2">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          코멘트
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground [word-break:keep-all]">
          캔버스를 클릭하면 그 자리에 핀이 생겨요. 핀은 활성 파일의 백분율
          위치에 고정돼요.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {visible.length === 0 && (
          <p className="px-1 pt-2 text-xs text-muted-foreground">
            {activeRelPath
              ? activeSlideIdx != null
                ? "이 슬라이드에는 아직 열린 코멘트가 없어요."
                : "이 파일에는 아직 열린 코멘트가 없어요."
              : "코멘트를 남기려면 캔버스에서 파일을 여세요."}
          </p>
        )}

        {visible.map((comment, idx) => (
          <CommentItem
            key={comment.id}
            index={idx + 1}
            comment={comment}
            focused={comment.id === focusedId}
            onRequestEdit={onRequestEdit ? (body) => onRequestEdit(comment, body) : undefined}
            editDisabled={editDisabled}
            onFocus={() =>
              onFocus(comment.id === focusedId ? null : comment.id)
            }
            onUpdateBody={(body) => onUpdateBody(comment.id, body)}
            onToggleResolved={() =>
              onToggleResolved(comment.id, comment.resolved_at === null)
            }
          />
        ))}
      </div>
    </div>
  );
}

function CommentItem({
  comment,
  index,
  focused,
  onFocus,
  onUpdateBody,
  onToggleResolved,
  onRequestEdit,
  editDisabled,
}: {
  comment: Comment;
  index: number;
  focused: boolean;
  onFocus: () => void;
  onUpdateBody: (body: string) => void;
  onToggleResolved: () => void;
  onRequestEdit?: (body: string) => Promise<void>;
  editDisabled?: boolean;
}) {
  const [draft, setDraft] = useState(comment.body);
  const editingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState("");
  const resolved = comment.resolved_at !== null;

  useEffect(() => {
    setDraft((current) =>
      nextCommentDraft(current, comment.body, editingRef.current),
    );
  }, [comment.body]);

  const commitIfDirty = () => {
    if (draft !== comment.body) onUpdateBody(draft);
  };

  return (
    <div
      className={cn(
        "rounded-md border text-xs bg-background",
        focused ? "border-orange-400" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={onFocus}
        className="flex w-full items-center gap-2 border-b border-border px-2 py-1.5 text-left"
      >
        <span
          className={cn(
            "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
            resolved
              ? "bg-muted text-muted-foreground"
              : "bg-orange-500 text-white",
          )}
        >
          {index}
        </span>
        <span className="flex-1 truncate font-mono text-[10px] text-muted-foreground">
          {comment.node_selector || "body"}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {resolved ? "해결됨" : "열림"}
        </span>
      </button>

      <div className="p-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => {
            editingRef.current = true;
          }}
          onBlur={() => {
            commitIfDirty();
            editingRef.current = false;
          }}
          placeholder="메모를 남겨 보세요..."
          rows={2}
          className="w-full resize-none rounded border border-border bg-background p-1.5 text-xs"
        />
        {onRequestEdit && <button type="button" className="mt-1 rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
          disabled={editDisabled || sending || !draft.trim()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={async () => {
            setSending(true); setSendStatus("");
            try { await onRequestEdit(draft); setSendStatus("AI에 수정 요청을 보냈어요. 대화에서 진행 상황과 변경 파일을 확인해 주세요."); }
            catch { setSendStatus("수정 요청을 보내지 못했어요. 대화 상태를 확인하고 다시 시도해 주세요."); }
            finally { setSending(false); }
          }}>{sending ? "보내는 중…" : "저장하고 AI로 수정"}</button>}
        {draft !== comment.body && <p className="text-[10px] text-muted-foreground">수정 요청을 누르면 메모를 먼저 저장해요.</p>}
        {sendStatus && <p role="status" className="mt-1 text-[10px] text-muted-foreground">{sendStatus}</p>}
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {new Date(comment.created_at).toLocaleString()}
          </span>
          <button
            type="button"
            onClick={onToggleResolved}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            {resolved ? "다시 열기" : "해결하기"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function nextCommentDraft(
  current: string,
  serverBody: string,
  editing: boolean,
): string {
  return editing ? current : serverBody;
}
