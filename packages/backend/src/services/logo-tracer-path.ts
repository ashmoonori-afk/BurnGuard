/**
 * Modified TypeScript adaptation of the vtracer/visioncortex tracing approach.
 * Copyright (c) 2024, 2026 TSANG, Hao Fung.
 * vtracer: MIT; visioncortex: Apache-2.0 (upstream also offers MIT).
 * Changes: bounded palette fitting and edge graph instead of hierarchical
 * clustering; iterative polygon reduction; optional local quadratic smoothing.
 * Full MIT terms and Apache attribution: THIRD_PARTY_NOTICES.md and NOTICE.
 * Apache License, Version 2.0: root LICENSE. No upstream NOTICE was present.
 */
import { setImmediate } from "node:timers/promises";
import type { LogoTraceOptions } from "./logo-tracer";
type Point = readonly [number, number];
const MAX_EDGES = 250_000;

export class LogoTraceError extends Error {
  readonly name = "LogoTraceError";
  constructor(readonly code: "input" | "budget" | "empty") { super(`logo_trace_${code}`); }
}


export async function checkpoint(signal?: AbortSignal): Promise<void> {
  await setImmediate();
  signal?.throwIfAborted();
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
  return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
}

function simplify(points: readonly Point[], tolerance: number): Point[] {
  let evaluated = 0;
  const closed = [...points, points[0]];
  const keep = new Uint8Array(closed.length);
  keep[0] = keep[closed.length - 1] = 1;
  const stack = [[0, closed.length - 1]];
  while (stack.length) {
    const pair = stack.pop();
    if (!pair) break;
    const [first, last] = pair;
    let furthest = -1, distance = tolerance * tolerance;
    for (let i = first + 1; i < last; i++) {
      if (++evaluated > 2_000_000) throw new LogoTraceError("budget");
      const candidate = segmentDistance(closed[i], closed[first], closed[last]);
      if (candidate > distance) { distance = candidate; furthest = i; }
    }
    if (furthest !== -1) { keep[furthest] = 1; stack.push([first, furthest], [furthest, last]); }
  }
  const reduced = closed.filter((_, i) => keep[i]).slice(0, -1);
  return reduced.length >= 3 ? reduced : tolerance === 0 ? [...points] : [];
}

function encodeContour(points: readonly Point[], curve: "polygon" | "spline"): string {
  const number = (n: number): string => String(Math.round(n * 10) / 10);
  if (curve === "spline") {
    // Local corner rounding stays within half a pixel of each polygon vertex.
    const trim = (a: Point, b: Point): Point => {
      const t = Math.min(0.5, 0.5 / Math.hypot(b[0] - a[0], b[1] - a[1]));
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    };
    const start = trim(points[0], points[points.length - 1]);
    let d = `M${number(start[0])} ${number(start[1])}`;
    for (let i = 0; i < points.length; i++) {
      const p = points[i], next = points[(i + 1) % points.length], end = trim(p, next), before = trim(next, p);
      d += `Q${p[0]} ${p[1]} ${number(end[0])} ${number(end[1])}L${number(before[0])} ${number(before[1])}`;
    }
    return d + "Z";
  }
  let d = `M${points[0][0]} ${points[0][1]}`;
  let previousCommand = "M";
  const pair = (x: number, y: number): string => `${x}${y < 0 ? "" : " "}${y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const candidates = a[1] === b[1] ? [["H", String(b[0])], ["h", String(b[0] - a[0])]]
      : a[0] === b[0] ? [["V", String(b[1])], ["v", String(b[1] - a[1])]]
        : [["L", pair(b[0], b[1])], ["l", pair(b[0] - a[0], b[1] - a[1])]];
    const encoded = candidates.map(([command, values]) => ({
      command,
      text: command === previousCommand || (previousCommand === "M" && command === "L")
        ? `${values.startsWith("-") ? "" : " "}${values}` : command + values,
    })).sort((a, b) => a.text.length - b.text.length)[0];
    d += encoded.text;
    previousCommand = encoded.command;
  }
  return d + "Z";
}

export async function traceColor(labels: Uint8Array, width: number, height: number, label: number, options: LogoTraceOptions): Promise<string> {
  const stride = width + 1, edges = new Map<number, number>();
  const add = (x: number, y: number, direction: number, end: number): void => {
    if (edges.size >= MAX_EDGES) throw new LogoTraceError("budget");
    edges.set((y * stride + x) * 4 + direction, end);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x, vertex = y * stride + x;
      if (labels[p] !== label) continue;
      if (y === 0 || labels[p - width] !== label) add(x, y, 0, vertex + 1);
      if (x === width - 1 || labels[p + 1] !== label) add(x + 1, y, 1, vertex + stride + 1);
      if (y === height - 1 || labels[p + width] !== label) add(x + 1, y + 1, 2, vertex + stride);
      if (x === 0 || labels[p - 1] !== label) add(x, y + 1, 3, vertex);
    }
    if (y % 128 === 0) await checkpoint(options.signal);
  }
  const contours: string[] = [];
  let walked = 0;
  while (edges.size) {
    const first = edges.keys().next().value;
    if (first === undefined) break;
    const start = Math.floor(first / 4);
    let edge = first, direction = edge % 4;
    const points: Point[] = [[start % stride, Math.floor(start / stride)]];
    for (;;) {
      const end = edges.get(edge);
      if (end === undefined) throw new LogoTraceError("input");
      edges.delete(edge);
      if (++walked % 8192 === 0) await checkpoint(options.signal);
      if (end === start) break;
      const nextDirection = [(direction + 1) % 4, direction, (direction + 3) % 4, (direction + 2) % 4]
        .find(d => edges.has(end * 4 + d));
      if (nextDirection === undefined) throw new LogoTraceError("input");
      if (nextDirection !== direction) points.push([end % stride, Math.floor(end / stride)]);
      direction = nextDirection; edge = end * 4 + direction;
    }
    if (points.length >= 3) {
      const reduced = simplify(points, options.tolerance ?? Math.max(0.75, Math.max(width, height) / 640));
      if (reduced.length >= 3) contours.push(encodeContour(reduced, options.curve ?? "polygon"));
    }
  }
  return contours.join("");
}
