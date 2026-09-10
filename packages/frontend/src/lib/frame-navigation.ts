/**
 * Frame-aware canvas helpers (doc/14 T41). A graphic project renders every
 * frame as a `[data-graphic-artboard]` element inside the artifact iframe; the
 * navigator and the safe-zone overlay live outside the iframe and address
 * frames by position, so authored markup keeps its own ids and class names.
 */

const ARTBOARD = "[data-graphic-artboard]";

export function stepFrameIndex(index: number, count: number, delta: number): number {
  if (count <= 0) return 0;
  const next = index + delta;
  return Math.min(Math.max(next, 0), count - 1);
}

export function frameSelector(index: number): string {
  return `${ARTBOARD}:nth-child(${index + 1} of ${ARTBOARD})`;
}

/** Keeps element targeting inside one frame: the same node id can repeat per frame. */
export function frameScopedSelector(index: number, selector: string): string {
  return `${frameSelector(index)} ${selector}`;
}

/** Story placements reserve 250px top and bottom of a 1080×1920 frame. */
export const FRAME_SAFE_ZONE = {
  frameHeight: 1920,
  top: 250,
  bottom: 250,
} as const;

const NINE_BY_SIXTEEN = 9 / 16;

export function isNineBySixteen(width: number, height: number, tolerance = 0.01): boolean {
  if (width <= 0 || height <= 0) return false;
  return Math.abs(width / height - NINE_BY_SIXTEEN) <= tolerance;
}

export type OverlayRect = {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
};

/** The two bands a story frame must keep clear, in the rendered rect's own pixels. */
export function safeZoneBands(rect: OverlayRect): readonly OverlayRect[] {
  if (rect.width <= 0 || rect.height <= 0) return [];
  const top = (rect.height * FRAME_SAFE_ZONE.top) / FRAME_SAFE_ZONE.frameHeight;
  const bottom = (rect.height * FRAME_SAFE_ZONE.bottom) / FRAME_SAFE_ZONE.frameHeight;
  return [
    { top: rect.top, left: rect.left, width: rect.width, height: top },
    { top: rect.top + rect.height - bottom, left: rect.left, width: rect.width, height: bottom },
  ];
}
