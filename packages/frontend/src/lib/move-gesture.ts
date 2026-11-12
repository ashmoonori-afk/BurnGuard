/**
 * One move gesture on the canvas, free of React and the DOM: it starts when the pointer goes down on the selected
 * element, previews while the pointer moves and yields at most one save when the pointer is released.
 */
import { collectCandidates, nextSnapDelta, resolveSnap, snapThreshold, type SnapAxis, type SnapCandidates, type SnapGuide, type SnapRect, type SnapSources } from "./snap-engine";

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
  /** How far the pointer must travel before the press becomes a drag. A keyboard burst passes 0: every key press moves. */
  clickThresholdScreenPx?: number;
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
  /**
   * Feed the distance from where the gesture started, in iframe client pixels. Null while it is still a click.
   * `reachPx` replaces the magnet's reach: a keyboard nudge passes a hair's width, so it names the lines it lands on
   * without being pulled to them.
   */
  update(pointer: { dx: number; dy: number; magnet: boolean; paused: boolean; reachPx?: number }): MovePreview | null;
  /** How far the previewed box is from the next line along `axis` in `direction`; 0 when none lies ahead or the snap rects have not arrived. */
  nextLine(axis: SnapAxis, direction: 1 | -1): number;
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
    update({ dx, dy, magnet, paused, reachPx }) {
      if (ended) return null;
      if (!dragging) {
        if (Math.hypot(dx, dy) * start.zoom < (start.clickThresholdScreenPx ?? MOVE_DRAG_THRESHOLD_SCREEN_PX)) return null;
        dragging = true;
      }
      let x = dx, y = dy;
      let guides: SnapGuide[] = [];
      if (magnet && !paused && candidates) {
        const moving = { ...start.rect, left: start.rect.left + dx, top: start.rect.top + dy };
        const snap = resolveSnap({ moving, kind: "move", candidates, thresholdPx: reachPx ?? snapThreshold(start.zoom), rotation: start.rotation });
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
    nextLine(axis, direction) {
      if (!candidates) return 0;
      return nextSnapDelta({ moving: last?.rect ?? start.rect, candidates, axis, direction, rotation: start.rotation });
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

/** One arrow key press: 1 CSS pixel, or 10 with Shift. Null for any other key. */
export function arrowStep(key: string, large: boolean): { x: number; y: number } | null {
  const step = large ? 10 : 1;
  switch (key) {
    case "ArrowLeft": return { x: -step, y: 0 };
    case "ArrowRight": return { x: step, y: 0 };
    case "ArrowUp": return { x: 0, y: -step };
    case "ArrowDown": return { x: 0, y: step };
    default: return null;
  }
}
