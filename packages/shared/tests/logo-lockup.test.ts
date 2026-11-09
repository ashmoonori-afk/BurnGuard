import { describe, expect, test } from "bun:test";
import {
  LOGO_GEOMETRY_SNAP,
  compileLogoGeometry,
  composeLogoLockup,
  logoGeometryBounds,
  logoGeometryCentroid,
  logoLockupSvg,
  parseLogoGeometryV1,
  type LogoWordmarkCompiled,
} from "../src/index";

// Shapes drawn for this test. The ring is symmetric; the drop is a disc above a slab, heavier low.
const RING = compileLogoGeometry(parseLogoGeometryV1({
  schema_version: 1,
  grid: 64,
  radii: [{ id: "outer", value: 20 }, { id: "inner", value: 10 }],
  primitives: [
    { kind: "circle", id: "o", cx: 32, cy: 32, r: "outer" },
    { kind: "circle", id: "i", cx: 32, cy: 32, r: "inner" },
  ],
  tree: { op: "subtract", args: [{ ref: "o" }, { ref: "i" }] },
}).geometry);
const DROP = compileLogoGeometry(parseLogoGeometryV1({
  schema_version: 1,
  grid: 64,
  radii: [{ id: "round", value: 12 }],
  primitives: [
    { kind: "circle", id: "disc", cx: 32, cy: 24, r: "round" },
    { kind: "rect", id: "slab", x: 20, y: 40, width: 24, height: 16 },
  ],
  tree: { op: "union", args: [{ ref: "disc" }, { ref: "slab" }] },
}).geometry);

const WORDS: LogoWordmarkCompiled = {
  path: "M1 0L9 0L9 16L1 16Z",
  width: 80,
  bounds: { minX: 1, minY: -0.4, maxX: 79, maxY: 16.2 },
  metrics: { cap_height: 16, baseline: 16, x_height: 12, ascender: 22, descender: 6, stem: 2, tracking: 1 },
  font: { family: "Geist", file: "Geist.woff2", weight: 400 },
  stem_measured: 1.938,
  glyphs: [{ x: 0, advance: 80 }],
};
const withCap = (cap: number): LogoWordmarkCompiled => ({ ...WORDS, metrics: { ...WORDS.metrics, cap_height: cap, baseline: cap } });
const sha = (text: string): string => new Bun.CryptoHasher("sha256").update(text).digest("hex");
const onGrid = (value: number): boolean => Number.isInteger(value / LOGO_GEOMETRY_SNAP);

describe("symbol centroid and bounds", () => {
  test("Given the ring When measured Then the centroid is its centre and the area is the analytic area", () => {
    const { area, center } = logoGeometryCentroid(RING);
    expect(Math.abs(area - Math.PI * (400 - 100))).toBeLessThan(1e-6);
    expect(Math.abs(area - RING.area)).toBeLessThan(1e-6);
    expect(Math.abs(center.x - 32)).toBeLessThan(1e-9);
    expect(Math.abs(center.y - 32)).toBeLessThan(1e-9);
    expect(logoGeometryBounds(RING)).toEqual({ minX: 12, minY: 12, maxX: 52, maxY: 52 });
  });

  test("Given the drop When measured Then the centroid is the area-weighted mean of disc and slab", () => {
    const disc = Math.PI * 144;
    const slab = 24 * 16;
    const { area, center } = logoGeometryCentroid(DROP);
    expect(Math.abs(area - (disc + slab))).toBeLessThan(1e-6);
    expect(Math.abs(center.x - 32)).toBeLessThan(1e-9);
    expect(Math.abs(center.y - (disc * 24 + slab * 48) / (disc + slab))).toBeLessThan(1e-9);
    expect(logoGeometryBounds(DROP)).toEqual({ minX: 20, minY: 12, maxX: 44, maxY: 56 });
  });
});

describe("lockup", () => {
  test("Given a cap height When composed Then gap and clear space are half-unit multiples of it", () => {
    for (const [cap, gap, clear] of [[16, 8, 16], [15, 7.5, 15], [15.5, 8, 15.5], [7, 3.5, 7]] as const) {
      const layout = composeLogoLockup(RING, withCap(cap));
      expect({ cap, gap: layout.gap, clear: layout.clear_space }).toEqual({ cap, gap, clear });
      expect(onGrid(layout.gap) && onGrid(layout.clear_space)).toBe(true);
    }
  });

  test("Given the drop When composed Then the cap-height middle sits on the centroid and the inks keep the gap and clear space", () => {
    const layout = composeLogoLockup(DROP, WORDS);
    const mark = logoGeometryBounds(DROP);
    expect(Math.abs(layout.wordmark.y + 8 - layout.optical_center.y)).toBeLessThan(1e-3);
    // Heavier low, so the words sit below the box centre.
    expect(layout.optical_center.y).toBeGreaterThan(layout.symbol.y + (mark.minY + mark.maxY) / 2);
    expect(layout.symbol.x + mark.minX).toBe(16);
    expect(Math.abs(layout.wordmark.x + WORDS.bounds.minX - (layout.symbol.x + mark.maxX + 8))).toBeLessThan(1e-3);
    expect(Math.abs(layout.width - (16 + 24 + 8 + 78 + 16))).toBeLessThan(1e-3);
    const top = Math.min(layout.symbol.y + mark.minY, layout.wordmark.y + WORDS.bounds.minY);
    const bottom = Math.max(layout.symbol.y + mark.maxY, layout.wordmark.y + WORDS.bounds.maxY);
    expect(Math.abs(top - 16)).toBeLessThan(1e-3);
    expect(Math.abs(layout.height - bottom - 16)).toBeLessThan(1e-3);
  });

  test("Given the same records When composed twice Then the SVG is the same bytes and matches its golden", () => {
    const first = logoLockupSvg(DROP, WORDS, composeLogoLockup(DROP, WORDS), "Drop");
    const second = logoLockupSvg(DROP, WORDS, composeLogoLockup(DROP, WORDS), "Drop");
    expect(second).toBe(first);
    expect(first.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 142 `)).toBe(true);
    expect(sha(first)).toBe("fe7acc6715a9159fb06babd700b5bb0f9df17e9597a3d92231adcbcbe394f2a8");
  });
});
