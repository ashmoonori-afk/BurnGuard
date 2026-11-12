import { useT } from "@/i18n/t";
import { canvasPoint } from "./canvas-coordinates";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type Ref,
  type RefObject,
  type PointerEvent,
} from "react";
import {
  frameHitLayout,
  requestFrameBgAtPoint,
  requestFrameRectForBgId,
  requestFrameSnapRects,
  type FrameBgHit,
  type FrameHitLayout,
  type FrameRect,
  type FrameSnapRects,
} from "./frame-bridge";
import { useFrameElementRect } from "@/hooks/useFrameElementRect";
import { alignOffset, nudgeTravel, targetDimensions, targetOffset, translatePatch, dimensionPatch, rotationPatch, isAspectLocked, type AlignMode } from "@/lib/element-geometry";
import type { FileArtifactIdentity } from "@/lib/artifact-identity";
import { arrowStep, beginMoveGesture, type MoveGesture } from "@/lib/move-gesture";
import { primaryGuides, snapGuideChip, snapGuideStatus } from "@/lib/snap-guides";
import { heldGuides, snapResize, snapRotate, type ResizeHandle } from "@/lib/resize-gesture";
import { collectCandidates, type SnapCandidates, type SnapGuide, type SnapRect } from "@/lib/snap-engine";
import { useUIStore } from "@/state/uiStore";
import SnapGuides from "./SnapGuides";

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
  "translate", "position",
  "grid-template-columns", "grid-auto-rows", "gap", "grid-column", "grid-row",
  "min-width", "object-fit", "object-position",
] as const;

export type TweaksStyleKey = (typeof TWEAKS_STYLE_KEYS)[number];

export interface TweaksTarget {
  geometry?: { width: number; height: number };
  bg_id: string;
  tag: string;
  /** Inside a deck slide the text-size floor is the audit's 24px instead of 12px. */
  inSlide?: boolean;
  computed: Partial<Record<TweaksStyleKey, string>>;
  inline: Partial<Record<TweaksStyleKey, string>>;
  /** Element children of the selected node; a node with children can become a layout container. */
  childCount?: number;
  /** Other element children of its parent. */
  siblingCount?: number;
  /** The parent element and how it lays out its children; null for the page's root elements. */
  parent?: FrameHitLayout["parent"];
}

type TweaksPatch = Partial<Record<TweaksStyleKey, string | null>>;

/** Taps on an arrow key join one burst, and one save, while they follow each other within this pause. */
const NUDGE_IDLE_MS = 400;
/** A selection narrower or shorter than this keeps its resize handles outside the box. */
const SMALL_BOX_PX = 40;
/** One pointer gesture on the selection. `names` and `candidates` fill in when the snap rects asked at its start arrive. */
interface DragState {
  bgId: string; x: number; y: number; rect: FrameRect; kind: string; patch: TweaksPatch;
  identity?: Promise<FileArtifactIdentity>;
  session: MoveGesture<FileArtifactIdentity> | null;
  names: Map<string, string>; bbox: SnapRect; candidates: SnapCandidates | null;
  /** A keyboard burst only: the arrow keys still held, and when its snap rects have arrived. */
  keys?: Set<string>;
  ready?: Promise<FrameSnapRects | null>;
}
interface ShownGuides { items: SnapGuide[]; box: SnapRect; names: ReadonlyMap<string, string>; live: boolean }
const NO_GUIDES: ShownGuides = { items: [], box: { left: 0, top: 0, width: 0, height: 0 }, names: new Map(), live: false };

/** A gesture hands over the file identity it read when it started; panel fields leave it out and read it at save time. */
export interface TweakApplyOptions { identity?: Promise<FileArtifactIdentity> }

/** What the Style panel can ask of the overlay, which is the only place that can measure the page. */
export interface TweaksLayerActions {
  /** Lines the selected element up with its parent's content box. */
  align(mode: AlignMode): void;
}

/** Builds the Style target from a bridge hit; null when the hit has no node id. */
export function tweaksTargetFromHit(hit: FrameBgHit | null): TweaksTarget | null {
  if (!hit?.bgId) return null;
  const computed: Partial<Record<TweaksStyleKey, string>> = {};
  const inline: Partial<Record<TweaksStyleKey, string>> = {};
  for (const key of TWEAKS_STYLE_KEYS) {
    if (hit.computed[key]) computed[key] = hit.computed[key];
    if (hit.inline[key]) inline[key] = hit.inline[key];
  }
  return { bg_id: hit.bgId, tag: hit.tag ?? "div", inSlide: hit.inSlide === true, computed, inline, geometry: hit.geometry, ...frameHitLayout(hit) };
}

