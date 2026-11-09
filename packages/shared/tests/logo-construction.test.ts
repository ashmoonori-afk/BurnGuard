import { describe, expect, test } from "bun:test";
import {
  LOGO_CONSTRUCTION_FILL_MS,
  LOGO_CONSTRUCTION_STEPS,
  LOGO_CONSTRUCTION_STROKE_MS,
  compileLogoGeometry,
  logoConstructionProgress,
  logoConstructionTimeline,
  parseLogoGeometryV1,
  renderLogoConstruction,
} from "../src/index";

// A two-bowl B drawn for this test: a stem, two bowls cut by the stem edge, two counters.
const B = parseLogoGeometryV1({
  schema_version: 1,
  grid: 64,
  radii: [{ id: "bowl", value: 10 }, { id: "counter", value: 4 }],
  primitives: [
    { kind: "rect", id: "stem", x: 16, y: 12, width: 8, height: 40 },
    { kind: "line", id: "edge", from: [24, 64], to: [24, 0] },
    { kind: "circle", id: "upper", cx: 32, cy: 22, r: "bowl" },
    { kind: "circle", id: "lower", cx: 32, cy: 42, r: "bowl" },
    { kind: "circle", id: "upper-counter", cx: 32, cy: 22, r: "counter" },
    { kind: "circle", id: "lower-counter", cx: 32, cy: 42, r: "counter" },
  ],
  tree: {
    op: "union",
    args: [
      { ref: "stem" },
      { op: "subtract", args: [{ op: "intersect", args: [{ ref: "upper" }, { ref: "edge" }] }, { ref: "upper-counter" }] },
      { op: "subtract", args: [{ op: "intersect", args: [{ ref: "lower" }, { ref: "edge" }] }, { ref: "lower-counter" }] },
    ],
  },
}).geometry;
const compiled = compileLogoGeometry(B);
const light = { theme: "light", label: "B construction" } as const;
const sha = (text: string): string => new Bun.CryptoHasher("sha256").update(text).digest("hex");

describe("logo construction timeline", () => {
  const timeline = logoConstructionTimeline(B, compiled);

  test("Given the B, when it is scheduled, then the steps run in build order, each after the one before has drawn in", () => {
    const steps = timeline.items.map((item) => item.step);
    const order = steps.filter((step, index) => step !== steps[index - 1]);
    expect(order).toEqual([...LOGO_CONSTRUCTION_STEPS]);
    for (let index = 1; index < timeline.items.length; index++) {
      const previous = timeline.items[index - 1];
      const item = timeline.items[index];
      if (item.step === previous.step) expect(item.start_ms).toBeGreaterThan(previous.start_ms);
      else expect(item.start_ms).toBe(Math.max(...timeline.items.filter((other) => other.step === previous.step).map((other) => other.end_ms)));
    }
    expect(timeline.duration_ms).toBe(timeline.items[timeline.items.length - 1].end_ms);
  });

  test("Given the B, when it is scheduled, then every stroke fits 400 ms and the one fill 300 ms", () => {
    for (const item of timeline.items) {
      const length = item.end_ms - item.start_ms;
      expect(length).toBeLessThanOrEqual(item.step === "fill" ? LOGO_CONSTRUCTION_FILL_MS : LOGO_CONSTRUCTION_STROKE_MS);
    }
    expect(timeline.items.filter((item) => item.step === "fill")).toHaveLength(1);
  });

  test("Given the B, when it is scheduled, then it has one outline per loop, one point per vertex and one stroke per circle", () => {
    expect(timeline.items.filter((item) => item.step === "outline")).toHaveLength(compiled.loops.length);
    expect(timeline.items.filter((item) => item.step === "points")).toHaveLength(compiled.vertices.length);
    expect(timeline.items.filter((item) => item.step === "circles")).toHaveLength(4);
  });

  test("Given reduced motion or an out-of-range clock, when progress is read, then it is the final frame or clamped", () => {
    expect(logoConstructionProgress(0, timeline, true)).toBe(1);
    expect(logoConstructionProgress(-50, timeline, false)).toBe(0);
    expect(logoConstructionProgress(timeline.duration_ms / 2, timeline, false)).toBe(0.5);
    expect(logoConstructionProgress(timeline.duration_ms * 3, timeline, false)).toBe(1);
  });
});

describe("renderLogoConstruction", () => {
  test("Given the B, when frames t = 0, 0.5 and 1 are rendered, then their hashes are fixed", () => {
    expect(sha(renderLogoConstruction(B, compiled, 0, light))).toBe("6f358b94c33d89e5598c8047bdef83ef7815b3e3b6c1f832b1b51bf5a0c8d7b8");
    expect(sha(renderLogoConstruction(B, compiled, 0.5, light))).toBe("e3d8e76930806f94079561aa4da3ec2e154605fdc3e0d8e1f4aa5e91d990b7ff");
    expect(sha(renderLogoConstruction(B, compiled, 1, light))).toBe("0f75079b6ec6a27ea1e700fcb8b128e564fe17b942c19b1339d5b85e2903eef7");
  });

  test("Given t = 0, when it is rendered, then the artboard is empty and the fill hidden", () => {
    const first = renderLogoConstruction(B, compiled, 0, light);
    expect(first).toContain('fill-opacity="0"');
    expect(first).not.toContain("stroke-dasharray");
    expect(first).not.toContain("<circle");
  });

  test("Given t = 1 or later, when it is rendered, then every stroke is fully drawn over the compiled outline", () => {
    const last = renderLogoConstruction(B, compiled, 1, light);
    expect(last).toContain('fill-opacity="1"');
    expect(last).not.toMatch(/stroke-dashoffset="(?!0")/);
    expect(last).toContain(`d="${compiled.path}"`);
    expect(renderLogoConstruction(B, compiled, 7, light)).toBe(last);
  });

  test("Given a growing t, when frames are rendered, then each shows at least as much of the sheet", () => {
    const strokes = (t: number): number => (renderLogoConstruction(B, compiled, t, light).match(/<path|<circle/g) ?? []).length;
    expect(strokes(0.25)).toBeGreaterThan(strokes(0));
    expect(strokes(0.75)).toBeGreaterThan(strokes(0.25));
    expect(strokes(1)).toBeGreaterThanOrEqual(strokes(0.75));
  });

  test("Given the dark theme or a hostile label, when rendered, then only colours change and the label is escaped", () => {
    const shape = (svg: string): string => svg.replace(/#[0-9a-f]{6}/g, "#");
    const dark = renderLogoConstruction(B, compiled, 1, { theme: "dark", label: "B construction" });
    expect(dark).not.toBe(renderLogoConstruction(B, compiled, 1, light));
    expect(shape(dark)).toBe(shape(renderLogoConstruction(B, compiled, 1, light)));
    expect(renderLogoConstruction(B, compiled, 1, { theme: "light", label: 'A "<b>" & c' })).toContain('aria-label="A &quot;&lt;b&gt;&quot; &amp; c"');
  });
});
