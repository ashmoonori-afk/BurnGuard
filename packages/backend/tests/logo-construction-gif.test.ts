import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compileLogoGeometry, LOGO_GEOMETRY_FILE, logoConstructionPalette, logoConstructionTimeline, parseLogoGeometryV1 } from "@bg/shared";
import { LOGO_CONSTRUCTION_GIF, logoConstructionGifPalette, logoConstructionGifTimes, renderLogoConstructionGif } from "../src/services/export-construction-gif";
import { parseExportValidation } from "../src/services/export-receipt-validation";
import { decodeGif } from "./helpers/gif-decode";

// Drawn for this suite: a ring (a circle minus a smaller one), centred on the 64-unit grid.
const RING_RECORD = {
  schema_version: 1,
  grid: 64,
  radii: [{ id: "outer", value: 20 }, { id: "inner", value: 12 }],
  primitives: [{ kind: "circle", id: "o", cx: 32, cy: 32, r: "outer" }, { kind: "circle", id: "i", cx: 32, cy: 32, r: "inner" }],
  tree: { op: "subtract", args: [{ ref: "o" }, { ref: "i" }] },
};

async function staged(record: string | null): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "bg-logo-construction-gif-"));
  await mkdir(path.join(root, "render"), { recursive: true });
  if (record !== null) await writeFile(path.join(root, "render", LOGO_GEOMETRY_FILE), record);
  return root;
}

function hex(palette: Uint8Array, index: number): string {
  return `#${Array.from(palette.subarray(index * 3, index * 3 + 3), (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

describe("construction GIF frame plan", () => {
  test.each([[0, 2], [1, 2], [1000, 11], [1050, 12]])("Given a %i ms draw-in When sampled Then it has %i frames from the empty to the finished drawing", (duration, count) => {
    // When
    const times = logoConstructionGifTimes(duration);

    // Then
    expect(times).toHaveLength(count);
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBe(1);
  });

  test("Given a very long draw-in When sampled Then the frame count stays at the bound", () => {
    // When / Then
    expect(logoConstructionGifTimes(3_600_000)).toHaveLength(LOGO_CONSTRUCTION_GIF.maxFrames);
  });

  test("Given the light construction colours When the table is built Then paper is entry 0 and ink, line and accent each have an exact entry", () => {
    // Given
    const { paper, ink, line, accent } = logoConstructionPalette("light");

    // When
    const palette = logoConstructionGifPalette();
    const entries = Array.from({ length: 256 }, (_, index) => hex(palette, index));

    // Then
    expect(entries[0]).toBe(paper);
    for (const colour of [ink, line, accent]) expect(entries).toContain(colour);
  });
});

describe("renderLogoConstructionGif", () => {
  test("Given a staged ring When rendered Then the GIF loops through the whole draw-in, ends on the solid ring and holds it", async () => {
    // Given
    const root = await staged(JSON.stringify(RING_RECORD));
    try {
      const outputPath = path.join(root, "artifact.gif");
      const { geometry } = parseLogoGeometryV1(RING_RECORD);
      const expectedFrames = logoConstructionGifTimes(logoConstructionTimeline(geometry, compileLogoGeometry(geometry)).duration_ms).length;

      // When
      const validation = await renderLogoConstructionGif({ stagedDir: path.join(root, "render"), entrypointDir: ".", outputPath, label: "Northstar" });
      const bytes = new Uint8Array(await readFile(outputPath));
      const gif = decodeGif(bytes);

      // Then
      const size = LOGO_CONSTRUCTION_GIF.size;
      expect(validation).toEqual({ frames: expectedFrames, width: size, height: size, bytes: bytes.byteLength });
      expect(parseExportValidation("construction_gif", {}, validation)).toEqual(validation);
      expect(gif).toMatchObject({ width: size, height: size, loops: true });
      expect(gif.frames).toHaveLength(expectedFrames);
      expect(gif.frames[gif.frames.length - 1].delayCs).toBe(LOGO_CONSTRUCTION_GIF.holdMs / 10);
      const ink = logoConstructionPalette("light").ink;
      const inkIndex = Array.from({ length: 256 }, (_, index) => hex(gif.palette, index)).indexOf(ink);
      const at = (frame: Uint8Array, x: number, y: number): number => frame[Math.round(y * size / 64) * size + Math.round(x * size / 64)];
      const first = gif.frames[0].indices;
      const last = gif.frames[gif.frames.length - 1].indices;
      // The empty artboard is all paper; the finished ring is ink in its band and paper in its hole.
      expect(first.every((index) => index === 0)).toBe(true);
      expect(at(last, 43.3, 43.3)).toBe(inkIndex);
      expect(at(last, 20.7, 20.7)).toBe(inkIndex);
      expect(at(last, 28, 30)).toBe(0);
      expect(at(last, 4, 60)).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Given no geometry record When rendered Then the export fails as missing and writes nothing", async () => {
    // Given
    const root = await staged(null);
    try {
      const outputPath = path.join(root, "artifact.gif");

      // When / Then
      await expect(renderLogoConstructionGif({ stagedDir: path.join(root, "render"), entrypointDir: ".", outputPath, label: "Northstar" })).rejects.toMatchObject({ code: "construction_missing" });
      expect(await Bun.file(outputPath).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each([
    ["a record that is not JSON", "{"],
    ["a record the compiler refuses", JSON.stringify({ ...RING_RECORD, tree: { ref: "missing" } })],
  ])("Given %s When rendered Then the export fails as invalid and writes nothing", async (_name, record) => {
    // Given
    const root = await staged(record);
    try {
      const outputPath = path.join(root, "artifact.gif");

      // When / Then
      await expect(renderLogoConstructionGif({ stagedDir: path.join(root, "render"), entrypointDir: ".", outputPath, label: "Northstar" })).rejects.toMatchObject({ code: "construction_invalid" });
      expect(await Bun.file(outputPath).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
