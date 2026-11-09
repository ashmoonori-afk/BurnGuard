import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  LOGO_GEOMETRY_SNAP,
  LOGO_WORDMARK_CHARACTERS,
  LogoWordmarkError,
  compileLogoGeometry,
  composeLogoLockup,
  logoLockupSvg,
  parseLogoGeometryV1,
  parseLogoWordmarkV1,
  reviewLogoWordmark,
  type LogoWordmarkV1,
} from "@bg/shared";
import { create } from "fontkit";
import { compileLogoWordmark } from "../src/services/logo-wordmark-compile";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const record = (overrides: Partial<LogoWordmarkV1> = {}): LogoWordmarkV1 =>
  parseLogoWordmarkV1({ schema_version: 1, text: "BurnGuard", font: "Geist", cap_height: 16, stem: 2, tracking: 1, ...overrides }).wordmark;
const set = (overrides: Partial<LogoWordmarkV1> = {}) => compileLogoWordmark(record(overrides), repoRoot);
const sha = (text: string): string => new Bun.CryptoHasher("sha256").update(text).digest("hex");
const onGrid = (value: number): boolean => Number.isInteger(value / LOGO_GEOMETRY_SNAP);

async function refusal(overrides: Partial<LogoWordmarkV1>): Promise<string> {
  try {
    await set(overrides);
  } catch (error) {
    if (error instanceof LogoWordmarkError) return `${error.code} ${error.path}`;
    throw error;
  }
  return "accepted";
}

describe("wordmark compiler", () => {
  test("Given every settable bundled family When opened Then each covers every wordmark character and the measuring glyphs", async () => {
    const manifest = JSON.parse(await readFile(path.join(repoRoot, "assets/fonts/manifest.json"), "utf8")) as { families: { family: string; file: string; category: string }[] };
    const settable = manifest.families.filter((family) => family.category !== "handwriting");
    expect(settable.length).toBeGreaterThan(40);
    const gaps: string[] = [];
    for (const family of settable) {
      const font = create(await readFile(path.join(repoRoot, "assets/fonts", family.file)));
      if (!("hasGlyphForCodePoint" in font)) throw new Error(`collection ${family.file}`);
      for (const char of `${LOGO_WORDMARK_CHARACTERS}HIx`.replace(" ", "")) {
        if (!font.hasGlyphForCodePoint(char.codePointAt(0)!)) gaps.push(`${family.family} ${char}`);
      }
    }
    expect(gaps).toEqual([]);
  });

  test("Given flat capitals When set Then their ink runs exactly from the cap line to the baseline", async () => {
    for (const cap of [16, 7.5, 32]) {
      const words = await set({ text: "HI", cap_height: cap });
      expect({ cap, top: words.bounds.minY, bottom: words.bounds.maxY }).toEqual({ cap, top: 0, bottom: cap });
      expect(words.metrics.baseline).toBe(cap);
    }
  });

  test("Given tracking When set Then the line grows by exactly the tracking between each pair of letters", async () => {
    const plain = await set({ tracking: 0 });
    const tracked = await set({ tracking: 2.5 });
    expect(Math.abs(tracked.width - plain.width - 2.5 * 8)).toBeLessThan(2e-3);
    expect(tracked.glyphs.map((glyph, index) => Math.round((glyph.x - plain.glyphs[index]!.x) * 1000) / 1000)).toEqual([0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20]);
  });

  test("Given any record When set Then every metric it states is a multiple of the symbol unit", async () => {
    const words = await set({ cap_height: 13.5, stem: 1.5, tracking: -1 });
    const { cap_height, baseline, stem, tracking } = words.metrics;
    expect([cap_height, baseline, stem, tracking]).toEqual([13.5, 13.5, 1.5, -1]);
    expect([cap_height, baseline, stem, tracking].every(onGrid)).toBe(true);
  });

  test("Given a font's stem When measured Then it scales with the cap height and the review names an ask it cannot meet", async () => {
    const small = await set({ cap_height: 16 });
    const large = await set({ cap_height: 32 });
    expect(small.stem_measured).toBeGreaterThan(1);
    expect(Math.abs(large.stem_measured - 2 * small.stem_measured)).toBeLessThan(2e-3);
    expect(reviewLogoWordmark(small).passed).toBe(true);
    const heavy = await set({ stem: 4 });
    expect(reviewLogoWordmark(heavy).findings.map((finding) => finding.kind)).toEqual(["stem_off"]);
    // A heavier face really measures heavier.
    expect((await set({ font: "Anton" })).stem_measured).toBeGreaterThan(small.stem_measured * 1.5);
  });

  test("Given the same record When set twice Then the outline is the same bytes and matches its golden", async () => {
    const first = await set();
    const second = await set();
    expect(second).toEqual(first);
    expect(first.path).toMatch(/^M[-0-9. ]+(?:[MLQCZ][-0-9. ]*)+$/);
    expect(first.font).toEqual({ family: "Geist", file: "Geist.woff2", weight: 400 });
    expect(sha(first.path)).toBe("4417d87a74236a3b9502c1abce8ecc40d37c6d4169e858db7a8152833c04da78");
  });

  test("Given a family outside the bundle or a script family When set Then it is refused before any outline is read", async () => {
    expect(await refusal({ font: "Helvetica" })).toBe("font_unknown $.font");
    expect(await refusal({ font: "Caveat" })).toBe("font_unknown $.font");
  });

  test("Given a compiled symbol and a set wordmark When locked up Then the SVG is byte-stable and matches its golden", async () => {
    const symbol = compileLogoGeometry(parseLogoGeometryV1({
      schema_version: 1,
      grid: 64,
      radii: [{ id: "outer", value: 24 }, { id: "inner", value: 12 }],
      primitives: [
        { kind: "circle", id: "o", cx: 32, cy: 32, r: "outer" },
        { kind: "circle", id: "i", cx: 32, cy: 32, r: "inner" },
      ],
      tree: { op: "subtract", args: [{ ref: "o" }, { ref: "i" }] },
    }).geometry);
    const words = await set({ cap_height: 20 });
    const svg = logoLockupSvg(symbol, words, composeLogoLockup(symbol, words), "BurnGuard");
    expect(logoLockupSvg(symbol, words, composeLogoLockup(symbol, words), "BurnGuard")).toBe(svg);
    expect(sha(svg)).toBe("3ba167f81dc59c234594ef517b743d068114ffba02b34e16ac63cc8802e879d2");
  });
});
