/**
 * One move gesture on the canvas, free of React and the DOM: it starts when the pointer goes down on the selected
 * element, previews while the pointer moves and yields at most one save when the pointer is released.
 */
import { collectCandidates, resolveSnap, snapThreshold, type SnapCandidates, type SnapGuide, type SnapRect, type SnapSources } from "./snap-engine";

/** A press that travels less than this on screen is a click, so a nested element can still be selected. */
export const MOVE_DRAG_THRESHOLD_SCREEN_PX = 3;

export interface MoveGestureStart<Identity> {
  /** The element's bounding box in iframe client pixels when the pointer went down. */
  rect: SnapRect;
  rotation: number;
  /** Client pixels per CSS pixel of the element, from scaled ancestors such as a fitted slide. */
  scaleX: number;
  scaleY: number;
  /** The element's saved offset. */
  offset: { x: number; y: number };
  zoom: number;
  /** Read once, at the start: what the element may lock to. */
  sources: Promise<SnapSources | null>;
  /** Read once, at the start: the file identity this gesture saves against, so a change during the drag is refused. */
  identity: Promise<Identity>;
}

export interface MovePreview {
  /** The bounding box as previewed, in iframe client pixels. */
  rect: SnapRect;
  /** How far the box moved from where the gesture started, in iframe client pixels. */
  delta: { x: number; y: number };
  /** The offset a release would save. */
  offset: { x: number; y: number };
  guides: SnapGuide[];
}

export interface MoveCommit<Identity> { offset: { x: number; y: number }; identity: Promise<Identity> }

export interface MoveGesture<Identity> {
  /** True once the pointer has travelled past the click threshold. */
  readonly dragging: boolean;
  /** Feed the pointer's distance from where it went down, in iframe client pixels. Null while it is still a click. */
  update(pointer: { dx: number; dy: number; magnet: boolean; paused: boolean }): MovePreview | null;
  /** Ends the gesture. Null when nothing is to be saved: a click, a cancelled drag or a drag back to the start. */
  release(): MoveCommit<Identity> | null;
  cancel(): void;
}

const round = (value: number) => Math.round(value * 100) / 100 || 0;

export function beginMoveGesture<Identity>(start: MoveGestureStart<Identity>): MoveGesture<Identity> {
  let candidates: SnapCandidates | null = null;
  let dragging = false;
  let ended = false;
  let last: MovePreview | null = null;
  // A drag may finish before or without these answers: the magnet then simply does not lock, and a failed identity
  // read surfaces when the save awaits it.
  start.sources.then((sources) => { if (sources) candidates = collectCandidates(sources); }, () => undefined);
  start.identity.catch(() => undefined);

  return {
    get dragging() { return dragging; },
    update({ dx, dy, magnet, paused }) {
      if (ended) return null;
      if (!dragging) {
        if (Math.hypot(dx, dy) * start.zoom < MOVE_DRAG_THRESHOLD_SCREEN_PX) return null;
        dragging = true;
      }
      let x = dx, y = dy;
      let guides: SnapGuide[] = [];
      if (magnet && !paused && candidates) {
        const moving = { ...start.rect, left: start.rect.left + dx, top: start.rect.top + dy };
        const snap = resolveSnap({ moving, kind: "move", candidates, thresholdPx: snapThreshold(start.zoom), rotation: start.rotation });
        x += snap.dx; y += snap.dy; guides = snap.guides;
      }
      last = {
        rect: { ...start.rect, left: start.rect.left + x, top: start.rect.top + y },
        delta: { x, y },
        offset: { x: round(start.offset.x + x / (start.scaleX || 1)), y: round(start.offset.y + y / (start.scaleY || 1)) },
        guides,
      };
      return last;
    },
    release() {
      if (ended) return null;
      ended = true;
      if (!last || (last.offset.x === round(start.offset.x) && last.offset.y === round(start.offset.y))) return null;
      return { offset: last.offset, identity: start.identity };
    },
    cancel() { ended = true; },
  };
}
