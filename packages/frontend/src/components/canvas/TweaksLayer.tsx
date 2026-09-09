import { canvasPoint } from "./canvas-coordinates";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
  type PointerEvent,
} from "react";
import {
  requestFrameBgAtPoint,
  requestFrameRectForBgId,
  type FrameRect,
} from "./frame-bridge";
import { useFrameElementRect } from "@/hooks/useFrameElementRect";
import { targetDimensions, dimensionPatch, rotationPatch, isAspectLocked } from "@/lib/element-geometry";

export const TWEAKS_STYLE_KEYS = [
  "width", "height", "rotate", "aspect-ratio", "box-sizing", "display",
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
  geometry?: { width: number; height: number };
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
  target,
  saving,
  onApply,
}: {
  active: boolean;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  selectedBgId: string | null;
  onSelect: (target: TweaksTarget | null) => void;
  target: TweaksTarget | null;
  saving: boolean;
  onApply: (patch: Partial<Record<TweaksStyleKey, string | null>>) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const requestSeqRef = useRef(0);
  const [hoverRect, setHoverRect] = useState<FrameRect | null>(null);
  const [preview, setPreview] = useState<FrameRect | null>(null);
  const drag = useRef<{ bgId: string; x: number; y: number; rect: FrameRect; kind: string; patch: Partial<Record<TweaksStyleKey, string | null>> } | null>(null);
  useEffect(() => {
    drag.current = null;
    setPreview(null);
  }, [active, saving, selectedBgId]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !drag.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      drag.current = null;
      setPreview(null);
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, []);
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
    if (!active || saving || drag.current || !overlayRef.current) {
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
    if (!active || saving || !overlayRef.current) return;
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
        geometry: hit.geometry,
      });
    });
  };

  const start = (event: PointerEvent<HTMLButtonElement>, kind: string) => {
    if (saving || !target || !selectedRect || !overlayRef.current) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const [x, y] = canvasPoint(overlayRef.current, event.clientX, event.clientY);
    drag.current = { bgId: target.bg_id, x, y, rect: selectionBox(selectedRect), kind, patch: {} };
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || !target || !overlayRef.current) return;
    const [x, y] = canvasPoint(overlayRef.current, event.clientX, event.clientY);
    const dimensions = targetDimensions(target);
    if (current.kind === "rotate") {
      const cx = current.rect.left + current.rect.width / 2, cy = current.rect.top + current.rect.height / 2;
      const angle = dimensions.rotation + (Math.atan2(y - cy, x - cx) - Math.atan2(current.y - cy, current.x - cx)) * 180 / Math.PI;
      current.patch = rotationPatch(angle);
      setPreview({ ...current.rect });
    } else {
      const radians = (current.rect.rotation ?? dimensions.rotation) * Math.PI / 180;
      const dx = ((x - current.x) * Math.cos(radians) + (y - current.y) * Math.sin(radians)) / (current.rect.scaleX || 1);
      const dy = (-(x - current.x) * Math.sin(radians) + (y - current.y) * Math.cos(radians)) / (current.rect.scaleY || 1);
      const width = Math.max(1, dimensions.width + (current.kind.includes("e") ? dx : 0));
      const height = Math.max(1, dimensions.height + (current.kind.includes("s") ? dy : 0));
      current.patch = dimensionPatch(target, width, height, isAspectLocked(target));
      setPreview({ ...current.rect, width: Number.parseFloat(String(current.patch.width)) * (current.rect.scaleX || 1), height: Number.parseFloat(String(current.patch.height)) * (current.rect.scaleY || 1) });
    }
  };
  const finish = (event: PointerEvent<HTMLButtonElement>, commit: boolean) => {
    event.stopPropagation();
    const current = drag.current; drag.current = null; setPreview(null);
    if (commit && active && !saving && current && current.bgId === target?.bg_id && Object.keys(current.patch).length) onApply(current.patch);
  };
  const box = preview ?? (selectedRect ? selectionBox(selectedRect) : null);

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
      {active && box && (
        <div
          className="absolute pointer-events-none border-2 border-emerald-500 bg-emerald-500/15"
          style={{
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            rotate: `${(box.rotation ?? 0) + (drag.current?.kind === "rotate" && target ? Number.parseFloat(String(drag.current.patch.rotate ?? targetDimensions(target).rotation)) - targetDimensions(target).rotation : 0)}deg`,
          }}
        >
          {([['e', '가로 크기 조절', '100%', '50%'], ['s', '세로 크기 조절', '50%', '100%'], ['se', '가로 세로 크기 조절', '100%', '100%'], ['rotate', '회전 조절', '50%', '-24px']] as const).map(([kind, label, left, top]) => (
            <button key={kind} aria-label={label} disabled={saving} className="absolute h-3 w-3 border border-emerald-700 bg-white pointer-events-auto disabled:opacity-50" style={{ left, top, borderRadius: kind === 'rotate' ? '50%' : 0, transform: 'translate(-50%, -50%)', touchAction: 'none', cursor: kind === 'rotate' ? 'grab' : `${kind}-resize` }} onPointerDown={(event) => start(event, kind)} onPointerMove={move} onPointerUp={(event) => finish(event, true)} onPointerCancel={(event) => finish(event, false)} onClick={(event) => event.stopPropagation()} />
          ))}
        </div>
      )}
    </div>
  );
}

function selectionBox(rect: FrameRect): FrameRect {
  const width = rect.boxWidth ?? rect.width, height = rect.boxHeight ?? rect.height;
  return { ...rect, left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
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
