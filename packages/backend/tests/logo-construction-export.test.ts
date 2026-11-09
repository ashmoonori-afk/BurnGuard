import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compileLogoGeometry, LOGO_GEOMETRY_FILE, parseLogoGeometryV1, renderLogoConstruction, renderLogoConstructionSheet } from "@bg/shared";
import { LogoConstructionExportError, renderLogoConstructionSvg } from "../src/services/export-construction";
import { parseExportValidation } from "../src/services/export-receipt-validation";
import { LogoDeliverableError, validateLogoSvg } from "../src/services/logo-deliverables";

// Drawn for this suite: a two-bowl B, and a ring (a circle minus a smaller one).
const B_RECORD = {
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
};
const RING_RECORD = {
  schema_version: 1,
  grid: 64,
  radii: [{ id: "outer", value: 20 }, { id: "inner", value: 12 }],
  primitives: [{ kind: "circle", id: "o", cx: 32, cy: 32, r: "outer" }, { kind: "circle", id: "i", cx: 32, cy: 32, r: "inner" }],
  tree: { op: "subtract", args: [{ ref: "o" }, { ref: "i" }] },
};

function sheetOf(record: unknown, label: string): string {
  const { geometry } = parseLogoGeometryV1(record);
  return renderLogoConstructionSheet(geometry, compileLogoGeometry(geometry), label);
}

async function staged(record: string | null): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "bg-logo-construction-"));
  await mkdir(path.join(root, "render"), { recursive: true });
  if (record !== null) await writeFile(path.join(root, "render", LOGO_GEOMETRY_FILE), record);
  return root;
}

describe("construction sheet allowlist", () => {
  test.each([["the B", B_RECORD], ["the ring", RING_RECORD]])("Given %s When its still sheet is checked Then the master vector allowlist admits it", (_name, record) => {
    // Given / When / Then
    expect(() => validateLogoSvg(sheetOf(record, "Northstar"))).not.toThrow();
  });

  test("Given the finished animated frame When it is checked Then the allowlist refuses its dashes, so the export needs the still sheet", () => {
    // Given
    const { geometry } = parseLogoGeometryV1(B_RECORD);
    const frame = renderLogoConstruction(geometry, compileLogoGeometry(geometry), 1, { theme: "light", label: "Northstar" });

    // When / Then
    expect(() => validateLogoSvg(frame)).toThrow(LogoDeliverableError);
  });
});

describe("renderLogoConstructionSvg", () => {
  test("Given a staged geometry record When rendered Then the published bytes are the still sheet and the receipt records them", async () => {
    // Given
    const root = await staged(JSON.stringify(B_RECORD));
    try {
      const outputPath = path.join(root, "artifact.svg");

      // When
      const validation = await renderLogoConstructionSvg({ stagedDir: path.join(root, "render"), entrypointDir: ".", outputPath, label: "Northstar" });

      // Then
      const expected = sheetOf(B_RECORD, "Northstar");
      expect(await readFile(outputPath, "utf8")).toBe(expected);
      expect(validation).toEqual({ root: "svg", bytes: Buffer.byteLength(expected), source: null });
      expect(parseExportValidation("construction_svg", {}, validation)).toEqual(validation);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Given no geometry record When rendered Then the export fails as missing and writes nothing", async () => {
    // Given
    const root = await staged(null);
    try {
      const outputPath = path.join(root, "artifact.svg");

      // When / Then
      await expect(renderLogoConstructionSvg({ stagedDir: path.join(root, "render"), entrypointDir: ".", outputPath, label: "Northstar" })).rejects.toMatchObject({ code: "construction_missing" });
      expect(await Bun.file(outputPath).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each([
    ["a record that is not JSON", "{", "Northstar"],
    ["a record the compiler refuses", JSON.stringify({ ...RING_RECORD, tree: { ref: "missing" } }), "Northstar"],
    ["a name the allowlist cannot carry", JSON.stringify(RING_RECORD), "<script>"],
  ])("Given %s When rendered Then the export fails as invalid and writes nothing", async (_name, record, label) => {
    // Given
    const root = await staged(record);
    try {
      const outputPath = path.join(root, "artifact.svg");

      // When / Then
      await expect(renderLogoConstructionSvg({ stagedDir: path.join(root, "render"), entrypointDir: ".", outputPath, label })).rejects.toBeInstanceOf(LogoConstructionExportError);
      await expect(renderLogoConstructionSvg({ stagedDir: path.join(root, "render"), entrypointDir: ".", outputPath, label })).rejects.toMatchObject({ code: "construction_invalid" });
      expect(await Bun.file(outputPath).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
