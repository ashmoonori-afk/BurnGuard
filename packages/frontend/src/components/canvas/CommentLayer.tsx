import { useRef, type MouseEvent, type RefObject } from "react";
import type { Comment } from "@bg/shared";
import { requestFrameCommentAtPoint } from "./frame-bridge";
import { cn } from "@/lib/utils";

interface PinInput {
  x_pct: number;
  y_pct: number;
  node_selector: string;
  slide_index: number | null;
}

export default function CommentLayer({
  active,
  comments,
  activeRelPath,
  activeSlideIdx,
  iframeRef,
  focusedId,
  onCreate,
  onFocus,
}: {
  active: boolean;
  comments: Comment[];
  activeRelPath: string | null;
  activeSlideIdx: number | null;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  focusedId: string | null;
  onCreate: (input: PinInput) => void;
  onFocus: (id: string | null) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

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

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!active || !overlayRef.current) return;
    if (e.target !== overlayRef.current) return;

    const rect = overlayRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const x_pct = (relX / rect.width) * 100;
    const y_pct = (relY / rect.height) * 100;

    void requestFrameCommentAtPoint(iframeRef.current, relX, relY).then(
      (hit) => {
        onCreate({
          x_pct,
          y_pct,
          node_selector: hit?.selector ?? "body",
          slide_index: hit?.slideIndex ?? null,
        });
      },
    );
  };

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0"
      style={{
        pointerEvents: active ? "auto" : "none",
        cursor: active ? "crosshair" : "default",
      }}
      onClick={handleClick}
    >
      {visible.map((comment, idx) => (
        <CommentPin
          key={comment.id}
          index={idx + 1}
          comment={comment}
          focused={comment.id === focusedId}
          onSelect={() =>
            onFocus(comment.id === focusedId ? null : comment.id)
          }
        />
      ))}
    </div>
  );
}

function CommentPin({
  comment,
  index,
  focused,
  onSelect,
}: {
  comment: Comment;
  index: number;
  focused: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      title={comment.body || "(no note)"}
      className={cn(
        "absolute -translate-x-1/2 -translate-y-1/2 h-6 w-6 rounded-full text-[10px] font-semibold border shadow-md flex items-center justify-center transition",
        "bg-accent text-accent-foreground border-white",
        focused && "ring-2 ring-accent/30 scale-110",
      )}
      style={{
        left: `${comment.x_pct}%`,
        top: `${comment.y_pct}%`,
        pointerEvents: "auto",
      }}
    >
      {index}
    </button>
  );
}
