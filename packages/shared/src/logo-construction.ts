import { LOGO_GEOMETRY_GRID, type LogoGeometryV1 } from "./logo-geometry";
import {
  logoGeometryLineSegment,
  logoGeometryLoopPath,
  type LogoGeometryCompiled,
  type LogoGeometryVec,
} from "./logo-geometry-compile";

/**
 * The construction drawing of a geometric mark (doc/26-logo-construction-2026-11-09.md).
 *
 * `renderLogoConstruction(geometry, compiled, t)` returns the whole drawing as SVG text for one
 * moment `t` in [0, 1] of its draw-in. The app plays it, and the GIF and MP4 exports sample it, so
 * every surface shows the same frames, and no test depends on a clock. The drawing is built from
 * the record and its compiled outline only, so it shows what the mark is made of and nothing else.
 *
 * Build order, one step after another: guides, circles (with centre and radius), lines and the
 * edges of rectangles and polygons, key points (vertices and tangencies), the outline trace, then
 * the fill. Inside a step the strokes start one stagger apart; each stroke draws in along its own
 * length with an ease-out.
 */

export const LOGO_CONSTRUCTION_STEPS = ["guides", "circles", "lines", "points", "outline", "fill"] as const;
export type LogoConstructionStep = (typeof LOGO_CONSTRUCTION_STEPS)[number];

/** Each stroke draws in within this time (owner-rules/ui-motion.md: most motion fits 100-400 ms). */
export const LOGO_CONSTRUCTION_STROKE_MS = 400;
export const LOGO_CONSTRUCTION_POINT_MS = 200;
export const LOGO_CONSTRUCTION_FILL_MS = 300;
export const LOGO_CONSTRUCTION_STAGGER_MS = 60;

export type LogoConstructionTheme = "light" | "dark";

export interface LogoConstructionItem {
  readonly step: LogoConstructionStep;
  readonly key: string;
  readonly start_ms: number;
  readonly end_ms: number;
}

export interface LogoConstructionTimeline {
  readonly duration_ms: number;
  readonly items: readonly LogoConstructionItem[];
}

const PALETTES: Record<LogoConstructionTheme, { readonly paper: string; readonly ink: string; readonly line: string; readonly accent: string }> = {
  light: { paper: "#ffffff", ink: "#111111", line: "#6b7a90", accent: "#d9480f" },
  dark: { paper: "#0b0d10", ink: "#f2f2f2", line: "#8b98ad", accent: "#ff8a4c" },
};

const G = LOGO_GEOMETRY_GRID;
const CONSTRUCTION_WIDTH = 0.18;
const OUTLINE_WIDTH = 0.3;
const POINT_RADIUS = 0.55;

const f = (value: number): string => {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) || rounded === 0 ? "0" : String(rounded);
};

const easeOut = (p: number): number => 1 - (1 - p) ** 3;

const escapeText = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A drawable mark, before it is placed in time. */
interface Stroke {
  readonly step: LogoConstructionStep;
  readonly key: string;
  readonly draw: (progress: number, palette: (typeof PALETTES)[LogoConstructionTheme]) => string;
}

/** A stroke `d` of length `length` drawn in to `progress` with a dash. */
function dashed(d: string, length: number, progress: number, colour: string, width: number): string {
  const offset = length * (1 - progress);
  return `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${f(width)}" stroke-linecap="round" `
    + `stroke-dasharray="${f(length)} ${f(length)}" stroke-dashoffset="${f(offset)}"/>`;
}

function segment(a: LogoGeometryVec, b: LogoGeometryVec): { d: string; length: number } {
  return { d: `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`, length: Math.hypot(b.x - a.x, b.y - a.y) };
}

function polyline(points: readonly LogoGeometryVec[]): { d: string; length: number } {
  let length = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    length += Math.hypot(next.x - point.x, next.y - point.y);
  });
  return { d: `M${points.map((p) => `${f(p.x)} ${f(p.y)}`).join("L")}Z`, length };
}

