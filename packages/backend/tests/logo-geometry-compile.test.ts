import { describe, expect, test } from "bun:test";
import { parseLogoGeometryV1, type LogoGeometryPrimitive, type LogoGeometryV1 } from "@bg/shared";
import {
  LOGO_GEOMETRY_SLIVER_LENGTH,
  LogoGeometryCompileError,
  compileLogoGeometry,
  logoGeometrySvg,
} from "../src/services/logo-geometry-compile";
import { validateLogoSvg } from "../src/services/logo-svg-validation";

/*
 * Golden marks drawn for these tests, each with an area known in closed form. None of them comes
 * from another product: the shapes are textbook constructions on the 64-unit grid.
 */

type Draft = Omit<LogoGeometryV1, "schema_version" | "grid" | "optical"> & { optical?: LogoGeometryV1["optical"] };

function geometry(draft: Draft): LogoGeometryV1 {
  return parseLogoGeometryV1({ schema_version: 1, grid: 64, ...draft }).geometry;
}

const ring = geometry({
  radii: [{ id: "outer", value: 20 }, { id: "inner", value: 12 }],
  primitives: [{ kind: "circle", id: "o", cx: 32, cy: 32, r: "outer" }, { kind: "circle", id: "i", cx: 32, cy: 32, r: "inner" }],
  tree: { op: "subtract", args: [{ ref: "o" }, { ref: "i" }] },
});

const tangentPair = geometry({
  radii: [{ id: "r", value: 10 }],
  primitives: [{ kind: "circle", id: "a", cx: 22, cy: 32, r: "r" }, { kind: "circle", id: "b", cx: 42, cy: 32, r: "r" }],
  tree: { op: "union", args: [{ ref: "a" }, { ref: "b" }] },
});

// The line runs downward at x = 24, so its inside (right of the direction on screen) is x < 24.
const cutCircle = geometry({
  radii: [{ id: "r", value: 16 }],
  primitives: [{ kind: "circle", id: "c", cx: 32, cy: 32, r: "r" }, { kind: "line", id: "h", from: [24, 0], to: [24, 64] }],
  tree: { op: "subtract", args: [{ ref: "c" }, { ref: "h" }] },
});

// A two-bowl B: a stem, two bowls kept right of the stem's edge (the line runs upward, so x > 24),
// each with a round counter. The bowls touch at (32, 32) and the chord they lose lies on the stem.
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

/** Area of the cap of a radius-r circle cut off by a chord at distance d from the centre. */
const cap = (r: number, d: number): number => r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d);

const goldens = [
  { name: "ring", geometry: ring, area: Math.PI * (20 ** 2 - 12 ** 2) },
  { name: "tangent circles", geometry: tangentPair, area: 2 * Math.PI * 100 },
  { name: "circle minus a half-plane", geometry: cutCircle, area: Math.PI * 256 - cap(16, 8) },
  { name: "two-bowl B", geometry: twoBowlB, area: 8 * 40 + 2 * (Math.PI * 100 - cap(10, 8) - Math.PI * 16) },
] as const;

/** Distance from a point to a primitive's boundary, computed from the record, not the compiler. */
function boundaryDistance(primitive: LogoGeometryPrimitive, x: number, y: number, radii: ReadonlyMap<string, number>): number {
  const toSegment = (ax: number, ay: number, bx: number, by: number): number => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
  };
  switch (primitive.kind) {
    case "circle":
      return Math.abs(Math.hypot(x - primitive.cx, y - primitive.cy) - (radii.get(primitive.r) ?? NaN));
    case "line": {
      const [fx, fy] = primitive.from;
      const [tx, ty] = primitive.to;
      return Math.abs((tx - fx) * (y - fy) - (ty - fy) * (x - fx)) / Math.hypot(tx - fx, ty - fy);
    }
    case "rect": {
      const { x: rx, y: ry, width: w, height: h } = primitive;
      return Math.min(toSegment(rx, ry, rx + w, ry), toSegment(rx + w, ry, rx + w, ry + h), toSegment(rx + w, ry + h, rx, ry + h), toSegment(rx, ry + h, rx, ry));
    }
    case "polygon":
      return Math.min(...primitive.points.map(([ax, ay], index) => {
        const [bx, by] = primitive.points[(index + 1) % primitive.points.length];
        return toSegment(ax, ay, bx, by);
      }));
  }
}

describe("golden marks", () => {
  for (const golden of goldens) {
    test(`Given the ${golden.name} When compiled Then its area matches the closed form within 1e-6`, () => {
      expect(Math.abs(compileLogoGeometry(golden.geometry).area - golden.area)).toBeLessThan(1e-6);
    });

    test(`Given the ${golden.name} When compiled Then every vertex lies on each primitive it names`, () => {
      const compiled = compileLogoGeometry(golden.geometry);
      const radii = new Map(golden.geometry.radii.map((radius) => [radius.id, radius.value]));
      const byId = new Map(golden.geometry.primitives.map((primitive) => [primitive.id, primitive]));
      for (const vertex of compiled.vertices) {
        const named = vertex.on.filter((id) => byId.has(id));
        expect(named.length).toBeGreaterThan(0);
        for (const id of named) {
          const primitive = byId.get(id);
          if (primitive === undefined) throw new Error(`unknown primitive ${id}`);
          expect(boundaryDistance(primitive, vertex.x, vertex.y, radii)).toBeLessThan(1e-9);
        }
      }
    });

    test(`Given the ${golden.name} When compiled Then the path uses only lines and arcs of declared radii and passes the vector allowlist`, () => {
      const compiled = compileLogoGeometry(golden.geometry);
      expect(compiled.path).toMatch(/^[MLAZ0-9 .-]+$/);
      const declared = golden.geometry.radii.map((radius) => radius.value);
      for (const match of compiled.path.matchAll(/A([\d.]+) ([\d.]+)/g)) {
        expect(match[1]).toBe(match[2]);
        expect(declared).toContain(Number(match[1]));
      }
      expect(() => validateLogoSvg(logoGeometrySvg(compiled, "Golden mark"))).not.toThrow();
      expect(compiled.slivers).toEqual([]);
    });
  }

  test("Given the same record compiled twice When the outputs are compared Then they are identical", () => {
    expect(compileLogoGeometry(twoBowlB)).toEqual(compileLogoGeometry(twoBowlB));
  });
});

