import { canvasPoint } from "./canvas-coordinates";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";
import type { Comment } from "@bg/shared";
import { readFrameCommentPositions, requestFrameCommentAtPoint, subscribeFrameEvent, watchFrameComments, type FrameCommentPosition } from "./frame-bridge";
import { cn } from "@/lib/utils";
import type { CommentPinInput, CommentPoint } from "./quick-comment";

export default function CommentLayer({
  active,
  comments,
  activeRelPath,
  activeSlideIdx,
  iframeRef,
  focusedId,
  onCreate,
  onFocus,
  onOpen,
  documentKey,
}: {
  active: boolean;
  comments: Comment[];
  activeRelPath: string | null;
  activeSlideIdx: number | null;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  focusedId: string | null;
  onCreate: (input: CommentPinInput) => void;
  onFocus: (id: string | null) => void;
  onOpen: (comment: Comment, point: CommentPoint) => void;
  documentKey: string | null;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<FrameCommentPosition[]>([]);

  const visible = useMemo(() => activeRelPath
    ? comments.filter((c) => {
        if (c.rel_path !== activeRelPath) return false;
        if (c.resolved_at !== null) return false;
        if (activeSlideIdx != null) {
          const pinSlide = c.slide_index ?? 0;
          if (pinSlide !== activeSlideIdx) return false;
        }
        return true;
      })
    : [], [activeRelPath, activeSlideIdx, comments]);

  useEffect(() => {
    setPositions([]);
    const frame = iframeRef.current;
    if (!frame || !documentKey) return;
    let mounted = true;
    const receive = (payload: unknown) => {
      const next = readFrameCommentPositions(payload, documentKey);
      if (mounted && next) setPositions(next);
    };
    const unsubscribe = subscribeFrameEvent(frame, "comment-positions", receive);
    void watchFrameComments(frame, visible).then(receive).catch(() => {});
    return () => {
      mounted = false;
      unsubscribe();
      void watchFrameComments(frame, []).catch(() => {});
    };
  }, [documentKey, iframeRef, visible]);

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!active || !overlayRef.current) return;
    if (e.target !== overlayRef.current) return;

    const [relX, relY] = canvasPoint(overlayRef.current, e.clientX, e.clientY);
    void requestFrameCommentAtPoint(iframeRef.current, relX, relY).then(
      (hit) => {
        if (!hit) return;
        onCreate({
          x_pct: hit.x_pct,
          y_pct: hit.y_pct,
          anchor: hit.anchor,
          node_selector: hit.selector,
          slide_index: hit.slideIndex,
        });
      },
    ).catch(() => {});
  };

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 overflow-hidden"
      style={{
        pointerEvents: active ? "auto" : "none",
        cursor: active ? "crosshair" : "default",
      }}
      onClick={handleClick}
    >
      {visible.map((comment, idx) => {
        const position = positions.find(p => p.id === comment.id);
        return position?.visible && (
        <CommentPin
          key={comment.id}
          index={idx + 1}
          comment={comment}
          position={position}
          focused={comment.id === focusedId}
          onSelect={(point) => { onFocus(comment.id); onOpen(comment, point); }}
        />
      ); })}
    </div>
  );
}

function CommentPin({
  comment,
  index,
  focused,
  onSelect,
  position,
}: {
  comment: Comment;
  index: number;
  focused: boolean;
  onSelect: (point: CommentPoint) => void;
  position: FrameCommentPosition;
}) {
  return (
    <button
      type="button"
      data-comment-id={comment.id}
      onClick={(e) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        onSelect({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }}
      title={comment.body || "(no note)"}
      className={cn(
        "absolute -translate-x-1/2 -translate-y-1/2 h-6 w-6 rounded-full text-[10px] font-semibold border shadow-md flex items-center justify-center transition",
        "bg-accent text-accent-foreground border-white",
        focused && "ring-2 ring-accent/30 scale-110",
      )}
      style={{
        left: position.x,
        top: position.y,
        pointerEvents: "auto",
      }}
    >
      {index}
    </button>
  );
}
