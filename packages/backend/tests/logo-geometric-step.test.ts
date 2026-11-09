import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LOGO_FILES, LOGO_GEOMETRIC_ANSWERS_FILE, LOGO_GEOMETRY_FILE, compileLogoGeometry, serializeLogoGeometricAnswers } from "@bg/shared";
import { createCanvas, loadImage } from "../src/services/export-native-modules";
import {
  LOGO_GEOMETRIC_APPROVALS_FILE,
  LOGO_GEOMETRIC_SYMBOL_RENDERS,
  LOGO_GEOMETRIC_SYMBOL_REVIEW_FILE,
  finishLogoGeometricSymbol,
  readLogoGeometricState,
  recordLogoGeometricApproval,
  renderLogoGeometricSymbol,
} from "../src/services/logo-geometric-step";

const sha = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
const A = "a".repeat(64);

// The two-bowl B from the compiler goldens.
const twoBowlB = {
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
  optical: [],
};

const dirs: string[] = [];
async function project(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `bg-logo-geometric-${process.pid}-`));
  dirs.push(dir);
  for (const [relative, bytes] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, relative)), { recursive: true });
    await writeFile(path.join(dir, relative), bytes);
  }
  return dir;
}
const exists = (target: string): Promise<boolean> => stat(target).then(() => true, () => false);

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("readLogoGeometricState", () => {
  test("Given an empty project When read Then nothing is answered, made or approved", async () => {
    const state = await readLogoGeometricState(await project());
    expect(state).toEqual({
      answers: null,
      steps: {
        symbol: { record_sha256: null, approved_sha256: null },
        wordmark: { record_sha256: null, approved_sha256: null },
        lockup: { record_sha256: null, approved_sha256: null },
      },
    });
  });

  test("Given answers, a symbol record and an approval When read Then the hashes are of the bytes on disk", async () => {
    const record = JSON.stringify(twoBowlB);
    const answers = serializeLogoGeometricAnswers({ schema_version: 1, parts: { choice: "symbol" }, direction: { choice: "auto" } });
    const dir = await project({ [LOGO_GEOMETRIC_ANSWERS_FILE]: answers, [LOGO_GEOMETRY_FILE]: record });
    await recordLogoGeometricApproval(dir, "symbol", sha(record));
    const state = await readLogoGeometricState(dir);
    expect(state.answers?.parts).toEqual({ choice: "symbol" });
    expect(state.steps.symbol).toEqual({ record_sha256: sha(record), approved_sha256: sha(record) });
  });

  test("Given malformed answers and approvals When read Then both count as absent", async () => {
    const dir = await project({
      [LOGO_GEOMETRIC_ANSWERS_FILE]: JSON.stringify({ schema_version: 1, parts: { choice: "all" }, direction: { choice: "auto" } }),
      [LOGO_GEOMETRIC_APPROVALS_FILE]: JSON.stringify({ schema_version: 1, approvals: { symbol: A, tagline: A } }),
    });
    const state = await readLogoGeometricState(dir);
    expect(state.answers).toBeNull();
    expect(state.steps.symbol.approved_sha256).toBeNull();
  });

  test("Given a record hard-linked from elsewhere When read Then it is not counted as made", async () => {
    const dir = await project({ "outside.json": JSON.stringify(twoBowlB) });
    await link(path.join(dir, "outside.json"), path.join(dir, LOGO_GEOMETRY_FILE));
    expect((await readLogoGeometricState(dir)).steps.symbol.record_sha256).toBeNull();
  });
});

describe("recordLogoGeometricApproval", () => {
  test("Given an approval for one step When another is recorded Then both are kept in flow order as canonical bytes", async () => {
    const dir = await project();
    await recordLogoGeometricApproval(dir, "wordmark", "b".repeat(64));
    await recordLogoGeometricApproval(dir, "symbol", A);
    expect(await readFile(path.join(dir, LOGO_GEOMETRIC_APPROVALS_FILE), "utf8"))
      .toBe(`${JSON.stringify({ schema_version: 1, approvals: { symbol: A, wordmark: "b".repeat(64) } }, null, 2)}\n`);
  });
});

