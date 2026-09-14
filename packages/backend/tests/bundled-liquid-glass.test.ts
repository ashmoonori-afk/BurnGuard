import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { copyBundledLiquidGlass } from "../src/data/bundled-liquid-glass";
import { resolveRepoRoot } from "../src/lib/paths";
import {
  GLASS_COLOR,
  RING_OUTER,
  SHADOW_OUTER,
  lensProfile,
  refractedRadius,
  renderLiquidGlassRing,
} from "../../../assets/liquid-glass/liquid-glass.js";

const rp = 120;
const ring = { cx: 260, cy: 260, rp };

test("Given the bundle When copied into an artifact Then the module and its catalog arrive together", async () => {
  const destination = await mkdtemp(path.join(tmpdir(), "bg-glass-"));
  try {
    await copyBundledLiquidGlass(destination);
    const manifest = JSON.parse(await readFile(path.join(destination, "liquid-glass", "manifest.json"), "utf8"));
    expect(manifest.entry).toBe("liquid-glass.js");
    expect(manifest.catalog).toBe("liquid-glass.md");
    // Every export the manifest advertises actually exists in the shipped module.
    const shipped = await import(path.join(destination, "liquid-glass", "liquid-glass.js"));
    for (const name of manifest.exports) expect(typeof shipped[name]).not.toBe("undefined");
    // The catalog carries the sentinel the prompt refers to.
    const catalog = await readFile(path.join(destination, "liquid-glass", "liquid-glass.md"), "utf8");
    expect(catalog).toContain("BUNDLED_LIQUID_GLASS_REFERENCE");
    // The manifest's stated limit is the real fold threshold asserted below.
    expect(manifest.limits.refractionFold).toBe(0.42);
    expect(manifest.defaults.glass).toEqual([...GLASS_COLOR]);
    expect(manifest.bands.glass).toEqual([1, RING_OUTER]);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

test("Given the repository bundle When read Then the catalog matches the module's own defaults", async () => {
  const root = resolveRepoRoot();
  const manifest = JSON.parse(await readFile(path.join(root, "assets", "liquid-glass", "manifest.json"), "utf8"));
  expect(manifest.bands.shadow).toEqual([RING_OUTER, SHADOW_OUTER]);
  expect(manifest.runtimes).toEqual(["browser", "node"]);
});

test("Given the refraction limit When remapping Then the profile is monotonic up to it and folds past it", () => {
  const minSlope = (refraction: number) => {
    let slope = Infinity;
    for (let r = rp; r < rp * SHADOW_OUTER; r += 0.25) {
      const a = refractedRadius(r - 0.5, { ...ring, refraction });
      const b = refractedRadius(r + 0.5, { ...ring, refraction });
      slope = Math.min(slope, b - a);
    }
    return slope;
  };
  // A folded remap is what turns a smooth bend into broken, tangled lines.
  expect(minSlope(0.3)).toBeGreaterThan(0);
  expect(minSlope(0.42)).toBeLessThanOrEqual(0.001);
  expect(minSlope(0.6)).toBeLessThan(0);
});

test("Given the lens profile When sampled Then it pushes outward inside and pulls inward outside", () => {
  // Sign reversal across the centreline is what reads as a lens rather than a smear.
  expect(lensProfile(0.25)).toBeGreaterThan(0);
  expect(lensProfile(0.75)).toBeLessThan(0);
  // Displacement vanishes at both band edges, so the remap has finite slope there. Compared by
  // magnitude because the outer edge evaluates to a signed zero.
  expect(Math.abs(lensProfile(0))).toBe(0);
  expect(Math.abs(lensProfile(1))).toBe(0);
});

test("Given a rendered ring When compared to its background Then only the ring bands change", () => {
  const width = 520;
  const height = 520;
  const data = new Uint8ClampedArray(width * height * 4);
  // A 24px grid, the spec's own verification background.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const line = x % 24 === 0 || y % 24 === 0;
      const v = line ? 150 : 242;
      data[i] = v; data[i + 1] = v; data[i + 2] = v - 6; data[i + 3] = 255;
    }
  }
  const background = { data, width, height };
  const out = renderLiquidGlassRing(background, ring);

  let outside = 0;
  let inside = 0;
  let content = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = Math.hypot(x - ring.cx, y - ring.cy) / rp;
      const i = (y * width + x) * 4;
      const changed = data[i] !== out.data[i] || data[i + 1] !== out.data[i + 1] || data[i + 2] !== out.data[i + 2];
      if (!changed) continue;
      if (u >= SHADOW_OUTER) outside++;
      else if (u < 1) content++;
      else inside++;
    }
  }
  // Background beyond the shadow band is untouched: a leak there makes the element look to float.
  expect(outside).toBe(0);
  // The content the ring surrounds is never overwritten.
  expect(content).toBe(0);
  // The ring itself did something.
  expect(inside).toBeGreaterThan(1000);
});

test("Given a dark background When raising transparency Then more background survives the glass", () => {
  const width = 320;
  const height = 320;
  const make = () => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = 20; data[i + 1] = 24; data[i + 2] = 30; data[i + 3] = 255; }
    return { data, width, height };
  };
  const centre = { cx: 160, cy: 160, rp: 70 };
  const probe = (see: number) => {
    const out = renderLiquidGlassRing(make(), { ...centre, see });
    const i = (160 * width + Math.round(160 + 70 * 1.05)) * 4;
    return out.data[i];
  };
  // Higher see means less glass body mixed in, so the dark background stays darker.
  expect(probe(0.92)).toBeLessThan(probe(0.6));
});
