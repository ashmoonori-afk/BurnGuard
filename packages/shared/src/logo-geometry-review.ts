import { LOGO_GEOMETRY_ARTBOARD_ID, LOGO_GEOMETRY_GRID, type LogoGeometryV1 } from "./logo-geometry";
import {
  logoGeometryBoundaries,
  logoGeometryInside,
  type LogoGeometryBoundary,
  type LogoGeometryCompiled,
  type LogoGeometryVec,
} from "./logo-geometry-compile";

/**
 * Measured self-review of a compiled geometric mark (doc/27). These checks run before any model
 * looks at the render, so the flaws they find are facts, not opinions:
 *
 * - `sliver`: an outline edge shorter than LOGO_GEOMETRY_SLIVER_LENGTH (from the compiler).
 * - `near_touch`: two outline boundaries that miss each other by more than 0 and at most
 *   LOGO_GEOMETRY_NEAR_TOUCH units. They read as touching at small sizes but do not touch.
 * - `duplicate_guide`: two guide positions that differ by less than LOGO_GEOMETRY_NEAR_TOUCH, so
 *   the construction shows two lines where one was meant.
 * - `closed_counter`: a hole in the mark that fills in when it is rasterised at 16 or 32 px.
 */
export const LOGO_GEOMETRY_NEAR_TOUCH = 0.5;
/** Raster sizes a counter must survive. */
export const LOGO_GEOMETRY_REVIEW_SIZES = [16, 32] as const;
/** Cells per side of the reference raster the counters are found on; a multiple of every review size. */
export const LOGO_GEOMETRY_REVIEW_RASTER = 256;
/** A pixel reads as background when at most this share of it is ink. */
const OPEN_COVERAGE = 0.5;
/** Two numbers closer than this are the same position (tangency, a shared edge). */
const COINCIDENT = 1e-9;

export type LogoGeometryReviewSize = (typeof LOGO_GEOMETRY_REVIEW_SIZES)[number];

export type LogoGeometryFinding =
  | { readonly kind: "sliver"; readonly on: readonly string[]; readonly at: LogoGeometryVec; readonly length: number }
  | { readonly kind: "near_touch"; readonly on: readonly [string, string]; readonly gap: number }
  | { readonly kind: "duplicate_guide"; readonly axis: "x" | "y"; readonly values: readonly [number, number] }
  | { readonly kind: "closed_counter"; readonly size: LogoGeometryReviewSize; readonly at: LogoGeometryVec };

export interface LogoGeometryReview {
  readonly passed: boolean;
  readonly findings: readonly LogoGeometryFinding[];
}

type Vec = LogoGeometryVec;

const round = (value: number): number => Math.round(value * 1000) / 1000;
const roundVec = (p: Vec): Vec => ({ x: round(p.x), y: round(p.y) });
const dist = (p: Vec, q: Vec): number => Math.hypot(p.x - q.x, p.y - q.y);
const cross = (o: Vec, a: Vec, b: Vec): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function pointSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function segmentsMeet(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > COINCIDENT && d2 < -COINCIDENT) || (d1 < -COINCIDENT && d2 > COINCIDENT))
    && ((d3 > COINCIDENT && d4 < -COINCIDENT) || (d3 < -COINCIDENT && d4 > COINCIDENT))) return true;
  // Touching or collinear overlap: some endpoint lies on the other segment.
  return pointSegment(a, c, d) < COINCIDENT || pointSegment(b, c, d) < COINCIDENT
    || pointSegment(c, a, b) < COINCIDENT || pointSegment(d, a, b) < COINCIDENT;
}

/** How far two boundaries miss each other; 0 when they cross or touch. */
function gapBetween(p: LogoGeometryBoundary, q: LogoGeometryBoundary): number {
  if (p.kind === "circle" && q.kind === "circle") {
    const d = dist(p.c, q.c);
    if (d >= Math.abs(p.r - q.r) - COINCIDENT && d <= p.r + q.r + COINCIDENT) return 0;
    return d > p.r + q.r ? d - (p.r + q.r) : Math.abs(p.r - q.r) - d;
  }
  if (p.kind === "segment" && q.kind === "segment") {
    if (segmentsMeet(p.a, p.b, q.a, q.b)) return 0;
    return Math.min(pointSegment(p.a, q.a, q.b), pointSegment(p.b, q.a, q.b), pointSegment(q.a, p.a, p.b), pointSegment(q.b, p.a, p.b));
  }
  const circle = p.kind === "circle" ? p : q as Extract<LogoGeometryBoundary, { kind: "circle" }>;
  const segment = p.kind === "segment" ? p : q as Extract<LogoGeometryBoundary, { kind: "segment" }>;
  const near = pointSegment(circle.c, segment.a, segment.b);
  const far = Math.max(dist(circle.c, segment.a), dist(circle.c, segment.b));
  if (near <= circle.r + COINCIDENT && far >= circle.r - COINCIDENT) return 0;
  return near > circle.r ? near - circle.r : circle.r - far;
}

