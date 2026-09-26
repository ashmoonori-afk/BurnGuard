import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Comment } from "@bg/shared";
import { cn } from "@/lib/utils";
import { useT, type MessageKey } from "@/i18n/t";
import { localeTag, useLocaleStore } from "@/i18n/locale";

/** The list follows the active file and slide; resolved comments stay archived unless the panel asks for them. */
export function visibleComments(comments: readonly Comment[], activeRelPath: string | null, activeSlideIdx: number | null, showResolved: boolean): Comment[] {
  return activeRelPath
    ? comments.filter((c) => {
        if (c.rel_path !== activeRelPath) return false;
        if (!showResolved && c.resolved_at !== null) return false;
        if (activeSlideIdx != null) {
          const pinSlide = c.slide_index ?? 0;
          if (pinSlide !== activeSlideIdx) return false;
        }
        return true;
      })
    : [];
}

export default function CommentPanel({
  comments,
  activeRelPath,
  activeSlideIdx,
  focusedId,
  autoFocusId = null,
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
  /** A comment just created from the canvas opens its editor so the pin does not persist empty. */
  autoFocusId?: string | null;
  onFocus: (id: string | null) => void;
  onUpdateBody: (id: string, body: string) => void;
  onToggleResolved: (id: string, resolved: boolean) => void;
  onRequestEdit?: (comment: Comment, body: string) => Promise<void>;
  editDisabled?: boolean;
}) {
  const t = useT();
  const [showResolved, setShowResolved] = useState(false);
  const visible = visibleComments(comments, activeRelPath, activeSlideIdx, showResolved);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-3 py-2">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("workspace.comments.heading")}
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground [word-break:keep-all]">
          {t("workspace.comments.help")}
        </p>
        <label className="mt-2 flex min-h-9 items-center gap-2 text-[11px] text-muted-foreground">
          <input type="checkbox" data-qa="comments-show-resolved" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} className="h-4 w-4 accent-accent" />
          {t("workspace.comments.showResolved")}
        </label>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {visible.length === 0 && (
          <p className="px-1 pt-2 text-xs text-muted-foreground">
            {activeRelPath
              ? activeSlideIdx != null
                ? t("workspace.comments.emptySlide")
                : t("workspace.comments.emptyFile")
              : t("workspace.comments.openFile")}
          </p>
        )}

        {visible.map((comment, idx) => (
          <CommentItem
            key={comment.id}
            index={idx + 1}
            comment={comment}
            focused={comment.id === focusedId}
            autoFocus={comment.id === autoFocusId}
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

export function CommentItem({
  comment,
  index,
  focused,
  onFocus,
  onUpdateBody,
  onToggleResolved,
  onRequestEdit,
  editDisabled,
  autoFocus = false,
}: {
  comment: Comment;
  index: number;
  focused: boolean;
  onFocus: () => void;
  onUpdateBody: (body: string) => void;
  onToggleResolved: () => void;
  onRequestEdit?: (body: string) => Promise<void>;
  editDisabled?: boolean;
  autoFocus?: boolean;
}) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const [draft, setDraft] = useState(comment.body);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);
  const pendingDraft = useRef({ body: comment.body, dirty: false });
  const updateBodyRef = useRef(onUpdateBody);
  updateBodyRef.current = onUpdateBody;
  useEffect(() => () => {
    // A quick popup can unmount on refresh/file changes without a native blur.
    if (autoFocus && pendingDraft.current.dirty) updateBodyRef.current(pendingDraft.current.body);
  }, [autoFocus]);
  const editingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<MessageKey | null>(null);
  const resolved = comment.resolved_at !== null;

  useEffect(() => {
    setDraft((current) =>
      nextCommentDraft(current, comment.body, editingRef.current),
    );
  }, [comment.body]);

  const commitIfDirty = () => {
    if (draft !== comment.body) onUpdateBody(draft);
    pendingDraft.current.dirty = false;
  };

  return (
    <div
      data-qa="comment-item"
      data-comment-id={comment.id}
      className={cn(
        "rounded-md border text-xs bg-background",
        focused ? "border-accent" : "border-border",
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
              : "bg-accent text-accent-foreground",
          )}
        >
          {index}
        </span>
        <span className="flex-1 truncate font-mono text-[10px] text-muted-foreground">
          {comment.node_selector || "body"}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {t(resolved ? "workspace.comments.resolved" : "workspace.comments.open")}
        </span>
      </button>

      <div className="p-2">
        <textarea
          ref={textareaRef}
          autoFocus={autoFocus}
          value={draft}
          onChange={(e) => {
            pendingDraft.current = { body: e.target.value, dirty: true };
            setDraft(e.target.value);
          }}
          onFocus={() => {
            editingRef.current = true;
          }}
          onBlur={() => {
            commitIfDirty();
            editingRef.current = false;
          }}
          placeholder={t("workspace.comments.placeholder")}
          rows={2}
          className="w-full resize-none rounded border border-border bg-background p-1.5 text-xs"
        />
        {onRequestEdit && <button type="button" className="mt-1 rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
          disabled={editDisabled || sending || !draft.trim()}
          title={editDisabled ? t("workspace.project.busyTurn") : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={async () => {
            setSending(true); setSendStatus(null);
            try { await onRequestEdit(draft); setSendStatus("workspace.comments.editSent"); }
            catch { setSendStatus("workspace.comments.editSendError"); }
            finally { setSending(false); }
          }}>{t(sending ? "workspace.comments.sending" : "workspace.comments.saveAndEdit")}</button>}
        {draft !== comment.body && <p className="text-[10px] text-muted-foreground">{t("workspace.comments.saveBeforeRequest")}</p>}
        {sendStatus && <p role="status" className="mt-1 text-[10px] text-muted-foreground">{t(sendStatus)}</p>}
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {new Date(comment.created_at).toLocaleString(localeTag(locale))}
          </span>
          <button
            type="button"
            onClick={onToggleResolved}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            {t(resolved ? "workspace.comments.reopen" : "workspace.comments.resolve")}
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