describe("construction facts", () => {
  test("Given two circles that touch When compiled Then the touching point is one tangency naming both circles", () => {
    const compiled = compileLogoGeometry(tangentPair);
    expect(compiled.tangencies).toHaveLength(1);
    expect(compiled.tangencies[0].x).toBeCloseTo(32, 12);
    expect(compiled.tangencies[0].y).toBeCloseTo(32, 12);
    expect([...compiled.tangencies[0].on].sort()).toEqual(["a", "b"]);
  });

  test("Given the two-bowl B When compiled Then the stem chord is gone and the counters are holes", () => {
    const compiled = compileLogoGeometry(twoBowlB);
    // The bowls meet the stem along x = 24 for y in 16..28 and 36..48; nothing there is outline.
    const insideStem = compiled.loops.flat().filter((edge) => {
      const midY = (edge.from.y + edge.to.y) / 2;
      return edge.kind === "line" && Math.abs(edge.from.x - 24) < 1e-9 && Math.abs(edge.to.x - 24) < 1e-9
        && ((midY > 16 && midY < 28) || (midY > 36 && midY < 48));
    });
    expect(insideStem).toEqual([]);
    const counters = compiled.loops.filter((loop) => loop.every((edge) => edge.kind === "arc" && edge.r === 4));
    expect(counters).toHaveLength(2);
  });

  test("Given the circle cut by a line When compiled Then the guides include the cut and the circle's extremes", () => {
    const compiled = compileLogoGeometry(cutCircle);
    expect(compiled.guides.x).toEqual([24, 32, 48]);
    expect(compiled.guides.y).toEqual(expect.arrayContaining([16, 48]));
  });
});

describe("refusals and corrections", () => {
  test("Given a rectangle whose corners poke 0.3 units out of a circle When compiled Then each nick is reported as a sliver", () => {
    const poke = geometry({
      radii: [{ id: "r", value: 13.93 }],
      primitives: [{ kind: "rect", id: "box", x: 20, y: 20, width: 20, height: 20 }, { kind: "circle", id: "disc", cx: 30, cy: 30, r: "r" }],
      tree: { op: "union", args: [{ ref: "box" }, { ref: "disc" }] },
    });
    const slivers = compileLogoGeometry(poke).slivers;
    expect(slivers).toHaveLength(8);
    for (const sliver of slivers) {
      expect(sliver.length).toBeLessThan(LOGO_GEOMETRY_SLIVER_LENGTH);
      expect(sliver.length).toBeCloseTo(0.302, 3);
      expect(sliver.on).toEqual(["box"]);
    }
  });

  test("Given two circles that do not meet When intersected Then the compiler refuses an empty shape", () => {
    const apart = geometry({
      radii: [{ id: "r", value: 5 }],
      primitives: [{ kind: "circle", id: "a", cx: 10, cy: 10, r: "r" }, { kind: "circle", id: "b", cx: 50, cy: 50, r: "r" }],
      tree: { op: "intersect", args: [{ ref: "a" }, { ref: "b" }] },
    });
    expect(() => compileLogoGeometry(apart)).toThrow(LogoGeometryCompileError);
  });

  test("Given an overshoot and a notch When compiled Then the circle grows by the overshoot and the notch is removed", () => {
    const corrected = geometry({
      radii: [{ id: "r", value: 10 }, { id: "bite", value: 2 }],
      primitives: [{ kind: "circle", id: "dot", cx: 32, cy: 32, r: "r" }, { kind: "circle", id: "nick", cx: 32, cy: 22, r: "bite" }],
      tree: { ref: "dot" },
      optical: [{ kind: "overshoot", primitive: "dot", amount: 0.5 }, { kind: "notch", primitive: "nick" }],
    });
    const compiled = compileLogoGeometry(corrected);
    // The notch circle is centred 10 units up, inside the grown 10.5 disc: a lens is bitten away.
    const R = 10.5;
    const r = 2;
    const d = 10;
    const lens = r * r * Math.acos((d * d + r * r - R * R) / (2 * d * r)) + R * R * Math.acos((d * d + R * R - r * r) / (2 * d * R))
      - 0.5 * Math.sqrt((-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R));
    expect(Math.abs(compiled.area - (Math.PI * R * R - lens))).toBeLessThan(1e-6);
    expect(compiled.path).toContain("A10.5 10.5");
  });

  test("Given a half-plane alone When compiled Then the artboard bounds it", () => {
    const half = geometry({ radii: [], primitives: [{ kind: "line", id: "h", from: [32, 0], to: [32, 64] }], tree: { ref: "h" } });
    expect(Math.abs(compileLogoGeometry(half).area - 32 * 64)).toBeLessThan(1e-9);
  });
});
