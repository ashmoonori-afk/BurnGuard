import {
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import {
  requestFrameBgAtPoint,
  requestFrameRectForBgId,
  type FrameRect,
} from "./frame-bridge";
import { useFrameElementRect } from "@/hooks/useFrameElementRect";

export interface EditTarget {
  bg_id: string;
  tag: string;
  text: string;
  attributes: Record<string, string>;
}

export default function EditLayer({
  active,
  iframeRef,
  selectedBgId,
  requestKey,
  onSelect,
}: {
  active: boolean;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  selectedBgId: string | null;
  requestKey: string | null;
  onSelect: (target: EditTarget | null) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const requestSeqRef = useRef(0);
  const [hoverRect, setHoverRect] = useState<FrameRect | null>(null);
  // Single shared 200 ms poll loop via useFrameElementRect (audit
  // fix #11 — was a duplicated useEffect across SelectorOverlay,
  // EditLayer, TweaksLayer).
  const selectedRect = useFrameElementRect(
    iframeRef,
    selectedBgId,
    requestFrameRectForBgId,
    requestKey,
  );

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!active || !overlayRef.current) {
      setHoverRect(null);
      return;
    }
    const overlayRect = overlayRef.current.getBoundingClientRect();
    const relX = e.clientX - overlayRect.left;
    const relY = e.clientY - overlayRect.top;
    const seq = ++requestSeqRef.current;
    void requestFrameBgAtPoint(iframeRef.current, relX, relY).then((hit) => {
      if (requestSeqRef.current !== seq) return;
      setHoverRect((prev) =>
        rectEqual(prev, hit?.rect ?? null) ? prev : (hit?.rect ?? null),
      );
    });
  };

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!active || !overlayRef.current) return;
    if (e.target !== overlayRef.current) return;

    const overlayRect = overlayRef.current.getBoundingClientRect();
    const relX = e.clientX - overlayRect.left;
    const relY = e.clientY - overlayRect.top;
    void requestFrameBgAtPoint(iframeRef.current, relX, relY).then((hit) => {
      if (!hit?.bgId) {
        onSelect(null);
        return;
      }
      onSelect({
        bg_id: hit.bgId,
        tag: hit.tag ?? "div",
        text: hit.text ?? "",
        attributes: hit.attributes,
      });
    });
  };

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0"
      style={{
        pointerEvents: active ? "auto" : "none",
        cursor: active ? "crosshair" : "default",
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverRect(null)}
      onClick={handleClick}
    >
      {hoverRect && (
        <div
          className="absolute pointer-events-none border-2 border-accent/80 bg-accent/10"
          style={{
            left: hoverRect.left,
            top: hoverRect.top,
            width: hoverRect.width,
            height: hoverRect.height,
          }}
        />
      )}
      {selectedRect && (
        <div
          className="absolute pointer-events-none border-2 border-accent bg-accent/10"
          style={{
            left: selectedRect.left,
            top: selectedRect.top,
            width: selectedRect.width,
            height: selectedRect.height,
          }}
        />
      )}
    </div>
  );
}

function rectEqual(a: FrameRect | null, b: FrameRect | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  );
}
