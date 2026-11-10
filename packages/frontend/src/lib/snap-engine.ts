/**
 * Magnet geometry for the canvas: decides which line a moving or resizing box locks to and what the overlay
 * should draw. Every number is in the iframe's client pixels; nothing here touches the DOM.
 */

export const SNAP_THRESHOLD_SCREEN_PX = 6;

/** The magnet grabs within 6 screen pixels at every zoom, so the canvas-space threshold shrinks as the zoom grows. */
export function snapThreshold(zoom: number): number {
  return SNAP_THRESHOLD_SCREEN_PX / (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
}

export interface SnapRect { left: number; top: number; width: number; height: number }
export interface SnapSibling { bgId: string; rect: SnapRect }
/** A grid line has thickness when the grid has a gap: `start` ends the track before it, `end` starts the next one. */
export interface SnapGridLine { start: number; end: number }

export interface SnapSources {
  parent: { content: SnapRect; columnLines: readonly SnapGridLine[]; rowLines: readonly SnapGridLine[] } | null;
  artboard: SnapRect | null;
  siblings: readonly SnapSibling[];
}

export type SnapAxis = "x" | "y";
export type SnapPart = "start" | "center" | "end";
export type SnapSource = "grid" | "artboard" | "parent" | "sibling";
export type SnapKind = "move" | "resize-e" | "resize-s" | "resize-se";

export interface SnapLine {
  axis: SnapAxis;
  position: number;
  source: SnapSource;
  /** Which part of the source this line is: its start edge, centre or end edge along `axis`. */
  part: SnapPart;
  /** Extent of the source on the other axis, so the guide can span both boxes. */
  from: number;
  to: number;
  bgId?: string;
  /** 1-based grid track number when `source` is `grid`. */
  track?: number;
}

export interface SnapCandidates { lines: SnapLine[]; siblings: readonly SnapSibling[] }

export type SnapGuide =
  | (SnapLine & { kind: "line" })
  | { kind: "size"; axis: SnapAxis; value: number; bgId: string }
  | { kind: "gap"; axis: SnapAxis; value: number; cross: number; segments: [{ from: number; to: number }, { from: number; to: number }] }
  | { kind: "angle"; value: number };

export interface SnapResult {
  /** Correction to add to the box: a translation for `move`, a change of width or height for a resize. */
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

const AXES: readonly SnapAxis[] = ["x", "y"];
const TIE = 1e-6;
/** How close two lines must be to count as the same line once the box has locked. */
const COINCIDENT = 0.01;

function span(rect: SnapRect, axis: SnapAxis): [number, number] {
  return axis === "x" ? [rect.left, rect.left + rect.width] : [rect.top, rect.top + rect.height];
}

const crossAxis = (axis: SnapAxis): SnapAxis => (axis === "x" ? "y" : "x");

/** Every line the selected element may lock to, in the order that settles ties between equally near lines. */
export function collectCandidates(sources: SnapSources): SnapCandidates {
  const lines: SnapLine[] = [];
  const box = (rect: SnapRect, source: SnapSource, bgId?: string) => {
    for (const axis of AXES) {
      const [start, end] = span(rect, axis);
      const [from, to] = span(rect, crossAxis(axis));
      for (const [part, position] of [["start", start], ["center", (start + end) / 2], ["end", end]] as const) {
        lines.push({ axis, position, source, part, from, to, ...(bgId === undefined ? {} : { bgId }) });
      }
    }
  };
  if (sources.parent) {
    const { content, columnLines, rowLines } = sources.parent;
    const grid = (axis: SnapAxis, gridLines: readonly SnapGridLine[]) => {
      const [from, to] = span(content, crossAxis(axis));
      gridLines.forEach((line, index) => {
        if (index < gridLines.length - 1) lines.push({ axis, position: line.end, source: "grid", part: "start", from, to, track: index + 1 });
        if (index > 0 && (index === gridLines.length - 1 || line.start !== line.end)) lines.push({ axis, position: line.start, source: "grid", part: "end", from, to, track: index });
      });
    };
    grid("x", columnLines);
    grid("y", rowLines);
  }
  if (sources.artboard) box(sources.artboard, "artboard");
  if (sources.parent) box(sources.parent.content, "parent");
  for (const sibling of sources.siblings) box(sibling.rect, "sibling", sibling.bgId);
  return { lines, siblings: sources.siblings };
}

/** Tie order: grid line, artboard centre, artboard edge, parent centre, parent edge, sibling edge, sibling centre. */
function lineRank(line: SnapLine): number {
  if (line.source === "grid") return 0;
  if (line.source === "artboard") return line.part === "center" ? 1 : 2;
  if (line.source === "parent") return line.part === "center" ? 3 : 4;
  return line.part === "center" ? 6 : 5;
}
const SIZE_RANK = 7;
const GAP_RANK = 8;

interface Option { delta: number; rank: number; guide: SnapGuide }

function nearest(options: readonly Option[], threshold: number): Option | null {
  let best: Option | null = null;
  for (const option of options) {
    const distance = Math.abs(option.delta);
    if (distance > threshold) continue;
    if (best === null || distance < Math.abs(best.delta) - TIE || (Math.abs(distance - Math.abs(best.delta)) <= TIE && option.rank < best.rank)) best = option;
  }
  return best;
}

function overlaps(a: SnapRect, b: SnapRect, axis: SnapAxis): boolean {
  const [aStart, aEnd] = span(a, axis);
  const [bStart, bEnd] = span(b, axis);
  return aStart < bEnd && bStart < aEnd;
}

/** Equal spacing: the gap to the nearest neighbour may lock to a gap that already exists between two other neighbours. */
function gapOptions(axis: SnapAxis, moving: SnapRect, siblings: readonly SnapSibling[]): Option[] {
  const cross = crossAxis(axis);
  const row = siblings.map((sibling) => sibling.rect).filter((rect) => overlaps(rect, moving, cross)).sort((a, b) => span(a, axis)[0] - span(b, axis)[0]);
  const [start, end] = span(moving, axis);
  const centre = (start + end) / 2;
  const centreOf = (rect: SnapRect) => (span(rect, axis)[0] + span(rect, axis)[1]) / 2;
  const before = row.filter((rect) => centreOf(rect) < centre).at(-1);
  const after = row.find((rect) => centreOf(rect) >= centre);
  const [crossStart, crossEnd] = span(moving, cross);
  const options: Option[] = [];
  for (let index = 0; index + 1 < row.length; index += 1) {
    const first = row[index]!, second = row[index + 1]!;
    const existing = { from: span(first, axis)[1], to: span(second, axis)[0] };
    const value = existing.to - existing.from;
    if (value <= 0) continue;
    const guide = (from: number, to: number): SnapGuide => ({ kind: "gap", axis, value, cross: (crossStart + crossEnd) / 2, segments: [existing, { from, to }] });
    if (before) {
      const edge = span(before, axis)[1];
      options.push({ delta: edge + value - start, rank: GAP_RANK, guide: guide(edge, edge + value) });
    }
    if (after) {
      const edge = span(after, axis)[0];
      options.push({ delta: edge - value - end, rank: GAP_RANK, guide: guide(edge - value, edge) });
    }
  }
  return options;
}

function resolveAxis(axis: SnapAxis, input: { moving: SnapRect; kind: SnapKind; candidates: SnapCandidates; thresholdPx: number; rotation: number }): { delta: number; guides: SnapGuide[] } {
  const { moving, kind, candidates, thresholdPx } = input;
  const turn = ((input.rotation % 360) + 360) % 360;
  const quarterTurn = Math.abs(turn % 90) < COINCIDENT || Math.abs((turn % 90) - 90) < COINCIDENT;
  const upright = turn < COINCIDENT || 360 - turn < COINCIDENT;
  const [start, end] = span(moving, axis);
  const centre = (start + end) / 2;
  const resizing = kind !== "move";
  const resizesAxis = kind === "resize-se" || (axis === "x" ? kind === "resize-e" : kind === "resize-s");
  // A rotated box grows on both sides of its centre, so its moving edge is not one screen edge: only an upright box locks while resizing.
  if (resizing && (!resizesAxis || !upright)) return { delta: 0, guides: [] };
  const points: number[] = resizing ? [end] : quarterTurn ? [start, centre, end] : [centre];

  const options: Option[] = [];
  for (const line of candidates.lines) {
    if (line.axis !== axis) continue;
    for (const point of points) options.push({ delta: line.position - point, rank: lineRank(line), guide: { ...line, kind: "line" } });
  }
  if (resizing) {
    for (const sibling of candidates.siblings) {
      const size = axis === "x" ? sibling.rect.width : sibling.rect.height;
      options.push({ delta: size - (end - start), rank: SIZE_RANK, guide: { kind: "size", axis, value: size, bgId: sibling.bgId } });
    }
  } else if (quarterTurn) {
    options.push(...gapOptions(axis, moving, candidates.siblings));
  }

  const best = nearest(options, thresholdPx);
  if (best === null) return { delta: 0, guides: [] };
  // Everything else that also lines up once the box has locked is drawn too, one guide per line.
  const [crossStart, crossEnd] = span(moving, crossAxis(axis));
  const seen = new Set<string>();
  const guides: SnapGuide[] = [];
  for (const option of [best, ...options.filter((other) => other !== best && Math.abs(other.delta - best.delta) <= COINCIDENT).sort((a, b) => a.rank - b.rank)]) {
    const guide = option.guide;
    const key = guide.kind === "line" ? `line:${guide.position.toFixed(2)}` : guide.kind;
    if (seen.has(key)) continue;
    seen.add(key);
    guides.push(guide.kind === "line" ? { ...guide, from: Math.min(guide.from, crossStart), to: Math.max(guide.to, crossEnd) } : guide);
  }
  return { delta: best.delta, guides };
}

/**
 * Locks `moving` (the box as the pointer alone would place it) to the nearest candidate within `thresholdPx` on each
 * axis. A box whose rotation is not a multiple of 90 degrees locks by its centre only.
 */
export function resolveSnap(input: { moving: SnapRect; kind: SnapKind; candidates: SnapCandidates; thresholdPx: number; rotation: number }): SnapResult {
  const x = resolveAxis("x", input);
  const y = resolveAxis("y", input);
  return { dx: x.delta, dy: y.delta, guides: [...x.guides, ...y.guides] };
}

export const ROTATION_SNAP_STEP_DEG = 15;
export const ROTATION_SNAP_REACH_DEG = 3;

/** A rotation within 3 degrees of a multiple of 15 locks to it. */
export function snapRotation(degrees: number): { degrees: number; locked: boolean } {
  const nearest = Math.round(degrees / ROTATION_SNAP_STEP_DEG) * ROTATION_SNAP_STEP_DEG;
  return Math.abs(degrees - nearest) <= ROTATION_SNAP_REACH_DEG ? { degrees: nearest, locked: true } : { degrees, locked: false };
}
