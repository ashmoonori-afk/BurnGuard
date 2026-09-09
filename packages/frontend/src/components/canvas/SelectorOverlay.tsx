import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import {
  requestFrameRectForSelector,
  requestFrameSelectAtPoint,
  type FrameRect,
} from "./frame-bridge";
import type { SelectedNode } from "@/types/project";
import { useFrameElementRect } from "@/hooks/useFrameElementRect";

export default function SelectorOverlay({
  active,
  iframeRef,
  activeRelPath,
  onSelect,
}: {
  active: boolean;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  activeRelPath: string | null;
  onSelect: (selection: SelectedNode | null) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const requestSeqRef = useRef(0);
  const [hoverRect, setHoverRect] = useState<FrameRect | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Selected-rect tracking is the same shared 200 ms loop the other
  // canvas overlays use (audit fix #11). The hook fires immediately
  // on identifier change so the first poll lands in < 1 frame, well
  // before the user notices the previous selection box vanish.
  const selectedRect = useFrameElementRect(
    iframeRef,
    selectedKey,
    requestFrameRectForSelector,
  );

  useEffect(() => {
    if (!active) {
      setHoverRect(null);
      setSelectedKey(null);
    }
  }, [active]);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!active || !overlayRef.current) {
      setHoverRect(null);
      return;
    }
    const rect = overlayRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const seq = ++requestSeqRef.current;
    void requestFrameSelectAtPoint(iframeRef.current, relX, relY).then((hit) => {
      if (requestSeqRef.current !== seq) return;
      setHoverRect((prev) =>
        rectEqual(prev, hit?.rect ?? null) ? prev : (hit?.rect ?? null),
      );
    });
  };

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!active || !overlayRef.current) return;
    if (e.target !== overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    void requestFrameSelectAtPoint(iframeRef.current, relX, relY).then((hit) => {
      if (!hit?.selector || !hit.rect) {
        setSelectedKey(null);
        onSelect(null);
        return;
      }
      // Bumping selectedKey triggers useFrameElementRect to fetch the
      // canonical rect from the iframe; we drop the local override.
      setSelectedKey(hit.selector);
      onSelect({
        nodeId: hit.selector,
        bgId: hit.bgId,
        tag: hit.tag,
        rect: {
          x: hit.rect.left,
          y: hit.rect.top,
          w: hit.rect.width,
          h: hit.rect.height,
        },
        computed: hit.computed,
        inline: hit.inline,
        file: activeRelPath ?? "",
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
          className="absolute pointer-events-none border-2 border-accent/80 bg-accent/10"
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