describe("finishLogoGeometricSymbol", () => {
  test("Given the two-bowl B When finished Then logo.svg holds the compiled path and the review passes for these bytes", async () => {
    const record = JSON.stringify(twoBowlB);
    const dir = await project({ [LOGO_GEOMETRY_FILE]: record });
    const outcome = await finishLogoGeometricSymbol(dir, "Brand \"B\" <mark>");
    expect(outcome.kind).toBe("compiled");
    const svg = await readFile(path.join(dir, LOGO_FILES.logo), "utf8");
    expect(svg).toContain(`d="${compileLogoGeometry(JSON.parse(record)).path}"`);
    expect(svg).toContain(`aria-label="Brand &quot;B&quot; &lt;mark&gt;"`);
    const review = JSON.parse(await readFile(path.join(dir, LOGO_GEOMETRIC_SYMBOL_REVIEW_FILE), "utf8"));
    expect(review).toEqual({ schema_version: 1, record_sha256: sha(record), passed: true, findings: [], snapped: [] });
  });

  test("Given a record with a planted sliver and an off-grid centre When finished Then the review fails and names both", async () => {
    const record = JSON.stringify({
      schema_version: 1, grid: 64, optical: [],
      radii: [{ id: "r", value: 13.93 }],
      primitives: [{ kind: "rect", id: "box", x: 20, y: 20, width: 20, height: 20 }, { kind: "circle", id: "disc", cx: 30.2, cy: 30, r: "r" }],
      tree: { op: "union", args: [{ ref: "box" }, { ref: "disc" }] },
    });
    const outcome = await finishLogoGeometricSymbol(await project({ [LOGO_GEOMETRY_FILE]: record }), "B");
    if (outcome.kind !== "compiled") throw new Error(`expected a compiled record, got ${outcome.code}`);
    expect(outcome.review.passed).toBe(false);
    expect(outcome.review.findings.some((finding) => finding.kind === "sliver")).toBe(true);
    expect(outcome.review.snapped).toEqual(["$.primitives[1].cx"]);
  });

  test("Given a missing, broken or empty record When finished Then it is refused with a stable code and nothing is written", async () => {
    const empty = JSON.stringify({ ...twoBowlB, tree: { op: "intersect", args: [{ ref: "upper-counter" }, { ref: "lower-counter" }, { ref: "stem" }, { ref: "edge" }, { ref: "upper" }, { ref: "lower" }] } });
    const cases: [Record<string, string>, string][] = [[{}, "record_missing"], [{ [LOGO_GEOMETRY_FILE]: "{not json" }, "invalid_json"], [{ [LOGO_GEOMETRY_FILE]: empty }, "empty_shape"]];
    for (const [files, code] of cases) {
      const dir = await project(files);
      expect(await finishLogoGeometricSymbol(dir, "B")).toMatchObject({ kind: "refused", code });
      expect(await exists(path.join(dir, LOGO_FILES.logo))).toBe(false);
      expect(await exists(path.join(dir, LOGO_GEOMETRIC_SYMBOL_REVIEW_FILE))).toBe(false);
    }
  });
});

describe("renderLogoGeometricSymbol", () => {
  test("Given the two-bowl B When rendered Then the three review images have their sizes and show the stem as ink and a counter as paper", async () => {
    const dir = await project({ [LOGO_GEOMETRY_FILE]: JSON.stringify(twoBowlB) });
    const outcome = await finishLogoGeometricSymbol(dir, "B");
    if (outcome.kind !== "compiled") throw new Error(`expected a compiled record, got ${outcome.code}`);
    await renderLogoGeometricSymbol(dir, outcome.geometry, outcome.compiled, "B");
    const pixel = async (file: string, size: number, x: number, y: number): Promise<number> => {
      const image = await loadImage(await readFile(path.join(dir, file)));
      expect([image.width, image.height]).toEqual([size, size]);
      const canvas = createCanvas(size, size);
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return context.getImageData(Math.floor((x / 64) * size), Math.floor((y / 64) * size), 1, 1).data[0]!;
    };
    const { mark, small, construction } = LOGO_GEOMETRIC_SYMBOL_RENDERS;
    expect(await pixel(mark.file, mark.size, 20, 32)).toBeLessThan(64);
    expect(await pixel(mark.file, mark.size, 32, 22)).toBeGreaterThan(192);
    // Sharp at full size: a tenth of a grid unit either side of the stem's left edge is ink and paper.
    expect(await pixel(mark.file, mark.size, 16.1, 32)).toBeLessThan(64);
    expect(await pixel(mark.file, mark.size, 15.9, 32)).toBeGreaterThan(192);
    expect(await pixel(small.file, small.size, 20, 32)).toBeLessThan(128);
    expect(await pixel(construction.file, construction.size, 20, 32)).toBeLessThan(128);
  });
});
