import { canvasPoint } from "./canvas-coordinates";
import {
  useEffect,
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

export const TWEAKS_STYLE_KEYS = [
  "font-family",
  "font-size",
  "font-weight",
  "color",
  "line-height",
  "letter-spacing",
  "background-color",
  "padding",
  "margin",
  "border-radius",
] as const;

export type TweaksStyleKey = (typeof TWEAKS_STYLE_KEYS)[number];

export interface TweaksTarget {
  bg_id: string;
  tag: string;
  computed: Partial<Record<TweaksStyleKey, string>>;
  inline: Partial<Record<TweaksStyleKey, string>>;
}

export default function TweaksLayer({
  active,
  iframeRef,
  selectedBgId,
  onSelect,
}: {
  active: boolean;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  selectedBgId: string | null;
  onSelect: (target: TweaksTarget | null) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const requestSeqRef = useRef(0);
  const [hoverRect, setHoverRect] = useState<FrameRect | null>(null);
  // Shared 200 ms poll loop (audit fix #11). Hovering is still local
  // because it uses different request shape (point-based, not id-based).
  const selectedRect = useFrameElementRect(
    iframeRef,
    selectedBgId,
    requestFrameRectForBgId,
  );

  useEffect(() => {
    if (!active) {
      setHoverRect(null);
    }
  }, [active]);

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

      const computed: Partial<Record<TweaksStyleKey, string>> = {};
      const inline: Partial<Record<TweaksStyleKey, string>> = {};
      for (const key of TWEAKS_STYLE_KEYS) {
        if (hit.computed[key]) computed[key] = hit.computed[key];
        if (hit.inline[key]) inline[key] = hit.inline[key];
      }

      onSelect({
        bg_id: hit.bgId,
        tag: hit.tag ?? "div",
        computed,
        inline,
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
      {active && hoverRect && (
        <div
          className="absolute pointer-events-none border-2 border-emerald-500/70 bg-emerald-500/10"
          style={{
            left: hoverRect.left,
            top: hoverRect.top,
            width: hoverRect.width,
            height: hoverRect.height,
          }}
        />
      )}
      {active && selectedRect && (
        <div
          className="absolute pointer-events-none border-2 border-emerald-500 bg-emerald-500/15"
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
