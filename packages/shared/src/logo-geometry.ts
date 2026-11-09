/**
 * LogoGeometryV1, the only source of a geometric mark (doc/25-logo-geometry-2026-11-09.md).
 *
 * A symbol is a boolean tree over circles, half-planes, rectangles and polygons on a 64-unit
 * artboard. The outline path, the construction drawing and every export are computed from this
 * record, never drawn beside it, so the construction cannot disagree with the mark. The vocabulary
 * is small on purpose: no Bezier curves, at most twelve primitives, a tree at most four deep, and
 * every centre and line point on the half-unit grid. Radii are named once and referenced by id, so
 * two equal radii are one visible fact instead of two numbers that happen to match.
 */

export const LOGO_GEOMETRY_FILE = "logo-geometry.json";
export const LOGO_GEOMETRY_GRID = 64;
/** Centres, line points and rectangle edges snap to this step. */
export const LOGO_GEOMETRY_SNAP = 0.5;
export const LOGO_GEOMETRY_MAX_PRIMITIVES = 12;
export const LOGO_GEOMETRY_MAX_DEPTH = 4;
export const LOGO_GEOMETRY_MAX_RADII = 12;
export const LOGO_GEOMETRY_MAX_POLYGON_POINTS = 8;
/** An overshoot is an optical correction, not a second radius: at most one unit. */
export const LOGO_GEOMETRY_MAX_OVERSHOOT = 1;
/** Reserved: the compiler clips every mark to the artboard and names that boundary this way. */
export const LOGO_GEOMETRY_ARTBOARD_ID = "artboard";

export type LogoGeometryPoint = readonly [number, number];

export interface LogoGeometryRadius {
  readonly id: string;
  readonly value: number;
}

export type LogoGeometryPrimitive =
  | { readonly kind: "circle"; readonly id: string; readonly cx: number; readonly cy: number; readonly r: string }
  /**
   * A half-plane. Inside is the side to the right of the direction `from` -> `to` as drawn on
   * screen (y grows downward), i.e. where `(to.x - from.x) * (p.y - from.y) - (to.y - from.y) * (p.x - from.x) > 0`.
   */
  | { readonly kind: "line"; readonly id: string; readonly from: LogoGeometryPoint; readonly to: LogoGeometryPoint }
  | { readonly kind: "rect"; readonly id: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly kind: "polygon"; readonly id: string; readonly points: readonly LogoGeometryPoint[] };

export type LogoGeometryOperation = "union" | "subtract" | "intersect";

/** `subtract` removes every later argument from the first one. */
export type LogoGeometryNode =
  | { readonly ref: string }
  | { readonly op: LogoGeometryOperation; readonly args: readonly LogoGeometryNode[] };

/** Named optical corrections. The construction view shows them; they are never silent. */
export type LogoGeometryOptical =
  | { readonly kind: "overshoot"; readonly primitive: string; readonly amount: number }
  | { readonly kind: "notch"; readonly primitive: string };

export interface LogoGeometryV1 {
  readonly schema_version: 1;
  readonly grid: typeof LOGO_GEOMETRY_GRID;
  readonly radii: readonly LogoGeometryRadius[];
  readonly primitives: readonly LogoGeometryPrimitive[];
  readonly tree: LogoGeometryNode;
  readonly optical: readonly LogoGeometryOptical[];
}

export interface LogoGeometryParseResult {
  readonly geometry: LogoGeometryV1;
  /** JSON paths of the coordinates moved onto the grid, so the model is told what changed. */
  readonly snapped: readonly string[];
}

export type LogoGeometryErrorCode =
  | "invalid_json"
  | "expected_object"
  | "unknown_field"
  | "missing_field"
  | "invalid_field"
  | "out_of_range"
  | "duplicate_id"
  | "unknown_reference"
  | "unused_primitive"
  | "too_many_primitives"
  | "tree_too_deep";

/** A refusal with a stable code and the JSON path it concerns; both are safe to hand back to the model. */
export class LogoGeometryError extends Error {
  readonly name = "LogoGeometryError";

  constructor(
    readonly code: LogoGeometryErrorCode,
    readonly path: string,
  ) {
    super(`${code} at ${path}`);
  }
}

const ID = /^[a-z][a-z0-9_-]{0,23}$/;
const OPERATIONS: readonly LogoGeometryOperation[] = ["union", "subtract", "intersect"];

type Rec = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Rec {
  if (!isRecord(value)) throw new LogoGeometryError("expected_object", path);
  return value;
}

function exactKeys(value: Rec, path: string, required: readonly string[], optional: readonly string[] = []): void {
  for (const key of required) if (!(key in value)) throw new LogoGeometryError("missing_field", `${path}.${key}`);
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) throw new LogoGeometryError("unknown_field", `${path}.${key}`);
  }
}

