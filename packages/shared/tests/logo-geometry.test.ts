import { describe, expect, test } from "bun:test";
import { LOGO_GEOMETRY_MAX_PRIMITIVES, LogoGeometryError, parseLogoGeometryV1, type LogoGeometryErrorCode } from "../src/logo-geometry";

const base = () => ({
  schema_version: 1,
  grid: 64,
  radii: [{ id: "r", value: 12 }],
  primitives: [
    { kind: "circle", id: "a", cx: 32, cy: 32, r: "r" },
    { kind: "line", id: "cut", from: [0, 40], to: [64, 40] },
  ],
  tree: { op: "subtract", args: [{ ref: "a" }, { ref: "cut" }] },
});

function refusal(input: unknown): { code: LogoGeometryErrorCode; path: string } {
  try {
    parseLogoGeometryV1(input);
  } catch (error) {
    if (error instanceof LogoGeometryError) return { code: error.code, path: error.path };
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("parseLogoGeometryV1", () => {
  test("Given a valid record as JSON text When parsed Then it round-trips with no snapping", () => {
    const result = parseLogoGeometryV1(JSON.stringify(base()));
    expect(result.snapped).toEqual([]);
    expect(result.geometry).toEqual({ ...base(), optical: [] } as never);
  });

  test("Given coordinates off the half-unit grid When parsed Then they snap and each moved path is listed", () => {
    const input = base();
    input.primitives[0] = { ...input.primitives[0], cx: 31.8, cy: 32.2 };
    const result = parseLogoGeometryV1(input);
    const circle = result.geometry.primitives[0];
    expect(circle.kind === "circle" && [circle.cx, circle.cy]).toEqual([32, 32]);
    expect(result.snapped).toEqual(["$.primitives[0].cx", "$.primitives[0].cy"]);
  });

  test.each([
    ["an unknown key", (v: ReturnType<typeof base>) => ({ ...v, colour: "red" }), "unknown_field", "$.colour"],
    ["an unknown radius", (v: ReturnType<typeof base>) => ({ ...v, primitives: [{ ...v.primitives[0], r: "missing" }, v.primitives[1]] }), "unknown_reference", "$.primitives[0].r"],
    ["an unknown tree reference", (v: ReturnType<typeof base>) => ({ ...v, tree: { op: "union", args: [{ ref: "a" }, { ref: "ghost" }] } }), "unknown_reference", "$.tree.args[1].ref"],
    ["a primitive nothing uses", (v: ReturnType<typeof base>) => ({ ...v, tree: { ref: "a" } }), "unused_primitive", "$.primitives[1]"],
    ["a radius nothing uses", (v: ReturnType<typeof base>) => ({ ...v, radii: [...v.radii, { id: "spare", value: 3 }] }), "unused_primitive", "$.radii[1]"],
    ["a duplicate id", (v: ReturnType<typeof base>) => ({ ...v, primitives: [v.primitives[0], { ...v.primitives[1], id: "a" }] }), "duplicate_id", "$.primitives[1].id"],
    ["the reserved artboard id", (v: ReturnType<typeof base>) => ({ ...v, primitives: [v.primitives[0], { ...v.primitives[1], id: "artboard" }] }), "invalid_field", "$.primitives[1].id"],
    ["a centre off the artboard", (v: ReturnType<typeof base>) => ({ ...v, primitives: [{ ...v.primitives[0], cx: 70 }, v.primitives[1]] }), "out_of_range", "$.primitives[0].cx"],
    ["a one-argument union", (v: ReturnType<typeof base>) => ({ ...v, tree: { op: "union", args: [{ ref: "a" }] } }), "out_of_range", "$.tree.args"],
    ["a Bezier primitive", (v: ReturnType<typeof base>) => ({ ...v, primitives: [v.primitives[0], { kind: "bezier", id: "cut" }] }), "invalid_field", "$.primitives[1].kind"],
    ["a notch also used in the tree", (v: ReturnType<typeof base>) => ({ ...v, optical: [{ kind: "notch", primitive: "cut" }] }), "invalid_field", "$.optical[0].primitive"],
    ["an overshoot on a line", (v: ReturnType<typeof base>) => ({ ...v, optical: [{ kind: "overshoot", primitive: "cut", amount: 0.5 }] }), "invalid_field", "$.optical[0].primitive"],
    ["an overshoot over one unit", (v: ReturnType<typeof base>) => ({ ...v, optical: [{ kind: "overshoot", primitive: "a", amount: 1.5 }] }), "out_of_range", "$.optical[0].amount"],
    ["a line of zero length", (v: ReturnType<typeof base>) => ({ ...v, primitives: [v.primitives[0], { kind: "line", id: "cut", from: [10, 10], to: [10.1, 10.1] }] }), "invalid_field", "$.primitives[1].to"],
  ] as const)("Given %s When parsed Then it is refused with a code and a path", (_name, mutate, code, path) => {
    expect(refusal(mutate(base()))).toEqual({ code, path });
  });

  test("Given more primitives than the limit When parsed Then it is refused as too many", () => {
    const primitives = Array.from({ length: LOGO_GEOMETRY_MAX_PRIMITIVES + 1 }, (_, index) => ({ kind: "circle", id: `c${index}`, cx: 32, cy: 32, r: "r" }));
    expect(refusal({ ...base(), primitives, tree: { op: "union", args: primitives.map((p) => ({ ref: p.id })) } }).code).toBe("too_many_primitives");
  });

  test("Given a tree five levels deep When parsed Then it is refused as too deep", () => {
    const deep = { op: "union", args: [{ op: "union", args: [{ op: "union", args: [{ op: "union", args: [{ ref: "a" }, { ref: "cut" }] }, { ref: "a" }] }, { ref: "a" }] }, { ref: "a" }] };
    expect(refusal({ ...base(), tree: deep })).toEqual({ code: "tree_too_deep", path: "$.tree.args[0].args[0].args[0].args[0]" });
  });

  test("Given text that is not JSON When parsed Then it is refused as invalid JSON", () => {
    expect(refusal("{not json")).toEqual({ code: "invalid_json", path: "$" });
  });
});