export default function TweaksLayer({
  active,
  iframeRef,
  selectedBgId,
  onSelect,
  target,
  saving,
  onApply,
  zoom = 1,
  magnet = true,
  readIdentity,
  actionsRef,
}: {
  active: boolean;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  selectedBgId: string | null;
  onSelect: (target: TweaksTarget | null) => void;
  target: TweaksTarget | null;
  saving: boolean;
  onApply: (patch: TweaksPatch, options?: TweakApplyOptions) => void;
  /** The canvas zoom, so the magnet's reach and the guide lines keep their size on screen. */
  zoom?: number;
  magnet?: boolean;
  /** Reads the identity of a node in the open file. Without it the element cannot be moved by dragging. */
  readIdentity?: (bgId: string) => Promise<FileArtifactIdentity>;
  actionsRef?: Ref<TweaksLayerActions>;
}) {
  const t = useT();
  const overlayRef = useRef<HTMLDivElement>(null);
  const requestSeqRef = useRef(0);
  const [hoverRect, setHoverRect] = useState<FrameRect | null>(null);
  const [preview, setPreview] = useState<FrameRect | null>(null);
  const [guides, setGuides] = useState<ShownGuides>(NO_GUIDES);
  const setSnapStatus = useUIStore((state) => state.setCanvasSnapStatus);
  const setMoveOffset = useUIStore((state) => state.setCanvasMoveOffset);
  const surfaceRef = useRef<HTMLButtonElement | null>(null);
  const focusSurface = useRef(false);
  // A save reloads the canvas, which removes the selection box for a moment. If the Move surface held the keyboard
  // then, it takes it back when the box returns for the same element, so a second burst needs no new click.
  const selectedId = useRef(selectedBgId);
  selectedId.current = selectedBgId;
  const refocusFor = useRef<string | null>(null);
  const attachSurface = useCallback((element: HTMLButtonElement | null) => {
    if (element === null) {
      if (surfaceRef.current !== null && document.activeElement === surfaceRef.current) refocusFor.current = selectedId.current;
      surfaceRef.current = null;
      return;
    }
    surfaceRef.current = element;
    if (refocusFor.current !== null && refocusFor.current === selectedId.current && document.activeElement === document.body) element.focus({ preventScroll: true });
    refocusFor.current = null;
  }, []);
  const nudgeTimer = useRef<number | null>(null);
  const stopNudgeTimer = () => {
    if (nudgeTimer.current !== null) window.clearTimeout(nudgeTimer.current);
    nudgeTimer.current = null;
  };
  useEffect(() => stopNudgeTimer, []);
  // A click that selects an element hands it the keyboard, so the arrow keys nudge it at once.
  useEffect(() => {
    if (!focusSurface.current || !surfaceRef.current) return;
    focusSurface.current = false;
    surfaceRef.current.focus({ preventScroll: true });
  });
  const drag = useRef<DragState | null>(null);
  useEffect(() => {
    drag.current?.session?.cancel();
    drag.current = null;
    setPreview(null);
  }, [active, saving, selectedBgId]);
  useEffect(() => {
    setGuides(NO_GUIDES);
    setSnapStatus(null);
    setMoveOffset(null);
  }, [active, selectedBgId, setSnapStatus, setMoveOffset]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !drag.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      drag.current.session?.cancel();
      drag.current = null;
      if (nudgeTimer.current !== null) window.clearTimeout(nudgeTimer.current);
      nudgeTimer.current = null;
      setPreview(null);
      setGuides(NO_GUIDES);
      setSnapStatus(null);
      setMoveOffset(null);
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [setSnapStatus, setMoveOffset]);
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

  const selectAt = (clientX: number, clientY: number) => {
    if (!active || saving || !overlayRef.current) return;
    const [relX, relY] = canvasPoint(overlayRef.current, clientX, clientY);
    void requestFrameBgAtPoint(iframeRef.current, relX, relY).then((hit) => {
      focusSurface.current = hit?.bgId != null;
      onSelect(tweaksTargetFromHit(hit));
    });
  };

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) selectAt(e.clientX, e.clientY);
  };

  /** Every gesture saves against the identity it reads here, when it starts. */
  const gestureIdentity = (bgId: string) => {
    const identity = readIdentity?.(bgId);
    identity?.catch(() => undefined);
    return identity;
  };

  /** Draws the locks of the gesture in progress and says them in the panel: one line per direction, every other lock. */
  const showLocks = (locks: readonly SnapGuide[], box: SnapRect, names: ReadonlyMap<string, string>) => {
    const shown = primaryGuides(locks);
    setGuides({ items: shown, box, names, live: true });
    const sentences = shown.map((guide) => {
      const chip = snapGuideChip(guide, names);
      const status = snapGuideStatus(guide, t(chip.key, chip.params), names);
      return status ? t(status.key, status.params) : null;
    }).filter((sentence): sentence is string => sentence !== null);
    setSnapStatus(sentences.length ? sentences.join(" ") : null);
  };
  /** Guides fade out once their gesture ends; with reduced motion, or nothing to fade, they go at once. */
  const endLocks = () => {
    setGuides((shown) => shown.items.length === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? NO_GUIDES : { ...shown, live: false });
    // The sentence describes a lock that is being held; once the pointer is up, the save may still be refused.
    setSnapStatus(null);
    setMoveOffset(null);
  };
  /** Asks once, at the start of a gesture, what the element may lock to; the answer fills in when it arrives. */
  const loadSnapRects = (bgId: string, into: { names: Map<string, string>; candidates: SnapCandidates | null }) => {
    const sources = requestFrameSnapRects(iframeRef.current, bgId);
    void sources.then((rects) => {
      if (!rects) return;
      into.candidates = collectCandidates(rects);
      for (const sibling of rects.siblings) into.names.set(sibling.bgId, sibling.label);
    });
    return sources;
  };

  const startMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (saving || !target || !selectedRect || !overlayRef.current || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    // The press takes the keyboard too, so the arrow keys can fine-tune right after a drag.
    event.currentTarget.focus({ preventScroll: true });
    const [x, y] = canvasPoint(overlayRef.current, event.clientX, event.clientY);
    const offset = targetOffset(target);
    const identity = gestureIdentity(target.bg_id);
    const next: DragState = { bgId: target.bg_id, x, y, rect: selectionBox(selectedRect), kind: "move", patch: {}, identity, session: null, names: new Map(), bbox: selectedRect, candidates: null };
    const sources = loadSnapRects(target.bg_id, next);
    // Without a readable pixel offset or an identity the press still selects what is under the pointer, but does not move.
    if (offset && identity) next.session = beginMoveGesture({ rect: selectedRect, rotation: selectedRect.rotation ?? 0, basis: selectedRect.basis, offset, zoom, sources, identity });
    drag.current = next;
    setGuides(NO_GUIDES);
  };
  const moveMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current?.session || !overlayRef.current) return;
    const [x, y] = canvasPoint(overlayRef.current, event.clientX, event.clientY);
    const next = current.session.update({ dx: x - current.x, dy: y - current.y, magnet, paused: event.ctrlKey || event.metaKey });
    if (!next) return;
    setPreview({ ...current.rect, left: current.rect.left + next.delta.x, top: current.rect.top + next.delta.y });
    showLocks(next.guides, next.rect, current.names);
    setMoveOffset(next.offset);
  };
  const finishMove = (event: PointerEvent<HTMLButtonElement>, commit: boolean) => {
    event.stopPropagation();
    const current = drag.current; drag.current = null; setPreview(null);
    endLocks();
    if (!current) return;
    if (!commit) { current.session?.cancel(); return; }
    const result = current.session?.release() ?? null;
    if (result) {
      if (active && !saving && current.bgId === target?.bg_id) onApply(translatePatch(result.offset.x, result.offset.y), { identity: result.identity });
    } else if (!current.session?.dragging) {
      selectAt(event.clientX, event.clientY);
    }
  };

  /** Arrow keys on the Move surface: 1 px, 10 px with Shift, the next line with Alt or Option. One save per burst. */
  const nudgeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step = arrowStep(event.key, event.shiftKey);
    if (!step || event.ctrlKey || event.metaKey || saving || !target || !selectedRect) return;
    event.preventDefault(); event.stopPropagation();
    stopNudgeTimer();
    if (!drag.current) {
      const offset = targetOffset(target);
      const identity = gestureIdentity(target.bg_id);
      if (!offset || !identity) return;
      const next: DragState = { bgId: target.bg_id, x: 0, y: 0, rect: selectionBox(selectedRect), kind: "nudge", patch: {}, identity, session: null, names: new Map(), bbox: selectedRect, candidates: null, keys: new Set() };
      next.ready = loadSnapRects(target.bg_id, next);
      next.session = beginMoveGesture({ rect: selectedRect, rotation: selectedRect.rotation ?? 0, basis: selectedRect.basis, offset, zoom, clickThresholdScreenPx: 0, sources: next.ready, identity });
      drag.current = next;
      setGuides(NO_GUIDES);
    }
    const current = drag.current;
    if (current.kind !== "nudge" || !current.session) return;
    current.keys?.add(event.key);
    const travel = (dx: number, dy: number) => {
      if (drag.current !== current || !current.session) return;
      current.x += dx; current.y += dy;
      // A hair's reach: the nudge names the lines it lands on but is never pulled off its exact step.
      const next = current.session.update({ dx: current.x, dy: current.y, magnet: true, paused: false, reachPx: 0.01 });
      if (!next) return;
      setPreview({ ...current.rect, left: current.rect.left + next.delta.x, top: current.rect.top + next.delta.y });
      showLocks(next.guides, next.rect, current.names);
      setMoveOffset(next.offset);
    };
    if (event.altKey) {
      const axis = step.x !== 0 ? "x" : "y";
      const direction = step.x + step.y > 0 ? 1 : -1;
      void current.ready?.then(() => {
        const jump = current.session?.nextLine(axis, direction) ?? 0;
        if (jump !== 0) travel(axis === "x" ? jump : 0, axis === "y" ? jump : 0);
      });
    } else {
      const onScreen = nudgeTravel(current.rect.basis, step);
      travel(onScreen.x, onScreen.y);
    }
  };
  const commitNudge = () => {
    stopNudgeTimer();
    const current = drag.current;
    if (!current || current.kind !== "nudge") return;
    drag.current = null; setPreview(null);
    endLocks();
    const result = current.session?.release() ?? null;
    if (result && active && !saving && current.bgId === target?.bg_id) onApply(translatePatch(result.offset.x, result.offset.y), { identity: result.identity });
  };
  const nudgeKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.kind !== "nudge" || !current.keys) return;
    current.keys.delete(event.key);
    // Saving waits for a short pause, so five taps are one save and one undo step, like one held key.
    if (current.keys.size === 0) nudgeTimer.current = window.setTimeout(commitNudge, NUDGE_IDLE_MS);
  };

  useImperativeHandle(actionsRef, () => ({
    align(mode) {
      if (saving || !target) return;
      const offset = targetOffset(target);
      if (!offset) return;
      void requestFrameSnapRects(iframeRef.current, target.bg_id).then((rects) => {
        if (!rects?.parent) return;
        const next = alignOffset({ mode, rect: rects.self, content: rects.parent.content, offset, basis: rects.self.basis });
        // A panel button commits at once, so the identity is read at save time.
        if (next.x !== offset.x || next.y !== offset.y) onApply(translatePatch(next.x, next.y));
      });
    },
  }), [saving, target, iframeRef, onApply]);

  const start = (event: PointerEvent<HTMLButtonElement>, kind: string) => {
    if (saving || !target || !selectedRect || !overlayRef.current) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const [x, y] = canvasPoint(overlayRef.current, event.clientX, event.clientY);
    const next: DragState = { bgId: target.bg_id, x, y, rect: selectionBox(selectedRect), kind, patch: {}, identity: gestureIdentity(target.bg_id), session: null, names: new Map(), bbox: selectedRect, candidates: null };
    if (kind !== "rotate") void loadSnapRects(target.bg_id, next);
    drag.current = next;
    setGuides(NO_GUIDES);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || !target || !overlayRef.current) return;
    const [x, y] = canvasPoint(overlayRef.current, event.clientX, event.clientY);
    const dimensions = targetDimensions(target);
    const paused = event.ctrlKey || event.metaKey;
    if (current.kind === "rotate") {
      const cx = current.rect.left + current.rect.width / 2, cy = current.rect.top + current.rect.height / 2;
      const angle = dimensions.rotation + (Math.atan2(y - cy, x - cx) - Math.atan2(current.y - cy, current.x - cx)) * 180 / Math.PI;
      const lock = snapRotate({ degrees: angle, magnet, paused });
      current.patch = rotationPatch(lock.degrees);
      setPreview({ ...current.rect });
      showLocks(lock.locked ? [{ kind: "angle", value: Number.parseFloat(String(current.patch.rotate)) }] : [], current.bbox, current.names);
    } else {
      const radians = (current.rect.rotation ?? dimensions.rotation) * Math.PI / 180;
      const dx = ((x - current.x) * Math.cos(radians) + (y - current.y) * Math.sin(radians)) / (current.rect.scaleX || 1);
      const dy = (-(x - current.x) * Math.sin(radians) + (y - current.y) * Math.cos(radians)) / (current.rect.scaleY || 1);
      const scaleX = current.rect.scaleX || 1, scaleY = current.rect.scaleY || 1;
      const snapped = snapResize({
        handle: current.kind as ResizeHandle, rect: current.bbox, scaleX, scaleY, rotation: current.rect.rotation ?? dimensions.rotation,
        width: Math.max(1, dimensions.width + (current.kind.includes("e") ? dx : 0)),
        height: Math.max(1, dimensions.height + (current.kind.includes("s") ? dy : 0)),
        candidates: current.candidates, zoom, magnet, paused,
      });
      current.patch = dimensionPatch(target, snapped.width, snapped.height, isAspectLocked(target));
      const saved = { width: Number.parseFloat(String(current.patch.width)), height: Number.parseFloat(String(current.patch.height)) };
      const size = { width: saved.width * scaleX, height: saved.height * scaleY };
      setPreview({ ...current.rect, ...size });
      showLocks(heldGuides(snapped.guides, snapped, saved), { ...current.bbox, ...size }, current.names);
    }
  };
  const finish = (event: PointerEvent<HTMLButtonElement>, commit: boolean) => {
    event.stopPropagation();
    const current = drag.current; drag.current = null; setPreview(null);
    endLocks();
    if (commit && active && !saving && current && current.bgId === target?.bg_id && Object.keys(current.patch).length) onApply(current.patch, current.identity ? { identity: current.identity } : undefined);
  };
  const box = preview ?? (selectedRect ? selectionBox(selectedRect) : null);
  // On a small box the handles would cover the Move surface, so they step outside it.
  const handleX = box && box.width < SMALL_BOX_PX ? "calc(100% + 10px)" : "100%";
  const handleY = box && box.height < SMALL_BOX_PX ? "calc(100% + 10px)" : "100%";

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
          className="absolute pointer-events-none border-2 border-accent/70 bg-accent/10"
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
          className="absolute pointer-events-none border-2 border-accent bg-accent/15"
          style={{
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            rotate: `${(box.rotation ?? 0) + (drag.current?.kind === "rotate" && target ? Number.parseFloat(String(drag.current.patch.rotate ?? targetDimensions(target).rotation)) - targetDimensions(target).rotation : 0)}deg`,
          }}
        >
          <button ref={attachSurface} type="button" aria-label={t("canvas.handles.move")} data-canvas-move="" aria-disabled={saving} onKeyDown={nudgeKeyDown} onKeyUp={nudgeKeyUp} onBlur={commitNudge} className="absolute inset-0 pointer-events-auto bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ touchAction: "none", cursor: saving ? "default" : "move" }} onPointerDown={startMove} onPointerMove={moveMove} onPointerUp={(event) => finishMove(event, true)} onPointerCancel={(event) => finishMove(event, false)} onClick={(event) => event.stopPropagation()} />
          {([['e', t("canvas.handles.width"), handleX, '50%'], ['s', t("canvas.handles.height"), '50%', handleY], ['se', t("canvas.handles.size"), handleX, handleY], ['rotate', t("canvas.handles.rotation"), '50%', '-24px']] as const).map(([kind, label, left, top]) => (
            <button key={kind} aria-label={label} disabled={saving} className="absolute h-3 w-3 border border-accent bg-card pointer-events-auto disabled:opacity-50" style={{ left, top, borderRadius: kind === 'rotate' ? '50%' : 0, transform: 'translate(-50%, -50%)', touchAction: 'none', cursor: kind === 'rotate' ? 'grab' : `${kind}-resize` }} onPointerDown={(event) => start(event, kind)} onPointerMove={move} onPointerUp={(event) => finish(event, true)} onPointerCancel={(event) => finish(event, false)} onClick={(event) => event.stopPropagation()} />
          ))}
        </div>
      )}
      {active && <SnapGuides guides={guides.items} box={guides.box} names={guides.names} zoom={zoom} live={guides.live} onFaded={() => setGuides((shown) => shown.live ? shown : NO_GUIDES)} />}
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
