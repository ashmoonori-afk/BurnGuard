/** The magnet for the resize handles: the moving edge of an upright box locks to nearby lines and to a sibling's size. */
import { resolveSnap, snapRotation, snapThreshold, type SnapCandidates, type SnapGuide, type SnapRect } from "./snap-engine";

export type ResizeHandle = "e" | "s" | "se";

export function snapResize(input: {
  handle: ResizeHandle;
  /** The element's bounding box in iframe client pixels when the gesture started; its top-left corner stays put. */
  rect: SnapRect;
  /** The size the pointer alone asks for, in the element's own CSS pixels. */
  width: number;
  height: number;
  /** Client pixels per CSS pixel of the element, from scaled ancestors such as a fitted slide. */
  scaleX: number;
  scaleY: number;
  rotation: number;
  /** Null until the snap rects have arrived; the handle then resizes freely. */
  candidates: SnapCandidates | null;
  zoom: number;
  magnet: boolean;
  paused: boolean;
}): { width: number; height: number; guides: SnapGuide[] } {
  const { width, height, candidates } = input;
  if (!input.magnet || input.paused || !candidates) return { width, height, guides: [] };
  const scaleX = input.scaleX || 1, scaleY = input.scaleY || 1;
  const moving = { left: input.rect.left, top: input.rect.top, width: width * scaleX, height: height * scaleY };
  const snap = resolveSnap({ moving, kind: `resize-${input.handle}`, candidates, thresholdPx: snapThreshold(input.zoom), rotation: input.rotation });
  return { width: width + snap.dx / scaleX, height: height + snap.dy / scaleY, guides: snap.guides };
}

/**
 * The locks that still hold for the size that is saved. An aspect-locked box keeps one side and derives the other, so
 * a lock on the derived side is no longer true and must not be drawn or read out.
 */
export function heldGuides(guides: SnapGuide[], snapped: { width: number; height: number }, saved: { width: number; height: number }): SnapGuide[] {
  const held = { x: Math.abs(saved.width - snapped.width) < 0.01, y: Math.abs(saved.height - snapped.height) < 0.01 };
  return guides.filter((guide) => guide.kind === "angle" || held[guide.axis]);
}

/** The rotate handle locks to 15-degree steps unless the magnet is off or paused. */
export function snapRotate(input: { degrees: number; magnet: boolean; paused: boolean }): { degrees: number; locked: boolean } {
  return input.magnet && !input.paused ? snapRotation(input.degrees) : { degrees: input.degrees, locked: false };
}
