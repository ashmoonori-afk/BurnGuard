import {
  LOGO_GEOMETRY_ARTBOARD_ID,
  LOGO_GEOMETRY_GRID,
  type LogoGeometryNode,
  type LogoGeometryPrimitive,
  type LogoGeometryV1,
} from "@bg/shared";

/**
 * The geometric-mark compiler (doc/25-logo-geometry-2026-11-09.md).
 *
 * It turns a parsed `LogoGeometryV1` into one outline made only of straight `L` and circular `A`
 * segments, so every arc in the mark has exactly the radius of a construction circle. The method is
 * an arrangement: every primitive boundary (and the artboard edge) becomes a curve, all pairwise
 * intersections are computed exactly, each curve is split at them, and an edge is kept when the
 * two sides of it differ under the boolean tree. Kept edges are oriented with the inside on the
 * same side and linked into closed loops. Nothing is sampled or flattened, and a configuration the
 * compiler cannot close is refused, never guessed.
 */

/** Edges shorter than this are reported: they render as nicks, not as shape. */
export const LOGO_GEOMETRY_SLIVER_LENGTH = 0.75;

/** Two numbers closer than this are the same coincidence (tangency, shared point, same circle). */
const COINCIDENT = 1e-9;
/** Vertices closer than this are one vertex. */
const MERGE = 1e-7;
/** How far either side of an edge midpoint the tree is sampled. */
const PROBE = 1e-5;
/** How close a vertex must be to a curve to count as lying on it. */
const ON_CURVE = 1e-6;
const TAU = Math.PI * 2;

export interface LogoGeometryVec {
  readonly x: number;
  readonly y: number;
}

export type LogoGeometryEdge =
  | { readonly kind: "line"; readonly from: LogoGeometryVec; readonly to: LogoGeometryVec; readonly on: readonly string[]; readonly length: number }
  | {
    readonly kind: "arc";
    readonly from: LogoGeometryVec;
    readonly to: LogoGeometryVec;
    readonly center: LogoGeometryVec;
    readonly r: number;
    /** Signed sweep in radians; positive turns clockwise on screen (SVG sweep-flag 1). */
    readonly sweep: number;
    readonly on: readonly string[];
    readonly length: number;
  };

export interface LogoGeometryVertex extends LogoGeometryVec {
  /** Every primitive (or `artboard`) whose boundary passes through this vertex. */
  readonly on: readonly string[];
}

export interface LogoGeometryTangency extends LogoGeometryVec {
  readonly on: readonly [string, string];
}

export interface LogoGeometrySliver {
  readonly length: number;
  readonly on: readonly string[];
  readonly from: LogoGeometryVec;
  readonly to: LogoGeometryVec;
}

export interface LogoGeometryCompiled {
  /** One SVG path, `M`/`L`/`A`/`Z` only, on the 64-unit artboard. */
  readonly path: string;
  readonly loops: readonly (readonly LogoGeometryEdge[])[];
  readonly area: number;
  readonly vertices: readonly LogoGeometryVertex[];
  readonly tangencies: readonly LogoGeometryTangency[];
  /** Guide positions: every vertex and every point where the outline runs level or upright. */
  readonly guides: { readonly x: readonly number[]; readonly y: readonly number[] };
  readonly slivers: readonly LogoGeometrySliver[];
}

export type LogoGeometryCompileErrorCode = "empty_shape" | "open_loop";

export class LogoGeometryCompileError extends Error {
  readonly name = "LogoGeometryCompileError";

  constructor(readonly code: LogoGeometryCompileErrorCode) {
    super(code);
  }
}

type Vec = LogoGeometryVec;
type Segment = { readonly kind: "segment"; readonly a: Vec; readonly b: Vec; readonly owners: string[] };
type Circle = { readonly kind: "circle"; readonly c: Vec; readonly r: number; readonly owners: string[] };
type Curve = Segment | Circle;