function nearTouches(geometry: LogoGeometryV1, compiled: LogoGeometryCompiled): LogoGeometryFinding[] {
  // Only boundaries the outline actually runs along can show a near miss.
  const outline = new Set(compiled.loops.flatMap((loop) => loop.flatMap((edge) => edge.on)));
  outline.delete(LOGO_GEOMETRY_ARTBOARD_ID);
  const boundaries = logoGeometryBoundaries(geometry).filter((boundary) => boundary.owners.some((owner) => outline.has(owner)));
  const closest = new Map<string, { on: [string, string]; gap: number }>();
  for (let i = 0; i < boundaries.length; i += 1) {
    for (let j = i + 1; j < boundaries.length; j += 1) {
      const a = boundaries[i].owners[0];
      const b = boundaries[j].owners[0];
      if (a === b) continue;
      const gap = gapBetween(boundaries[i], boundaries[j]);
      if (gap <= COINCIDENT || gap > LOGO_GEOMETRY_NEAR_TOUCH) continue;
      const on: [string, string] = a < b ? [a, b] : [b, a];
      const key = on.join("\u0000");
      const seen = closest.get(key);
      if (seen === undefined || gap < seen.gap) closest.set(key, { on, gap });
    }
  }
  return [...closest.values()]
    .sort((x, y) => x.on[0].localeCompare(y.on[0], "en") || x.on[1].localeCompare(y.on[1], "en"))
    .map(({ on, gap }) => ({ kind: "near_touch", on, gap: round(gap) }));
}

function duplicateGuides(compiled: LogoGeometryCompiled): LogoGeometryFinding[] {
  const findings: LogoGeometryFinding[] = [];
  for (const axis of ["x", "y"] as const) {
    const values = compiled.guides[axis];
    for (let i = 1; i < values.length; i += 1) {
      if (values[i] - values[i - 1] < LOGO_GEOMETRY_NEAR_TOUCH) findings.push({ kind: "duplicate_guide", axis, values: [values[i - 1], values[i]] });
    }
  }
  return findings;
}

/**
 * Finds the holes of the mark on a reference raster (background cells not connected to the
 * artboard border), then checks each one still shows at least one background pixel at every
 * review size. Coverage is the ink share of the reference cells under each pixel.
 */
function closedCounters(geometry: LogoGeometryV1): LogoGeometryFinding[] {
  const n = LOGO_GEOMETRY_REVIEW_RASTER;
  const unit = LOGO_GEOMETRY_GRID / n;
  const inside = logoGeometryInside(geometry);
  const ink = new Uint8Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) ink[y * n + x] = inside({ x: (x + 0.5) * unit, y: (y + 0.5) * unit }) ? 1 : 0;
  }
  // 0 = unvisited background, -1 = ink or open background, -2 = enclosed background.
  const label = new Int32Array(n * n);
  const fill = (start: number, value: number): number[] => {
    const cells = [start];
    label[start] = value;
    for (let k = 0; k < cells.length; k += 1) {
      const cell = cells[k];
      const x = cell % n;
      const y = (cell - x) / n;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const next = ny * n + nx;
        if (ink[next] === 0 && label[next] === 0) {
          label[next] = value;
          cells.push(next);
        }
      }
    }
    return cells;
  };
  for (let i = 0; i < n * n; i += 1) if (ink[i] === 1) label[i] = -1;
  for (let i = 0; i < n; i += 1) {
    for (const cell of [i, (n - 1) * n + i, i * n, i * n + n - 1]) if (label[cell] === 0) fill(cell, -1);
  }
  // A real counter has room inside it. Pockets the raster pinches off along a hairline gap lie
  // within one cell of a boundary everywhere; the gap itself is a near_touch finding.
  const boundaries = logoGeometryBoundaries(geometry).filter((boundary) => !boundary.owners.includes(LOGO_GEOMETRY_ARTBOARD_ID));
  const depth = (cell: number): number => {
    const x = cell % n;
    const p = { x: (x + 0.5) * unit, y: ((cell - x) / n + 0.5) * unit };
    return Math.min(...boundaries.map((boundary) => boundary.kind === "circle" ? Math.abs(dist(p, boundary.c) - boundary.r) : pointSegment(p, boundary.a, boundary.b)));
  };
  const holes: number[][] = [];
  for (let i = 0; i < n * n; i += 1) {
    if (label[i] !== 0) continue;
    const cells = fill(i, -2);
    if (cells.some((cell) => depth(cell) > unit)) holes.push(cells);
  }

  const findings: LogoGeometryFinding[] = [];
  for (const size of LOGO_GEOMETRY_REVIEW_SIZES) {
    const block = n / size;
    const coverage = new Float64Array(size * size);
    for (let i = 0; i < n * n; i += 1) {
      const x = i % n;
      const y = (i - x) / n;
      coverage[Math.floor(y / block) * size + Math.floor(x / block)] += ink[i];
    }
    for (const cells of holes) {
      const open = cells.some((cell) => {
        const x = cell % n;
        const y = (cell - x) / n;
        return coverage[Math.floor(y / block) * size + Math.floor(x / block)] / (block * block) <= OPEN_COVERAGE;
      });
      if (open) continue;
      const sum = cells.reduce((total, cell) => {
        const x = cell % n;
        return { x: total.x + x, y: total.y + (cell - x) / n };
      }, { x: 0, y: 0 });
      findings.push({ kind: "closed_counter", size, at: roundVec({ x: (sum.x / cells.length + 0.5) * unit, y: (sum.y / cells.length + 0.5) * unit }) });
    }
  }
  return findings;
}

/** Runs every measured check. The result is deterministic for a given record. */
export function reviewLogoGeometry(geometry: LogoGeometryV1, compiled: LogoGeometryCompiled): LogoGeometryReview {
  const findings: LogoGeometryFinding[] = [
    ...compiled.slivers.map((sliver): LogoGeometryFinding => ({
      kind: "sliver",
      on: sliver.on,
      at: roundVec({ x: (sliver.from.x + sliver.to.x) / 2, y: (sliver.from.y + sliver.to.y) / 2 }),
      length: round(sliver.length),
    })),
    ...nearTouches(geometry, compiled),
    ...duplicateGuides(compiled),
    ...closedCounters(geometry),
  ];
  return { passed: findings.length === 0, findings };
}
