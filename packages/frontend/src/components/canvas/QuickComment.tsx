import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { Comment } from "@bg/shared";
import { requestFrameCommentAtPoint, subscribeFrameEvent } from "./frame-bridge";
import { commentPointInFrame, frameCommentPointer, isCommentEditable, isQuickCommentShortcut, quickCommentPosition, type CommentPinInput, type CommentPoint } from "./quick-comment";
import { useT } from "@/i18n/t";

interface QuickCommentRequest {
  point: CommentPoint;
  comment: Comment | null;
  error: boolean;
}

/** Mounted only for a loaded, writable frame and keyed by its document/file identity. */
export default function QuickComment({ iframeRef, containerRef, documentKey, comments, onCreate, renderComment }: {
  iframeRef: RefObject<HTMLIFrameElement>;
  containerRef: RefObject<HTMLDivElement>;
  documentKey: string;
  comments: Comment[];
  onCreate: (input: CommentPinInput) => Promise<Comment>;
  renderComment: (comment: Comment, close: () => void) => ReactNode;
}) {
  const t = useT();
  const [popup, setPopup] = useState<QuickCommentRequest | null>(null);
  const requestRef = useRef<QuickCommentRequest | null>(null);
  const pointerRef = useRef<CommentPoint | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const createRef = useRef(onCreate);
  createRef.current = onCreate;
  const [position, setPosition] = useState({ left: 12, top: 12 });

  const close = useCallback(() => {
    // React does not dispatch blur when a focused node is removed.
    const active = document.activeElement;
    if (active instanceof HTMLElement && popupRef.current?.contains(active)) active.blur();
    requestRef.current = null;
    setPopup(null);
  }, []);

  useEffect(() => {
    const frame = iframeRef.current;
    const container = containerRef.current;
    if (!frame || !container) return;
    let mounted = true;
    const open = (point: CommentPoint) => {
      const local = commentPointInFrame(frame, point);
      const underPointer = document.elementFromPoint(point.x, point.y);
      if (!local || !underPointer || !container.contains(underPointer)) return;
      if (requestRef.current) {
        (popupRef.current?.querySelector("textarea") ?? popupRef.current)?.focus();
        return;
      }
      const request: QuickCommentRequest = { point, comment: null, error: false };
      requestRef.current = request;
      setPosition(quickCommentPosition(point, { width: Math.min(320, window.innerWidth - 24), height: 100 }, { width: window.innerWidth, height: window.innerHeight }));
      setPopup({ ...request });
      const isCurrent = () => mounted && requestRef.current === request && iframeRef.current === frame;
      const x_pct = local.x / frame.clientWidth * 100;
      const y_pct = local.y / frame.clientHeight * 100;
      void (async () => {
        try {
          const hit = await requestFrameCommentAtPoint(frame, local.x, local.y);
          if (!isCurrent()) return;
          if (!hit) throw new Error("comment_hit_unavailable");
          const comment = await createRef.current({ x_pct, y_pct, node_selector: hit.selector, slide_index: hit.slideIndex });
          if (!isCurrent()) return;
          request.comment = comment;
          setPopup({ ...request });
        } catch {
          if (!isCurrent()) return;
          request.error = true;
          setPopup({ ...request });
        }
      })();
    };
    const pointer = (event: PointerEvent) => {
      pointerRef.current = container.contains(event.target as Node) && commentPointInFrame(frame, { x: event.clientX, y: event.clientY })
        ? { x: event.clientX, y: event.clientY } : null;
    };
    const leave = (event: PointerEvent) => { if (!event.relatedTarget) pointerRef.current = null; };
    const key = (event: KeyboardEvent) => {
      const editable = isCommentEditable(event.target as HTMLElement | null);
      if (event.key === "Escape" && !event.isComposing && !event.repeat && requestRef.current &&
        (!editable || popupRef.current?.contains(event.target as Node))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (!pointerRef.current || !isQuickCommentShortcut(event, editable)) return;
      if (!commentPointInFrame(frame, pointerRef.current)) return;
      event.preventDefault();
      open(pointerRef.current);
    };
    const unsubscribePointer = subscribeFrameEvent(frame, "comment-pointer", payload => {
      if (payload?.documentKey !== documentKey) return;
      pointerRef.current = frameCommentPointer(payload, documentKey, frame);
    });
    const unsubscribeShortcut = subscribeFrameEvent(frame, "comment-shortcut", payload => {
      const point = frameCommentPointer(payload, documentKey, frame);
      if (point) open(point);
    });
    const unsubscribeDismiss = subscribeFrameEvent(frame, "comment-dismiss", payload => {
      if (payload?.documentKey === documentKey && requestRef.current) close();
    });
    window.addEventListener("pointermove", pointer, true);
    window.addEventListener("pointerout", leave, true);
    window.addEventListener("keydown", key, true);
    return () => {
      mounted = false;
      requestRef.current = null;
      window.removeEventListener("pointermove", pointer, true);
      window.removeEventListener("pointerout", leave, true);
      window.removeEventListener("keydown", key, true);
      unsubscribePointer();
      unsubscribeShortcut();
      unsubscribeDismiss();
    };
  }, [close, containerRef, documentKey, iframeRef]);

  useLayoutEffect(() => {
    const element = popupRef.current;
    if (!popup || !element) return;
    const place = () => setPosition(quickCommentPosition(popup.point, element.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }));
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener("resize", place);
    if (!popup.comment) element.focus();
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [popup]);

  if (!popup) return null;
  const comment = popup.comment && (comments.find(entry => entry.id === popup.comment?.id) ?? popup.comment);
  return createPortal(
    <div ref={popupRef} role="dialog" aria-label={t("workspace.quickComment.dialog")} aria-busy={!comment && !popup.error} tabIndex={-1}
      data-testid="quick-comment-popup"
      className="fixed z-50 w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border border-border bg-background p-3 shadow-lg focus:outline-none"
      style={{ ...position, maxHeight: "calc(100dvh - 24px)" }}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-medium">{t("workspace.quickComment.heading")}</span>
        <button type="button" aria-label={t("workspace.quickComment.close")} onClick={close} className="flex h-8 w-8 items-center justify-center rounded hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      {comment ? renderComment(comment, close) : popup.error ? <p role="alert" className="text-xs text-muted-foreground">{t("workspace.quickComment.createError")}</p> : <p role="status" className="text-xs text-muted-foreground">{t("workspace.quickComment.preparing")}</p>}
    </div>, document.body,
  );
}