const sub = (p: Vec, q: Vec): Vec => ({ x: p.x - q.x, y: p.y - q.y });
const dot = (p: Vec, q: Vec): number => p.x * q.x + p.y * q.y;
const cross = (p: Vec, q: Vec): number => p.x * q.y - p.y * q.x;
const dist = (p: Vec, q: Vec): number => Math.hypot(p.x - q.x, p.y - q.y);
const angleOf = (c: Vec, p: Vec): number => {
  const angle = Math.atan2(p.y - c.y, p.x - c.x);
  return angle < 0 ? angle + TAU : angle;
};

/** Effective radius of every circle after overshoot corrections. */
function radiiOf(geometry: LogoGeometryV1): Map<string, number> {
  const values = new Map(geometry.radii.map((radius) => [radius.id, radius.value]));
  const overshoot = new Map(geometry.optical.flatMap((item) => item.kind === "overshoot" ? [[item.primitive, item.amount] as const] : []));
  const radii = new Map<string, number>();
  for (const primitive of geometry.primitives) {
    if (primitive.kind === "circle") radii.set(primitive.id, (values.get(primitive.r) ?? 0) + (overshoot.get(primitive.id) ?? 0));
  }
  return radii;
}

function contains(primitive: LogoGeometryPrimitive, p: Vec, radii: ReadonlyMap<string, number>): boolean {
  switch (primitive.kind) {
    case "circle":
      return dist(p, { x: primitive.cx, y: primitive.cy }) < (radii.get(primitive.id) ?? 0);
    case "line": {
      const [fx, fy] = primitive.from;
      const [tx, ty] = primitive.to;
      return (tx - fx) * (p.y - fy) - (ty - fy) * (p.x - fx) > 0;
    }
    case "rect":
      return p.x > primitive.x && p.x < primitive.x + primitive.width && p.y > primitive.y && p.y < primitive.y + primitive.height;
    case "polygon": {
      let inside = false;
      const points = primitive.points;
      for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
  }
}

function evaluate(node: LogoGeometryNode, inside: (id: string) => boolean): boolean {
  if ("ref" in node) return inside(node.ref);
  const [first, ...rest] = node.args;
  switch (node.op) {
    case "union":
      return node.args.some((arg) => evaluate(arg, inside));
    case "intersect":
      return node.args.every((arg) => evaluate(arg, inside));
    case "subtract":
      return evaluate(first, inside) && !rest.some((arg) => evaluate(arg, inside));
  }
}

/** The infinite line through `from` and `to`, clipped to the artboard. */
function clipToArtboard(from: Vec, to: Vec): [Vec, Vec] {
  const d = sub(to, from);
  let lo = -Infinity;
  let hi = Infinity;
  for (const [origin, delta] of [[from.x, d.x], [from.y, d.y]] as const) {
    if (Math.abs(delta) < COINCIDENT) continue;
    const t0 = (0 - origin) / delta;
    const t1 = (LOGO_GEOMETRY_GRID - origin) / delta;
    lo = Math.max(lo, Math.min(t0, t1));
    hi = Math.min(hi, Math.max(t0, t1));
  }
  return [{ x: from.x + d.x * lo, y: from.y + d.y * lo }, { x: from.x + d.x * hi, y: from.y + d.y * hi }];
}

function curvesOf(geometry: LogoGeometryV1, radii: ReadonlyMap<string, number>): Curve[] {
  const curves: Curve[] = [];
  const polygon = (points: readonly Vec[], owner: string): void => {
    points.forEach((a, index) => curves.push({ kind: "segment", a, b: points[(index + 1) % points.length], owners: [owner] }));
  };
  for (const primitive of geometry.primitives) {
    switch (primitive.kind) {
      case "circle": {
        const c = { x: primitive.cx, y: primitive.cy };
        const r = radii.get(primitive.id) ?? 0;
        const same = curves.find((curve): curve is Circle => curve.kind === "circle" && dist(curve.c, c) < COINCIDENT && Math.abs(curve.r - r) < COINCIDENT);
        if (same) same.owners.push(primitive.id);
        else curves.push({ kind: "circle", c, r, owners: [primitive.id] });
        break;
      }
      case "line": {
        const [a, b] = clipToArtboard({ x: primitive.from[0], y: primitive.from[1] }, { x: primitive.to[0], y: primitive.to[1] });
        curves.push({ kind: "segment", a, b, owners: [primitive.id] });
        break;
      }
      case "rect": {
        const { x, y, width: w, height: h } = primitive;
        polygon([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], primitive.id);
        break;
      }
      case "polygon":
        polygon(primitive.points.map(([x, y]) => ({ x, y })), primitive.id);
        break;
    }
  }
  const g = LOGO_GEOMETRY_GRID;
  polygon([{ x: 0, y: 0 }, { x: g, y: 0 }, { x: g, y: g }, { x: 0, y: g }], LOGO_GEOMETRY_ARTBOARD_ID);
  return curves;
}

function onSegment(s: Segment, p: Vec, tolerance: number): boolean {
  const d = sub(s.b, s.a);
  const length = Math.hypot(d.x, d.y);
  const t = dot(sub(p, s.a), d) / (length * length);
  if (t < -tolerance / length || t > 1 + tolerance / length) return false;
  return Math.abs(cross(d, sub(p, s.a))) / length <= tolerance;
}

function onCurve(curve: Curve, p: Vec, tolerance: number): boolean {
  return curve.kind === "segment" ? onSegment(curve, p, tolerance) : Math.abs(dist(p, curve.c) - curve.r) <= tolerance;
}

interface Hit {
  readonly point: Vec;
  readonly tangent: boolean;
}

function segmentSegment(s: Segment, t: Segment): Hit[] {
  const r = sub(s.b, s.a);
  const q = sub(t.b, t.a);
  const denominator = cross(r, q);
  if (Math.abs(denominator) < COINCIDENT * Math.hypot(r.x, r.y) * Math.hypot(q.x, q.y)) {
    // Parallel. When collinear, each segment is split where the other one ends.
    return [s.a, s.b, t.a, t.b].filter((p) => onSegment(s, p, MERGE) && onSegment(t, p, MERGE)).map((point) => ({ point, tangent: false }));
  }
  const w = sub(t.a, s.a);
  const u = cross(w, q) / denominator;
  const v = cross(w, r) / denominator;
  const slack = 1e-12;
  if (u < -slack || u > 1 + slack || v < -slack || v > 1 + slack) return [];
  return [{ point: { x: s.a.x + r.x * u, y: s.a.y + r.y * u }, tangent: false }];
}

function segmentCircle(s: Segment, c: Circle): Hit[] {
  const d = sub(s.b, s.a);
  const length = Math.hypot(d.x, d.y);
  const unit = { x: d.x / length, y: d.y / length };
  const along = dot(sub(c.c, s.a), unit);
  const foot = { x: s.a.x + unit.x * along, y: s.a.y + unit.y * along };
  const offset = dist(foot, c.c);
  if (offset > c.r + COINCIDENT) return [];
  const candidates: Hit[] = Math.abs(offset - c.r) <= COINCIDENT
    ? [{ point: foot, tangent: true }]
    : [-1, 1].map((sign) => {
      const half = Math.sqrt(c.r * c.r - offset * offset) * sign;
      return { point: { x: foot.x + unit.x * half, y: foot.y + unit.y * half }, tangent: false };
    });
  return candidates.filter((hit) => onSegment(s, hit.point, MERGE));
}

function circleCircle(a: Circle, b: Circle): Hit[] {
  const d = dist(a.c, b.c);
  if (d < COINCIDENT) return [];
  if (d > a.r + b.r + COINCIDENT || d < Math.abs(a.r - b.r) - COINCIDENT) return [];
  const along = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
  const unit = { x: (b.c.x - a.c.x) / d, y: (b.c.y - a.c.y) / d };
  const base = { x: a.c.x + unit.x * along, y: a.c.y + unit.y * along };
  if (Math.abs(d - (a.r + b.r)) <= COINCIDENT || Math.abs(d - Math.abs(a.r - b.r)) <= COINCIDENT) return [{ point: base, tangent: true }];
  const h = Math.sqrt(Math.max(0, a.r * a.r - along * along));
  return [-1, 1].map((sign) => ({ point: { x: base.x - unit.y * h * sign, y: base.y + unit.x * h * sign }, tangent: false }));
}

function intersect(a: Curve, b: Curve): Hit[] {
  if (a.kind === "segment" && b.kind === "segment") return segmentSegment(a, b);
  if (a.kind === "segment" && b.kind === "circle") return segmentCircle(a, b);
  if (a.kind === "circle" && b.kind === "segment") return segmentCircle(b, a);
  return circleCircle(a as Circle, b as Circle);
}

class Vertices {
  readonly points: Vec[] = [];

  id(p: Vec): number {
    const found = this.points.findIndex((q) => dist(p, q) < MERGE);
    if (found !== -1) return found;
    this.points.push(p);
    return this.points.length - 1;
  }
}

/** A piece of one curve between two vertices; `from === to` with no vertex means a whole circle. */
interface Piece {
  readonly curve: number;
  readonly from: number;
  readonly to: number;
  /** Arc pieces only: start angle and positive sweep. */
  readonly start: number;
  readonly sweep: number;
}

function piecesOf(curves: readonly Curve[], splits: readonly Set<number>[], vertices: Vertices): Piece[] {
  const pieces: Piece[] = [];
  const seen = new Map<string, number>();
  curves.forEach((curve, index) => {
    const ids = [...splits[index]];
    if (curve.kind === "segment") {
      ids.push(vertices.id(curve.a), vertices.id(curve.b));
      const d = sub(curve.b, curve.a);
      const order = [...new Set(ids)].map((id) => ({ id, t: dot(sub(vertices.points[id], curve.a), d) })).sort((p, q) => p.t - q.t);
      for (let i = 0; i + 1 < order.length; i += 1) {
        const from = order[i].id;
        const to = order[i + 1].id;
        const key = `s:${Math.min(from, to)}:${Math.max(from, to)}`;
        const existing = seen.get(key);
        if (existing === undefined) {
          seen.set(key, pieces.length);
          pieces.push({ curve: index, from, to, start: 0, sweep: 0 });
        } else {
          // A collinear overlap: the same edge belongs to both primitives.
          const owner = curves[pieces[existing].curve].owners;
          for (const name of curve.owners) if (!owner.includes(name)) owner.push(name);
        }
      }
      return;
    }
    const order = [...new Set(ids)].map((id) => ({ id, angle: angleOf(curve.c, vertices.points[id]) })).sort((p, q) => p.angle - q.angle);
    if (order.length === 0) {
      pieces.push({ curve: index, from: -1, to: -1, start: 0, sweep: TAU });
      return;
    }
    order.forEach((current, i) => {
      const next = order[(i + 1) % order.length];
      let sweep = next.angle - current.angle;
      if (sweep <= 0) sweep += TAU;
      pieces.push({ curve: index, from: current.id, to: next.id, start: current.angle, sweep });
    });
  });
  return pieces;
}

function pointAt(curve: Circle, angle: number): Vec {
  return { x: curve.c.x + curve.r * Math.cos(angle), y: curve.c.y + curve.r * Math.sin(angle) };
}

const formatNumber = (value: number): string => {
  const rounded = Math.round(value * 1e4) / 1e4;
  return Object.is(rounded, -0) ? "0" : String(rounded === 0 ? 0 : rounded);
};

function pathOf(loops: readonly (readonly LogoGeometryEdge[])[]): string {
  const f = formatNumber;
  const parts: string[] = [];
  for (const loop of loops) {
    parts.push(`M${f(loop[0].from.x)} ${f(loop[0].from.y)}`);
    for (const edge of loop) {
      if (edge.kind === "line") {
        parts.push(`L${f(edge.to.x)} ${f(edge.to.y)}`);
        continue;
      }
      const flag = edge.sweep > 0 ? 1 : 0;
      const arc = (to: Vec, large: number): string => `A${f(edge.r)} ${f(edge.r)} 0 ${large} ${flag} ${f(to.x)} ${f(to.y)}`;
      if (Math.abs(edge.sweep) > TAU - 1e-9) {
        // A whole circle cannot be one arc command; go through the opposite point.
        parts.push(arc({ x: 2 * edge.center.x - edge.from.x, y: 2 * edge.center.y - edge.from.y }, 0), arc(edge.to, 0));
      } else {
        parts.push(arc(edge.to, Math.abs(edge.sweep) > Math.PI ? 1 : 0));
      }
    }
    parts.push("Z");
  }
  return parts.join("");
}

/** The signed area an edge contributes under Green's theorem, exact for lines and circular arcs. */
function signedArea(edge: LogoGeometryEdge): number {
  if (edge.kind === "line") return (edge.from.x * edge.to.y - edge.to.x * edge.from.y) / 2;
  const a0 = angleOf(edge.center, edge.from);
  const a1 = a0 + edge.sweep;
  const { x: cx, y: cy } = edge.center;
  return (edge.r * edge.r * edge.sweep + cx * edge.r * (Math.sin(a1) - Math.sin(a0)) - cy * edge.r * (Math.cos(a1) - Math.cos(a0))) / 2;
}

/** Points where an arc runs level or upright: its extremes on each axis. */
function arcExtremes(edge: Extract<LogoGeometryEdge, { kind: "arc" }>): Vec[] {
  const start = angleOf(edge.center, edge.from);
  const [lo, span] = edge.sweep > 0 ? [start, edge.sweep] : [start + edge.sweep, -edge.sweep];
  const points: Vec[] = [];
  for (let quarter = -8; quarter <= 16; quarter += 1) {
    const angle = (quarter * Math.PI) / 2;
    if (angle > lo + 1e-12 && angle < lo + span - 1e-12) points.push({ x: edge.center.x + edge.r * Math.cos(angle), y: edge.center.y + edge.r * Math.sin(angle) });
  }
  return points;
}

function uniqueSorted(values: readonly number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.filter((value, index) => index === 0 || value - sorted[index - 1] > ON_CURVE).map((value) => Math.round(value * 1e6) / 1e6);
}

/**
 * Compiles a parsed geometry record into its outline and the facts the construction view draws.
 * Throws `LogoGeometryCompileError` when the tree leaves nothing on the artboard or the kept edges
 * do not close.
 */
export function compileLogoGeometry(geometry: LogoGeometryV1): LogoGeometryCompiled {
  const radii = radiiOf(geometry);
  const primitives = new Map(geometry.primitives.map((primitive) => [primitive.id, primitive]));
  const notches = geometry.optical.flatMap((item) => item.kind === "notch" ? [item.primitive] : []);
  const has = (id: string, p: Vec): boolean => {
    const primitive = primitives.get(id);
    return primitive !== undefined && contains(primitive, p, radii);
  };
  const g = LOGO_GEOMETRY_GRID;
  const inside = (p: Vec): boolean => p.x > 0 && p.x < g && p.y > 0 && p.y < g
    && evaluate(geometry.tree, (id) => has(id, p)) && !notches.some((id) => has(id, p));

  const curves = curvesOf(geometry, radii);
  const vertices = new Vertices();
  const splits = curves.map(() => new Set<number>());
  const tangentHits: { point: Vec; owners: [string, string] }[] = [];
  for (let i = 0; i < curves.length; i += 1) {
    for (let j = i + 1; j < curves.length; j += 1) {
      for (const hit of intersect(curves[i], curves[j])) {
        const id = vertices.id(hit.point);
        splits[i].add(id);
        splits[j].add(id);
        if (hit.tangent) tangentHits.push({ point: vertices.points[id], owners: [curves[i].owners[0], curves[j].owners[0]] });
      }
    }
  }

  const edges: LogoGeometryEdge[] = [];
  /** Vertex ids of each kept edge, parallel to `edges`; -1 marks a whole circle. */
  const ends: { readonly fromId: number; readonly toId: number }[] = [];
  for (const piece of piecesOf(curves, splits, vertices)) {
    const curve = curves[piece.curve];
    let mid: Vec;
    let tangent: Vec;
    if (curve.kind === "segment") {
      const a = vertices.points[piece.from];
      const b = vertices.points[piece.to];
      mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const length = dist(a, b);
      tangent = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    } else {
      const angle = piece.start + piece.sweep / 2;
      mid = pointAt(curve, angle);
      tangent = { x: -Math.sin(angle), y: Math.cos(angle) };
    }
    const normal = { x: -tangent.y, y: tangent.x };
    const left = inside({ x: mid.x + normal.x * PROBE, y: mid.y + normal.y * PROBE });
    const right = inside({ x: mid.x - normal.x * PROBE, y: mid.y - normal.y * PROBE });
    if (left === right) continue;
    const [fromId, toId] = left ? [piece.from, piece.to] : [piece.to, piece.from];
    const on = [...curve.owners];
    if (curve.kind === "segment") {
      const from = vertices.points[fromId];
      const to = vertices.points[toId];
      edges.push({ kind: "line", from, to, on, length: dist(from, to) });
    } else {
      const whole = piece.from === -1;
      const from = whole ? pointAt(curve, 0) : vertices.points[fromId];
      const to = whole ? from : vertices.points[toId];
      const sweep = left ? piece.sweep : -piece.sweep;
      edges.push({ kind: "arc", from, to, center: curve.c, r: curve.r, sweep, on, length: curve.r * piece.sweep });
    }
    ends.push({ fromId, toId });
  }
  if (edges.length === 0) throw new LogoGeometryCompileError("empty_shape");

  const loops: LogoGeometryEdge[][] = [];
  const used = new Set<number>();
  const outgoing = new Map<number, number[]>();
  ends.forEach(({ fromId }, index) => {
    if (fromId !== -1) outgoing.set(fromId, [...(outgoing.get(fromId) ?? []), index]);
  });
  edges.forEach((edge, index) => {
    if (used.has(index)) return;
    used.add(index);
    const loop: LogoGeometryEdge[] = [edge];
    const start = ends[index].fromId;
    let current = ends[index].toId;
    while (start !== -1 && current !== start) {
      const next = (outgoing.get(current) ?? []).find((candidate) => !used.has(candidate));
      if (next === undefined) throw new LogoGeometryCompileError("open_loop");
      used.add(next);
      loop.push(edges[next]);
      current = ends[next].toId;
    }
    loops.push(loop);
  });

  const keptIds = [...new Set(ends.flatMap(({ fromId, toId }) => fromId === -1 ? [] : [fromId, toId]))].sort((a, b) => a - b);
  const vertexList: LogoGeometryVertex[] = keptIds.map((id) => {
    const p = vertices.points[id];
    return { x: p.x, y: p.y, on: [...new Set(curves.filter((curve) => onCurve(curve, p, ON_CURVE)).flatMap((curve) => curve.owners))].sort() };
  });
  const keptPoint = (p: Vec): boolean => vertexList.some((v) => dist(v, p) < MERGE);
  const tangencies = tangentHits.filter((hit) => keptPoint(hit.point)).map((hit) => ({ x: hit.point.x, y: hit.point.y, on: hit.owners }));
  const levelPoints = edges.flatMap((edge) => edge.kind === "arc" ? arcExtremes(edge) : []);
  const guidePoints = [...vertexList, ...levelPoints];
  const slivers = edges.filter((edge) => edge.length < LOGO_GEOMETRY_SLIVER_LENGTH)
    .map((edge) => ({ length: edge.length, on: edge.on, from: edge.from, to: edge.to }));

  return {
    path: pathOf(loops),
    loops,
    area: Math.abs(edges.reduce((total, edge) => total + signedArea(edge), 0)),
    vertices: vertexList,
    tangencies,
    guides: { x: uniqueSorted(guidePoints.map((p) => p.x)), y: uniqueSorted(guidePoints.map((p) => p.y)) },
    slivers,
  };
}

/** The compiled mark as a standalone SVG on the 64-unit artboard, inside the master vector allowlist. */
export function logoGeometrySvg(compiled: LogoGeometryCompiled, label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_GEOMETRY_GRID} ${LOGO_GEOMETRY_GRID}" role="img" aria-label="${label}">`
    + `<path d="${compiled.path}" fill="#000000" fill-rule="nonzero"/></svg>`;
}
