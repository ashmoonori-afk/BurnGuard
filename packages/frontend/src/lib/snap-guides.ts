/** Words for magnet guides: the short chip on a guide line and the sentence the Style panel reads out. */
import type { MessageKey } from "@/i18n/t";
import type { SnapGuide } from "./snap-engine";

export interface SnapLabel { key: MessageKey; params?: Record<string, string | number> }

const PART_KEYS = {
  x: { start: "canvas.snap.left", center: "canvas.snap.center", end: "canvas.snap.right" },
  y: { start: "canvas.snap.top", center: "canvas.snap.middle", end: "canvas.snap.bottom" },
} as const satisfies Record<"x" | "y", Record<"start" | "center" | "end", MessageKey>>;

const pixels = (value: number) => Math.round(value * 10) / 10;

/** The chip drawn on the guide: which edge it is, which grid track, how many pixels, whose size, or which angle. */
export function snapGuideChip(guide: SnapGuide, names: ReadonlyMap<string, string> = new Map()): SnapLabel {
  if (guide.kind === "angle") return { key: "canvas.snap.degrees", params: { value: guide.value } };
  if (guide.kind === "size") {
    const name = names.get(guide.bgId);
    if (guide.axis === "x") return name ? { key: "canvas.snap.sameWidth", params: { name } } : { key: "canvas.snap.sameWidthNeighbor" };
    return name ? { key: "canvas.snap.sameHeight", params: { name } } : { key: "canvas.snap.sameHeightNeighbor" };
  }
  if (guide.kind !== "line") return { key: "canvas.snap.px", params: { value: pixels(guide.value) } };
  if (guide.source === "grid") return { key: guide.axis === "x" ? "canvas.snap.column" : "canvas.snap.row", params: { n: guide.track ?? 1 } };
  return { key: PART_KEYS[guide.axis][guide.part] };
}

/**
 * The same lock as a sentence, so it is never signalled by colour alone. `chip` is the already translated chip text;
 * `names` maps a sibling's node id to its short label.
 */
export function snapGuideStatus(guide: SnapGuide, chip: string, names: ReadonlyMap<string, string>): SnapLabel | null {
  if (guide.kind === "gap") return { key: "canvas.snap.equalGap", params: { value: pixels(guide.value) } };
  if (guide.kind === "angle") return { key: "canvas.snap.rotationLocked", params: { value: guide.value } };
  if (guide.kind === "size") {
    const matched = names.get(guide.bgId);
    const value = pixels(guide.value);
    if (guide.axis === "x") return matched ? { key: "canvas.snap.widthMatches", params: { name: matched, value } } : { key: "canvas.snap.widthMatchesNeighbor", params: { value } };
    return matched ? { key: "canvas.snap.heightMatches", params: { name: matched, value } } : { key: "canvas.snap.heightMatchesNeighbor", params: { value } };
  }
  if (guide.source === "grid") return { key: "canvas.snap.alignedGrid", params: { line: chip } };
  if (guide.source === "artboard") return { key: "canvas.snap.alignedArtboard", params: { part: chip } };
  if (guide.source === "parent") return { key: "canvas.snap.alignedParent", params: { part: chip } };
  const name = guide.bgId === undefined ? undefined : names.get(guide.bgId);
  return name ? { key: "canvas.snap.alignedSibling", params: { part: chip, name } } : { key: "canvas.snap.alignedNeighbor", params: { part: chip } };
}

/**
 * What the overlay shows of a lock: per direction the one line that decided it, plus any equal-spacing or same-size
 * lock. Other lines that happen to coincide (a neighbour's top and bottom while moving along its row) would only
 * crowd the canvas.
 */
export function primaryGuides(guides: readonly SnapGuide[]): SnapGuide[] {
  const seen = new Set<string>();
  return guides.filter((guide) => {
    if (guide.kind !== "line") return true;
    if (seen.has(guide.axis)) return false;
    seen.add(guide.axis);
    return true;
  });
}
