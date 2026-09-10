import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  requestFrameCountSelector,
  requestFrameRevealSelector,
  type FrameRect,
} from "./frame-bridge";
import {
  frameSelector,
  isNineBySixteen,
  safeZoneBands,
} from "@/lib/frame-navigation";

const ARTBOARD = "[data-graphic-artboard]";
const BUTTON_CLASS =
  "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Frame-aware navigation for graphic projects (doc/14 T41). The overlay is
 * drawn outside the iframe so exported artboards never carry editor chrome.
 */
export default function GraphicFrameNavigator({
  iframeRef,
  requestKey,
  onFrameChange,
}: {
  readonly iframeRef: RefObject<HTMLIFrameElement | null>;
  /** Changes when a new document finished loading, so counts are re-read. */
  readonly requestKey: string | null;
  readonly onFrameChange?: (index: number) => void;
}) {
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<FrameRect | null>(null);
  const changeRef = useRef(onFrameChange);
  changeRef.current = onFrameChange;

  useEffect(() => {
    let cancelled = false;
    void requestFrameCountSelector(iframeRef.current, ARTBOARD).then((found) => {
      if (cancelled) return;
      setCount(found);
      setIndex((current) => (current < found ? current : Math.max(found - 1, 0)));
    });
    return () => { cancelled = true; };
  }, [iframeRef, requestKey]);

  useEffect(() => {
    if (count === 0) {
      setRect(null);
      return;
    }
    let cancelled = false;
    void requestFrameRevealSelector(iframeRef.current, frameSelector(index)).then((found) => {
      if (cancelled) return;
      setRect(found);
      changeRef.current?.(index);
    });
    return () => { cancelled = true; };
  }, [count, iframeRef, index, requestKey]);

  if (count <= 1 && rect === null) return null;

  const bands = rect !== null && isNineBySixteen(rect.width, rect.height)
    ? safeZoneBands({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
    : [];

  return (
    <>
      {bands.map((band, at) => (
        <div
          key={at}
          aria-hidden="true"
          className="pointer-events-none absolute border-y border-dashed border-warning/70 bg-warning/10"
          style={{ top: band.top, left: band.left, width: band.width, height: band.height }}
        />
      ))}
      {bands.length > 0 && (
        <p className="pointer-events-none absolute left-2 top-2 rounded bg-background/80 px-2 py-1 text-[10px] text-muted-foreground">
          9:16 안전 영역 밖(위·아래 250px)에는 중요한 글자를 두지 마세요.
        </p>
      )}
      <div
        role="group"
        aria-label="프레임 이동"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") { event.preventDefault(); setIndex((value) => Math.max(value - 1, 0)); }
          if (event.key === "ArrowRight") { event.preventDefault(); setIndex((value) => Math.min(value + 1, count - 1)); }
        }}
        className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-background/95 px-2 py-1 shadow-sm"
      >
        <button
          type="button"
          className={BUTTON_CLASS}
          aria-label="이전 프레임"
          disabled={index <= 0}
          onClick={() => setIndex((value) => Math.max(value - 1, 0))}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <span aria-live="polite" className="min-w-16 text-center text-[11px] tabular-nums text-foreground">
          프레임 {index + 1} / {count}
        </span>
        <button
          type="button"
          className={BUTTON_CLASS}
          aria-label="다음 프레임"
          disabled={index >= count - 1}
          onClick={() => setIndex((value) => Math.min(value + 1, count - 1))}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </>
  );
}
