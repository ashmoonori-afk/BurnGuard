import { canvasPoint } from "./canvas-coordinates";
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
  onSelect,
}: {
  active: boolean;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  selectedBgId: string | null;
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
  );

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!active || !overlayRef.current) {
      setHoverRect(null);
      return;
    }
    const [relX, relY] = canvasPoint(overlayRef.current, e.clientX, e.clientY);
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

    const [relX, relY] = canvasPoint(overlayRef.current, e.clientX, e.clientY);
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
          className="absolute pointer-events-none border-2 border-blue-500/80 bg-blue-500/10"
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
          className="absolute pointer-events-none border-2 border-orange-500 bg-orange-500/10"
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