function strokesOf(geometry: LogoGeometryV1, compiled: LogoGeometryCompiled): Stroke[] {
  const strokes: Stroke[] = [];
  const radii = new Map(geometry.radii.map((radius) => [radius.id, radius.value]));
  const overshoot = new Map(geometry.optical.flatMap((item) => item.kind === "overshoot" ? [[item.primitive, item.amount] as const] : []));
  const notched = new Set(geometry.optical.flatMap((item) => item.kind === "notch" ? [item.primitive] : []));

  compiled.guides.x.forEach((x) => {
    const line = segment({ x, y: 0 }, { x, y: G });
    strokes.push({ step: "guides", key: `guide-x-${f(x)}`, draw: (p, c) => dashed(line.d, line.length, p, c.line, CONSTRUCTION_WIDTH / 2) });
  });
  compiled.guides.y.forEach((y) => {
    const line = segment({ x: 0, y }, { x: G, y });
    strokes.push({ step: "guides", key: `guide-y-${f(y)}`, draw: (p, c) => dashed(line.d, line.length, p, c.line, CONSTRUCTION_WIDTH / 2) });
  });

  for (const primitive of geometry.primitives) {
    const corrected = overshoot.has(primitive.id) || notched.has(primitive.id);
    const colour = (c: (typeof PALETTES)[LogoConstructionTheme]): string => corrected ? c.accent : c.line;
    switch (primitive.kind) {
      case "circle": {
        const r = (radii.get(primitive.r) ?? 0) + (overshoot.get(primitive.id) ?? 0);
        const { cx, cy } = primitive;
        // Starts at three o'clock and runs clockwise on screen, like the radius it is drawn from.
        const ring = `M${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx + r)} ${f(cy)}`;
        const radius = segment({ x: cx, y: cy }, { x: cx + r, y: cy });
        strokes.push({
          step: "circles",
          key: `circle-${primitive.id}`,
          draw: (p, c) => {
            const cross = `M${f(cx - 0.8)} ${f(cy)}L${f(cx + 0.8)} ${f(cy)}M${f(cx)} ${f(cy - 0.8)}L${f(cx)} ${f(cy + 0.8)}`;
            return `<path d="${cross}" fill="none" stroke="${colour(c)}" stroke-width="${f(CONSTRUCTION_WIDTH)}" opacity="${f(p)}"/>`
              + dashed(radius.d, radius.length, p, colour(c), CONSTRUCTION_WIDTH)
              + dashed(ring, Math.PI * 2 * r, p, colour(c), CONSTRUCTION_WIDTH);
          },
        });
        break;
      }
      case "line": {
        const [a, b] = logoGeometryLineSegment({ x: primitive.from[0], y: primitive.from[1] }, { x: primitive.to[0], y: primitive.to[1] });
        const line = segment(a, b);
        strokes.push({ step: "lines", key: `line-${primitive.id}`, draw: (p, c) => dashed(line.d, line.length, p, colour(c), CONSTRUCTION_WIDTH) });
        break;
      }
      case "rect": {
        const { x, y, width: w, height: h } = primitive;
        const box = polyline([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]);
        strokes.push({ step: "lines", key: `rect-${primitive.id}`, draw: (p, c) => dashed(box.d, box.length, p, colour(c), CONSTRUCTION_WIDTH) });
        break;
      }
      case "polygon": {
        const shape = polyline(primitive.points.map(([x, y]) => ({ x, y })));
        strokes.push({ step: "lines", key: `polygon-${primitive.id}`, draw: (p, c) => dashed(shape.d, shape.length, p, colour(c), CONSTRUCTION_WIDTH) });
        break;
      }
    }
  }

  const tangent = (v: LogoGeometryVec): boolean => compiled.tangencies.some((t) => Math.hypot(t.x - v.x, t.y - v.y) < 1e-6);
  compiled.vertices.forEach((vertex, index) => {
    strokes.push({
      step: "points",
      key: `point-${index}`,
      draw: (p, c) => p <= 0 ? "" : tangent(vertex)
        ? `<circle cx="${f(vertex.x)}" cy="${f(vertex.y)}" r="${f(POINT_RADIUS * p)}" fill="${c.paper}" stroke="${c.accent}" stroke-width="${f(CONSTRUCTION_WIDTH)}"/>`
        : `<circle cx="${f(vertex.x)}" cy="${f(vertex.y)}" r="${f(POINT_RADIUS * p)}" fill="${c.accent}"/>`,
    });
  });

  compiled.loops.forEach((loop, index) => {
    const d = logoGeometryLoopPath(loop);
    const length = loop.reduce((total, edge) => total + edge.length, 0);
    strokes.push({ step: "outline", key: `outline-${index}`, draw: (p, c) => dashed(d, length, p, c.ink, OUTLINE_WIDTH) });
  });
  return strokes;
}

