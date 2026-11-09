/**
 * The lockup of the geometric logo method: the symbol and the wordmark placed side by side with no
 * model involved. Every distance comes from the wordmark's cap height, which is itself a multiple of
 * the symbol unit, so the same two records always give the same bytes.
 *
 * - Size: the two share one unit, so the symbol keeps its artboard size and the wordmark its cap height.
 * - Gap: half the cap height, rounded up to the grid snap, from the symbol's ink to the wordmark's ink.
 * - Optical centre: the middle of the cap height sits on the symbol's area centroid, not its box centre,
 *   so a mark heavy at the bottom carries its words lower.
 * - Clear space: one cap height on every side.
 */
import { LOGO_GEOMETRY_SNAP } from "./logo-geometry";
import type { LogoGeometryCompiled, LogoGeometryEdge, LogoGeometryVec } from "./logo-geometry-compile";
import type { LogoWordmarkCompiled } from "./logo-wordmark";

export const LOGO_LOCKUP_GAP_RATIO = 0.5;
export const LOGO_LOCKUP_CLEAR_RATIO = 1;

export interface LogoLockupBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface LogoLockupLayout {
  readonly schema_version: 1;
  readonly width: number;
  readonly height: number;
  readonly gap: number;
  readonly clear_space: number;
  /** Translations applied to the symbol artboard and the wordmark's own coordinates. */
  readonly symbol: LogoGeometryVec;
  readonly wordmark: LogoGeometryVec;
  /** The symbol's area centroid on the lockup artboard; the cap-height middle sits on its y. */
  readonly optical_center: LogoGeometryVec;
}

/** Integrals over one edge for Green's theorem: 2A, the x moment term and the y moment term. */
function edgeTerms(edge: LogoGeometryEdge): { area2: number; x2dy: number; y2dx: number } {
  if (edge.kind === "line") {
    const { x: x0, y: y0 } = edge.from;
    const { x: x1, y: y1 } = edge.to;
    return {
      area2: x0 * y1 - x1 * y0,
      x2dy: ((y1 - y0) * (x0 * x0 + x0 * x1 + x1 * x1)) / 3,
      y2dx: ((x1 - x0) * (y0 * y0 + y0 * y1 + y1 * y1)) / 3,
    };
  }
  const { x: cx, y: cy } = edge.center;
  const r = edge.r;
  const a = Math.atan2(edge.from.y - cy, edge.from.x - cx);
  const b = a + edge.sweep;
  const sin = Math.sin;
  const cos = Math.cos;
  const cubeSin = (t: number): number => sin(t) - sin(t) ** 3 / 3;
  const cubeCos = (t: number): number => -cos(t) + cos(t) ** 3 / 3;
  return {
    area2: r * cx * (sin(b) - sin(a)) + r * cy * (cos(a) - cos(b)) + r * r * (b - a),
    x2dy: r * (cx * cx * (sin(b) - sin(a)) + 2 * cx * r * ((b - a) / 2 + (sin(2 * b) - sin(2 * a)) / 4) + r * r * (cubeSin(b) - cubeSin(a))),
    y2dx: -r * (cy * cy * (cos(a) - cos(b)) + 2 * cy * r * ((b - a) / 2 - (sin(2 * b) - sin(2 * a)) / 4) + r * r * (cubeCos(b) - cubeCos(a))),
  };
}

/** Exact area and centroid of the compiled outline, holes included, from its line and arc edges. */
export function logoGeometryCentroid(compiled: LogoGeometryCompiled): { readonly area: number; readonly center: LogoGeometryVec } {
  let area2 = 0;
  let x2dy = 0;
  let y2dx = 0;
  for (const loop of compiled.loops) {
    for (const edge of loop) {
      const terms = edgeTerms(edge);
      area2 += terms.area2;
      x2dy += terms.x2dy;
      y2dx += terms.y2dx;
    }
  }
  return { area: Math.abs(area2) / 2, center: { x: x2dy / area2, y: -y2dx / area2 } };
}

/** The ink box of the compiled outline: edge ends plus every arc's extreme points inside its sweep. */
export function logoGeometryBounds(compiled: LogoGeometryCompiled): LogoLockupBounds {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const loop of compiled.loops) {
    for (const edge of loop) {
      xs.push(edge.from.x, edge.to.x);
      ys.push(edge.from.y, edge.to.y);
      if (edge.kind !== "arc") continue;
      const start = Math.atan2(edge.from.y - edge.center.y, edge.from.x - edge.center.x);
      const [low, high] = edge.sweep > 0 ? [start, start + edge.sweep] : [start + edge.sweep, start];
      for (let quarter = Math.ceil(low / (Math.PI / 2)); quarter * (Math.PI / 2) <= high; quarter += 1) {
        const angle = quarter * (Math.PI / 2);
        xs.push(edge.center.x + edge.r * Math.cos(angle));
        ys.push(edge.center.y + edge.r * Math.sin(angle));
      }
    }
  }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

const snapUp = (value: number): number => Math.ceil(value / LOGO_GEOMETRY_SNAP - 1e-9) * LOGO_GEOMETRY_SNAP;
/** Three decimals, so the layout and its SVG are the same bytes on every machine. */
const fixed = (value: number): number => {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** Places the symbol and the wordmark; pure and deterministic. */
export function composeLogoLockup(symbol: LogoGeometryCompiled, wordmark: LogoWordmarkCompiled): LogoLockupLayout {
  const cap = wordmark.metrics.cap_height;
  const gap = snapUp(cap * LOGO_LOCKUP_GAP_RATIO);
  const clear = snapUp(cap * LOGO_LOCKUP_CLEAR_RATIO);
  const mark = logoGeometryBounds(symbol);
  const words = wordmark.bounds;
  const centroid = logoGeometryCentroid(symbol).center;
  // With the symbol untranslated, the wordmark's cap-height middle lands on the centroid.
  const wordsY = centroid.y - cap / 2;
  const top = Math.min(mark.minY, wordsY + words.minY);
  const bottom = Math.max(mark.maxY, wordsY + words.maxY);
  const symbolAt = { x: clear - mark.minX, y: clear - top };
  const wordmarkAt = { x: clear + (mark.maxX - mark.minX) + gap - words.minX, y: wordsY + clear - top };
  return {
    schema_version: 1,
    width: fixed(clear + (mark.maxX - mark.minX) + gap + (words.maxX - words.minX) + clear),
    height: fixed(bottom - top + 2 * clear),
    gap,
    clear_space: clear,
    symbol: { x: fixed(symbolAt.x), y: fixed(symbolAt.y) },
    wordmark: { x: fixed(wordmarkAt.x), y: fixed(wordmarkAt.y) },
    optical_center: { x: fixed(centroid.x + symbolAt.x), y: fixed(centroid.y + symbolAt.y) },
  };
}

/** The lockup as a standalone SVG: two filled paths, each moved by its layout translation. */
export function logoLockupSvg(symbol: LogoGeometryCompiled, wordmark: LogoWordmarkCompiled, layout: LogoLockupLayout, label: string): string {
  const move = (at: LogoGeometryVec): string => `translate(${at.x} ${at.y})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="${label}">`
    + `<path transform="${move(layout.symbol)}" d="${symbol.path}" fill="#000000" fill-rule="nonzero"/>`
    + `<path transform="${move(layout.wordmark)}" d="${wordmark.path}" fill="#000000" fill-rule="nonzero"/></svg>`;
}
