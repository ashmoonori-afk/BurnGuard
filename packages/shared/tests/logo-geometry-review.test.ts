import { describe, expect, test } from "bun:test";
import { LOGO_GEOMETRY_GRID, type LogoGeometryV1 } from "../src/logo-geometry";
import { compileLogoGeometry } from "../src/logo-geometry-compile";
import { LOGO_GEOMETRY_NEAR_TOUCH, reviewLogoGeometry, type LogoGeometryFinding } from "../src/logo-geometry-review";

function geometry(parts: Pick<LogoGeometryV1, "radii" | "primitives" | "tree">): LogoGeometryV1 {
  return { schema_version: 1, grid: LOGO_GEOMETRY_GRID, optical: [], ...parts };
}

function review(record: LogoGeometryV1) {
  return reviewLogoGeometry(record, compileLogoGeometry(record));
}

const kinds = (findings: readonly LogoGeometryFinding[]): string[] => [...new Set(findings.map((finding) => finding.kind))].sort();

// The two-bowl B from the compiler goldens: bowls touch at one point, counters are wide open.
const twoBowlB = geometry({
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
});

const disc = (pin: { cx: number; cy: number }) => geometry({
  radii: [{ id: "disc", value: 20 }, { id: "pin", value: 1.5 }],
  primitives: [{ kind: "circle", id: "disc", cx: 32, cy: 32, r: "disc" }, { kind: "circle", id: "pin", ...pin, r: "pin" }],
  tree: { op: "subtract", args: [{ ref: "disc" }, { ref: "pin" }] },
});

describe("reviewLogoGeometry", () => {
  test("Given the two-bowl B When reviewed Then it passes with no findings", () => {
    expect(review(twoBowlB)).toEqual({ passed: true, findings: [] });
  });

  test("Given a planted 0.3-unit sliver When reviewed Then every nick is reported and the review fails", () => {
    const poke = geometry({
      radii: [{ id: "r", value: 13.93 }],
      primitives: [{ kind: "rect", id: "box", x: 20, y: 20, width: 20, height: 20 }, { kind: "circle", id: "disc", cx: 30, cy: 30, r: "r" }],
      tree: { op: "union", args: [{ ref: "box" }, { ref: "disc" }] },
    });
    const result = review(poke);
    expect(result.passed).toBe(false);
    const slivers = result.findings.filter((finding) => finding.kind === "sliver");
    expect(slivers).toHaveLength(8);
    for (const sliver of slivers) expect(sliver).toMatchObject({ on: ["box"], length: 0.302 });
    // The nicks also put a second guide 0.3 units beside each box edge.
    expect(kinds(result.findings)).toEqual(["duplicate_guide", "sliver"]);
  });

  test("Given two circles that miss each other by 0.119 units When reviewed Then one near touch is reported and no counter", () => {
    const near = geometry({
      radii: [{ id: "a", value: 6 }, { id: "b", value: 6.5 }],
      primitives: [{ kind: "circle", id: "left", cx: 20, cy: 20, r: "a" }, { kind: "circle", id: "right", cx: 30.5, cy: 27, r: "b" }],
      tree: { op: "union", args: [{ ref: "left" }, { ref: "right" }] },
    });
    expect(review(near).findings).toEqual([{ kind: "near_touch", on: ["left", "right"], gap: 0.119 }]);
  });

  test("Given a box edge a quarter unit short of a circle When reviewed Then the near touch names both shapes and its guides double", () => {
    const record = geometry({
      radii: [{ id: "r", value: 6.25 }],
      primitives: [{ kind: "rect", id: "box", x: 10, y: 20, width: 10, height: 10 }, { kind: "circle", id: "dot", cx: 26.5, cy: 25, r: "r" }],
      tree: { op: "union", args: [{ ref: "box" }, { ref: "dot" }] },
    });
    expect(review(record).findings).toEqual([
      { kind: "near_touch", on: ["box", "dot"], gap: 0.25 },
      { kind: "duplicate_guide", axis: "x", values: [20, 20.25] },
    ]);
  });

  test("Given circles that touch exactly or stand well apart When reviewed Then neither is a near touch", () => {
    const record = geometry({
      radii: [{ id: "r", value: 6 }],
      primitives: [
        { kind: "circle", id: "a", cx: 20, cy: 20, r: "r" },
        { kind: "circle", id: "b", cx: 32, cy: 20, r: "r" },
        { kind: "circle", id: "c", cx: 20, cy: 32 + LOGO_GEOMETRY_NEAR_TOUCH * 2, r: "r" },
      ],
      tree: { op: "union", args: [{ ref: "a" }, { ref: "b" }, { ref: "c" }] },
    });
    expect(review(record).findings).toEqual([]);
  });

  test("Given a 3-unit hole on a pixel corner When reviewed Then it fills in at 16 and at 32 px", () => {
    expect(review(disc({ cx: 32, cy: 32 })).findings).toEqual([
      { kind: "closed_counter", size: 16, at: { x: 32, y: 32 } },
      { kind: "closed_counter", size: 32, at: { x: 32, y: 32 } },
    ]);
  });

  test("Given the same hole centred on a 32 px pixel When reviewed Then it fills in at 16 px only", () => {
    expect(review(disc({ cx: 33, cy: 33 })).findings).toEqual([{ kind: "closed_counter", size: 16, at: { x: 33, y: 33 } }]);
  });

  test("Given one record When reviewed twice Then the findings are identical", () => {
    const record = disc({ cx: 33, cy: 33 });
    expect(JSON.stringify(review(record))).toBe(JSON.stringify(review(record)));
  });
});