function durationOf(step: LogoConstructionStep): number {
  if (step === "points") return LOGO_CONSTRUCTION_POINT_MS;
  if (step === "fill") return LOGO_CONSTRUCTION_FILL_MS;
  return LOGO_CONSTRUCTION_STROKE_MS;
}

function schedule(strokes: readonly Stroke[]): LogoConstructionTimeline {
  const items: LogoConstructionItem[] = [];
  let cursor = 0;
  for (const step of LOGO_CONSTRUCTION_STEPS) {
    const members = step === "fill" ? [{ key: "fill" }] : strokes.filter((stroke) => stroke.step === step);
    if (members.length === 0) continue;
    members.forEach((member, index) => {
      const start = cursor + index * LOGO_CONSTRUCTION_STAGGER_MS;
      items.push({ step, key: member.key, start_ms: start, end_ms: start + durationOf(step) });
    });
    cursor = items[items.length - 1].end_ms;
  }
  return { duration_ms: cursor, items };
}

/** When each stroke draws in. The whole drawing lasts `duration_ms`. */
export function logoConstructionTimeline(geometry: LogoGeometryV1, compiled: LogoGeometryCompiled): LogoConstructionTimeline {
  return schedule(strokesOf(geometry, compiled));
}

/**
 * The drawing position for a clock reading. Reduced motion always shows the finished drawing.
 * Out-of-range readings clamp, so a late frame never draws past the end.
 */
export function logoConstructionProgress(elapsedMs: number, timeline: LogoConstructionTimeline, reducedMotion: boolean): number {
  if (reducedMotion || timeline.duration_ms <= 0) return 1;
  return Math.min(1, Math.max(0, elapsedMs / timeline.duration_ms));
}

export interface LogoConstructionRenderOptions {
  readonly theme: LogoConstructionTheme;
  /** The accessible name of the drawing. */
  readonly label: string;
}

/** The construction drawing at moment `t` in [0, 1]: 0 is an empty artboard, 1 the finished sheet. */
export function renderLogoConstruction(
  geometry: LogoGeometryV1,
  compiled: LogoGeometryCompiled,
  t: number,
  options: LogoConstructionRenderOptions,
): string {
  const palette = PALETTES[options.theme];
  const strokes = strokesOf(geometry, compiled);
  const timeline = schedule(strokes);
  const now = Math.min(1, Math.max(0, t)) * timeline.duration_ms;
  const progress = (item: LogoConstructionItem): number => easeOut(Math.min(1, Math.max(0, (now - item.start_ms) / (item.end_ms - item.start_ms))));
  const byKey = new Map(timeline.items.map((item) => [item.key, item]));
  const fill = byKey.get("fill");
  const fillOpacity = fill === undefined ? 1 : progress(fill);
  const layers = strokes.map((stroke) => {
    const item = byKey.get(stroke.key);
    const p = item === undefined ? 1 : progress(item);
    return p <= 0 ? "" : stroke.draw(p, palette);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${G} ${G}" role="img" aria-label="${escapeText(options.label)}">`
    + `<rect x="0" y="0" width="${G}" height="${G}" fill="${palette.paper}"/>`
    + `<path d="${compiled.path}" fill="${palette.ink}" fill-rule="nonzero" fill-opacity="${f(fillOpacity)}"/>`
    + layers.join("")
    + "</svg>";
}