function array(value: unknown, path: string, min: number, max: number): readonly unknown[] {
  if (!Array.isArray(value)) throw new LogoGeometryError("invalid_field", path);
  if (value.length < min || value.length > max) throw new LogoGeometryError("out_of_range", path);
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new LogoGeometryError("invalid_field", path);
  return value;
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !ID.test(value) || value === LOGO_GEOMETRY_ARTBOARD_ID) throw new LogoGeometryError("invalid_field", path);
  return value;
}

class Snapper {
  readonly snapped: string[] = [];

  /** A coordinate on the artboard, moved to the nearest half unit. */
  coordinate(value: unknown, path: string): number {
    const number = finite(value, path);
    if (number < 0 || number > LOGO_GEOMETRY_GRID) throw new LogoGeometryError("out_of_range", path);
    const snapped = Math.round(number / LOGO_GEOMETRY_SNAP) * LOGO_GEOMETRY_SNAP;
    if (snapped !== number) this.snapped.push(path);
    return snapped;
  }

  point(value: unknown, path: string): LogoGeometryPoint {
    const pair = array(value, path, 2, 2);
    return [this.coordinate(pair[0], `${path}[0]`), this.coordinate(pair[1], `${path}[1]`)];
  }
}

function parseRadius(value: unknown, path: string): LogoGeometryRadius {
  const item = record(value, path);
  exactKeys(item, path, ["id", "value"]);
  const radius = finite(item.value, `${path}.value`);
  if (radius <= 0 || radius > LOGO_GEOMETRY_GRID / 2) throw new LogoGeometryError("out_of_range", `${path}.value`);
  return { id: identifier(item.id, `${path}.id`), value: radius };
}

function parsePrimitive(value: unknown, path: string, snap: Snapper, radii: ReadonlySet<string>): LogoGeometryPrimitive {
  const item = record(value, path);
  const id = identifier(item.id, `${path}.id`);
  switch (item.kind) {
    case "circle": {
      exactKeys(item, path, ["kind", "id", "cx", "cy", "r"]);
      if (typeof item.r !== "string" || !radii.has(item.r)) throw new LogoGeometryError("unknown_reference", `${path}.r`);
      return { kind: "circle", id, cx: snap.coordinate(item.cx, `${path}.cx`), cy: snap.coordinate(item.cy, `${path}.cy`), r: item.r };
    }
    case "line": {
      exactKeys(item, path, ["kind", "id", "from", "to"]);
      const from = snap.point(item.from, `${path}.from`);
      const to = snap.point(item.to, `${path}.to`);
      if (from[0] === to[0] && from[1] === to[1]) throw new LogoGeometryError("invalid_field", `${path}.to`);
      return { kind: "line", id, from, to };
    }
    case "rect": {
      exactKeys(item, path, ["kind", "id", "x", "y", "width", "height"]);
      const x = snap.coordinate(item.x, `${path}.x`);
      const y = snap.coordinate(item.y, `${path}.y`);
      const width = snap.coordinate(item.width, `${path}.width`);
      const height = snap.coordinate(item.height, `${path}.height`);
      if (width <= 0 || height <= 0 || x + width > LOGO_GEOMETRY_GRID || y + height > LOGO_GEOMETRY_GRID) {
        throw new LogoGeometryError("out_of_range", path);
      }
      return { kind: "rect", id, x, y, width, height };
    }
    case "polygon": {
      exactKeys(item, path, ["kind", "id", "points"]);
      const points = array(item.points, `${path}.points`, 3, LOGO_GEOMETRY_MAX_POLYGON_POINTS)
        .map((point, index) => snap.point(point, `${path}.points[${index}]`));
      let twiceArea = 0;
      for (let index = 0; index < points.length; index += 1) {
        const [ax, ay] = points[index];
        const [bx, by] = points[(index + 1) % points.length];
        twiceArea += ax * by - bx * ay;
      }
      if (twiceArea === 0) throw new LogoGeometryError("invalid_field", `${path}.points`);
      return { kind: "polygon", id, points };
    }
    default:
      throw new LogoGeometryError("invalid_field", `${path}.kind`);
  }
}

function parseNode(value: unknown, path: string, depth: number, primitives: ReadonlySet<string>, used: Set<string>): LogoGeometryNode {
  if (depth > LOGO_GEOMETRY_MAX_DEPTH) throw new LogoGeometryError("tree_too_deep", path);
  const node = record(value, path);
  if ("ref" in node) {
    exactKeys(node, path, ["ref"]);
    if (typeof node.ref !== "string" || !primitives.has(node.ref)) throw new LogoGeometryError("unknown_reference", `${path}.ref`);
    used.add(node.ref);
    return { ref: node.ref };
  }
  exactKeys(node, path, ["op", "args"]);
  if (typeof node.op !== "string" || !OPERATIONS.includes(node.op as LogoGeometryOperation)) {
    throw new LogoGeometryError("invalid_field", `${path}.op`);
  }
  const args = array(node.args, `${path}.args`, 2, LOGO_GEOMETRY_MAX_PRIMITIVES)
    .map((arg, index) => parseNode(arg, `${path}.args[${index}]`, depth + 1, primitives, used));
  return { op: node.op as LogoGeometryOperation, args };
}

function parseOptical(value: unknown, path: string, kinds: ReadonlyMap<string, LogoGeometryPrimitive["kind"]>): LogoGeometryOptical {
  const item = record(value, path);
  if (typeof item.primitive !== "string" || !kinds.has(item.primitive)) throw new LogoGeometryError("unknown_reference", `${path}.primitive`);
  if (item.kind === "overshoot") {
    exactKeys(item, path, ["kind", "primitive", "amount"]);
    if (kinds.get(item.primitive) !== "circle") throw new LogoGeometryError("invalid_field", `${path}.primitive`);
    const amount = finite(item.amount, `${path}.amount`);
    if (amount <= 0 || amount > LOGO_GEOMETRY_MAX_OVERSHOOT) throw new LogoGeometryError("out_of_range", `${path}.amount`);
    return { kind: "overshoot", primitive: item.primitive, amount };
  }
  if (item.kind === "notch") {
    exactKeys(item, path, ["kind", "primitive"]);
    return { kind: "notch", primitive: item.primitive };
  }
  throw new LogoGeometryError("invalid_field", `${path}.kind`);
}

/**
 * Parses an authored geometry record. Unknown keys, unknown references, primitives nothing uses
 * and off-artboard coordinates are refused with a code and a path; coordinates off the half-unit
 * grid are snapped and listed in `snapped`. A notch primitive is subtracted from the whole mark and
 * must not also appear in the tree.
 */
export function parseLogoGeometryV1(input: unknown): LogoGeometryParseResult {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch (error) {
      if (error instanceof SyntaxError) throw new LogoGeometryError("invalid_json", "$");
      throw error;
    }
  }
  const root = record(value, "$");
  exactKeys(root, "$", ["schema_version", "grid", "radii", "primitives", "tree"], ["optical"]);
  if (root.schema_version !== 1) throw new LogoGeometryError("invalid_field", "$.schema_version");
  if (root.grid !== LOGO_GEOMETRY_GRID) throw new LogoGeometryError("invalid_field", "$.grid");

  const radii = array(root.radii, "$.radii", 0, LOGO_GEOMETRY_MAX_RADII).map((item, index) => parseRadius(item, `$.radii[${index}]`));
  const radiusIds = new Set<string>();
  radii.forEach((radius, index) => {
    if (radiusIds.has(radius.id)) throw new LogoGeometryError("duplicate_id", `$.radii[${index}].id`);
    radiusIds.add(radius.id);
  });

  const snap = new Snapper();
  if (Array.isArray(root.primitives) && root.primitives.length > LOGO_GEOMETRY_MAX_PRIMITIVES) {
    throw new LogoGeometryError("too_many_primitives", "$.primitives");
  }
  const primitives = array(root.primitives, "$.primitives", 1, LOGO_GEOMETRY_MAX_PRIMITIVES)
    .map((item, index) => parsePrimitive(item, `$.primitives[${index}]`, snap, radiusIds));
  const kinds = new Map<string, LogoGeometryPrimitive["kind"]>();
  primitives.forEach((primitive, index) => {
    if (kinds.has(primitive.id) || radiusIds.has(primitive.id)) throw new LogoGeometryError("duplicate_id", `$.primitives[${index}].id`);
    kinds.set(primitive.id, primitive.kind);
  });

  const inTree = new Set<string>();
  const tree = parseNode(root.tree, "$.tree", 1, new Set(kinds.keys()), inTree);
  const optical = root.optical === undefined ? [] : array(root.optical, "$.optical", 0, LOGO_GEOMETRY_MAX_PRIMITIVES)
    .map((item, index) => parseOptical(item, `$.optical[${index}]`, kinds));

  const notched = new Set<string>();
  const overshot = new Set<string>();
  optical.forEach((correction, index) => {
    const seen = correction.kind === "notch" ? notched : overshot;
    if (seen.has(correction.primitive)) throw new LogoGeometryError("duplicate_id", `$.optical[${index}].primitive`);
    if (correction.kind === "notch" && inTree.has(correction.primitive)) throw new LogoGeometryError("invalid_field", `$.optical[${index}].primitive`);
    seen.add(correction.primitive);
  });
  primitives.forEach((primitive, index) => {
    if (!inTree.has(primitive.id) && !notched.has(primitive.id)) throw new LogoGeometryError("unused_primitive", `$.primitives[${index}]`);
  });
  const usedRadii = new Set(primitives.flatMap((primitive) => primitive.kind === "circle" ? [primitive.r] : []));
  radii.forEach((radius, index) => {
    if (!usedRadii.has(radius.id)) throw new LogoGeometryError("unused_primitive", `$.radii[${index}]`);
  });

  return { geometry: { schema_version: 1, grid: LOGO_GEOMETRY_GRID, radii, primitives, tree, optical }, snapped: snap.snapped };
}
