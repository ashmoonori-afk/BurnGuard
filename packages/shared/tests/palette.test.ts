import { expect, test } from "bun:test";
import { allHueChroma, isInGamut, parseHexColor, parseRgb, selectedHueChroma } from "../src/color";
import { UpgradeContractError } from "../src/contract-parser";
import { PALETTE_DISTRIBUTIONS, PALETTE_LIMITS, createDefaultPalette, distributePalette, paletteShareFragment,
  parsePaletteShareFragment, parsePaletteState, redoPalette, samplePalette, sampleScale, serializePalette,
  transitionPalette, undoPalette, type PaletteHistory, type PaletteState } from "../src/palette";

test("Given default state When initialized Then named absolute stops and five hues plus neutral are provided", () => {
  const state = createDefaultPalette();
  const parsed = parsePaletteState(state);
  expect(parsed.stops.map(s => s.name)).toEqual(["50", "100", "150", "200", "250", "300", "400", "500", "600", "650", "700", "750"]);
  expect(parsed.stops.map(s => s.position)).toEqual([50, 100, 150, 200, 250, 300, 400, 500, 600, 650, 700, 750].map(n => n / 800));
  expect(parsed.scales.filter(s => s.kind === "hue")).toHaveLength(5);
  expect(parsed.scales.filter(s => s.kind === "neutral")).toHaveLength(1);
});

for (const gamut of ["srgb", "display-p3"] as const) {
  test(`Given ${gamut} stops When redistributed resized or endpoint-moved Then absolute sampling remains identical`, () => {
    const state: PaletteState = { ...createDefaultPalette(), gamut };
    const expected = samplePalette(state, 0.413);
    for (const preset of PALETTE_DISTRIBUTIONS) {
      const moved = distributePalette(state, preset);
      expect(moved.stops.map(s => [s.id, s.name])).toEqual(state.stops.map(s => [s.id, s.name]));
      expect(parsePaletteState(moved)).toEqual(moved);
      expect(samplePalette(moved, 0.413)).toEqual(expected);
    }
    const resized = parsePaletteState({ ...state, stops: state.stops.slice(1, -1), range: { start: 0.1, end: 0.9 } });
    expect(samplePalette(resized, 0.413)).toEqual(expected);
    const added = parsePaletteState({ ...state, stops: [...state.stops, { id: "extra", name: "800", position: 0.99 }],
      range: { start: 0, end: 1 } });
    expect(samplePalette(added, 0.413)).toEqual(expected);
  });

  for (const envelope of ["selected-hues", "all-hues"] as const) {
    test(`Given ${gamut} ${envelope} When sampled Then chromatic L and C are identical and lightness decreases`, () => {
      const state: PaletteState = { ...createDefaultPalette(), gamut, envelope,
        curve: { ...createDefaultPalette().curve, amount: 4 } };
      let previous = 2;
      for (const position of [0, 0.0625, 0.2, 0.413, 0.5, 0.75, 0.9375, 1]) {
        const samples = samplePalette(state, position);
        const common = sampleScale(position, state.curve, state);
        expect(common.l).toBe(1 - position);
        expect(common.l).toBeLessThan(previous);
        previous = common.l;
        for (const sample of samples) {
          expect(sample.color.l).toBe(common.l);
          expect(sample.color.c).toBe(sample.id === "neutral" ? 0 : common.c);
          expect(isInGamut(sample.color, gamut)).toBe(true);
          expect(sample.outside_srgb).toBe(!isInGamut(sample.color, "srgb"));
        }
      }
    });
  }
}

test("Given curve controls When changed Then original continuous profiles and independent ends apply", () => {
  const state = createDefaultPalette();
  const base = { ...state.curve, amount: 0.0001, width: 0.4, softness: 2 };
  expect(sampleScale(0.25, { ...base, kind: "bell" }, state).c).toBeCloseTo(0.0001 * Math.exp(-1.5625), 15);
  expect(sampleScale(0.25, { ...base, kind: "even" }, state).c).toBeCloseTo(0.0001 * Math.exp(-0.0625), 15);
  const light = { ...base, light_end: 1 };
  expect(sampleScale(0.25, light, state).c).toBe(base.amount);
  expect(sampleScale(0.75, light, state)).toEqual(sampleScale(0.75, base, state));
  expect(sampleScale(0.75, { ...base, dark_end: 1 }, state).c).toBe(base.amount);
  expect(sampleScale(0.25, { ...base, width: 0.8 }, state).c).toBeGreaterThan(sampleScale(0.25, base, state).c);
  expect(sampleScale(0.25, { ...base, softness: 4 }, state).c).toBeLessThan(sampleScale(0.25, base, state).c);
  expect(sampleScale(0.25, { ...base, lightness: { light: 0.9, dark: 0.1 } }, state).l).toBeCloseTo(0.7, 15);
  expect(sampleScale(0.25, { ...base, amount: 0 }, state).c).toBe(0);
});

test("Given selected hues When neutral is added Then only chromatic hues constrain the shared envelope", () => {
  const state = createDefaultPalette();
  const scales = [{ id: "single", name: "Single", kind: "hue", hue: 30 }] as const;
  const curve = { ...state.curve, amount: 4 };
  const chromatic = { ...state, scales, curve };
  const withNeutral = { ...chromatic, scales: [...scales, { id: "n", name: "N", kind: "neutral" } as const] };
  const sampled = sampleScale(0.5, curve, chromatic);
  expect(sampleScale(0.5, curve, withNeutral)).toEqual(sampled);
  expect(sampled.c).toBe(selectedHueChroma(0.5, [30], "srgb"));
  expect(sampleScale(0.5, curve, { ...chromatic, envelope: "all-hues" }).c).toBe(allHueChroma(0.5, "srgb"));
  expect(sampled.c).toBeGreaterThan(allHueChroma(0.5, "srgb"));
  expect(sampleScale(0.5, curve, { ...state, scales: [{ id: "n", name: "N", kind: "neutral" }] }).c).toBe(0);
});

test("Given exact brand anchors When imported and sampled Then anchors stay exact without changing uniform scales", () => {
  const state = createDefaultPalette();
  const anchors = [{ id: "brand", name: "Brand", color: parseHexColor("#ff0000") },
    { id: "p3-brand", name: "Wide brand", color: parseRgb({ space: "display-p3", r: 1, g: 0, b: 0 }) }];
  const imported = parsePaletteState({ ...state, anchors });
  expect(parsePaletteState(serializePalette(imported)).anchors).toEqual(anchors);
  expect(samplePalette(imported, 0.5)).toEqual(samplePalette(state, 0.5));
  expect(imported.anchors).toEqual(anchors);
});

test("Given state with display controls When JSON and fragment roundtrip Then every field survives without aliases", () => {
  const state: PaletteState = { ...createDefaultPalette(), gamut: "display-p3", envelope: "all-hues",
    display: { layout: "rows", scale_gap: 8, step_gap: 3, appearance: "dark", information: "always",
      fields: ["name", "step", "hex", "rgb", "oklch", "contrast-white", "contrast-black"] } };
  const json = serializePalette(state);
  expect(parsePaletteState(json)).toEqual(state);
  expect(parsePaletteShareFragment(paletteShareFragment(state))).toEqual(state);
  expect(serializePalette(parsePaletteState(json))).toBe(json);
  expect(parsePaletteState(state).stops).not.toBe(state.stops);
  expect(parsePaletteState(state).curve).not.toBe(state.curve);
});

test("Given completed gestures When undone redone reset or branched Then reversible bounded history preserves state", () => {
  const initial = createDefaultPalette();
  const empty: PaletteHistory = { past: [], present: initial, future: [] };
  const changed = transitionPalette(empty, { ...initial, gamut: "display-p3" });
  expect(undoPalette(changed).present).toEqual(initial);
  expect(redoPalette(undoPalette(changed)).present).toEqual(changed.present);
  const reset = transitionPalette(changed, createDefaultPalette());
  expect(undoPalette(reset).present).toEqual(changed.present);
  expect(transitionPalette(undoPalette(changed), { ...initial, envelope: "all-hues" }).future).toEqual([]);
  expect(undoPalette(empty)).toBe(empty);
  expect(redoPalette(empty)).toBe(empty);
  expect(transitionPalette(empty, initial)).toBe(empty);
  let history = empty;
  for (let i = 0; i < 70; i++) history = transitionPalette(history, { ...initial,
    display: { ...initial.display, step_gap: i } });
  expect(history.past).toHaveLength(PALETTE_LIMITS.history);
});

test("Given malformed external states When parsed Then shapes identities bounds and finite values are rejected", () => {
  const s = createDefaultPalette(), stop = { id: "s", name: "S", position: 0.5 };
  const invalid: readonly unknown[] = [null, [], "null", "{", {}, { ...s, extra: 1 }, { ...s, version: 2 },
    { ...s, stops: [] }, { ...s, stops: [stop, stop] }, { ...s, stops: [{ ...stop, position: -1 }, ...s.stops] },
    { ...s, stops: [...s.stops].reverse() }, { ...s, stops: [{ ...stop, extra: 1 }, ...s.stops] },
    { ...s, stops: [{ ...stop, id: "blue", position: 0.07 }, ...s.stops.slice(1)] },
    { ...s, stops: s.stops.map(item => ({ ...item, name: "same" })) }, { ...s, scales: [] },
    { ...s, scales: [{ id: "x", name: "X", kind: "neutral", hue: 0 }] },
    { ...s, scales: [{ id: "x", name: "X", kind: "hue", hue: 361 }] },
    { ...s, scales: Array.from({ length: 65 }, (_, i) => ({ id: `n${i}`, name: "N", kind: "neutral" })) },
    { ...s, range: { start: 0.8, end: 0.2 } }, { ...s, range: { start: -1, end: 1 } },
    { ...s, curve: { ...s.curve, kind: "other" } }, { ...s, curve: { ...s.curve, width: 0 } },
    { ...s, curve: { ...s.curve, softness: 9 } }, { ...s, curve: { ...s.curve, light_end: 2 } },
    { ...s, curve: { ...s.curve, lightness: { light: 0.1, dark: 0.9 } } },
    { ...s, anchors: [{ id: "a", name: "A", color: { space: "srgb", r: 2, g: 0, b: 0 } }] },
    { ...s, gamut: "p3" }, { ...s, envelope: "table" }, { ...s, distribution: "random" },
    { ...s, display: { ...s.display, fields: ["hex", "hex"] } }, { ...s, display: { ...s.display, step_gap: 129 } },
    { ...s, stops: s.stops.map(item => ({ ...item, name: "\ud800" })) }];
  for (const value of invalid) expect(() => parsePaletteState(value)).toThrow(UpgradeContractError);
  for (const value of [NaN, Infinity, -Infinity, "0.5"]) {
    for (const key of ["amount", "width", "softness", "light_end", "dark_end"]) {
      expect(() => parsePaletteState({ ...s, curve: { ...s.curve, [key]: value } })).toThrow(UpgradeContractError);
    }
    expect(() => parsePaletteState({ ...s, stops: [{ ...stop, position: value }, ...s.stops] })).toThrow(UpgradeContractError);
    expect(() => parsePaletteState({ ...s, scales: [{ id: "h", name: "H", kind: "hue", hue: value }] })).toThrow(UpgradeContractError);
  }
  expect(() => parsePaletteState(" ".repeat(PALETTE_LIMITS.json + 1))).toThrow(UpgradeContractError);
  for (const fragment of ["#other={}", "#bg-palette=%zz", "#bg-palette=%7B", "x".repeat(PALETTE_LIMITS.share + 1)]) {
    expect(() => parsePaletteShareFragment(fragment)).toThrow(UpgradeContractError);
  }
  for (const p of [NaN, Infinity, -1, 1.01]) expect(() => sampleScale(p, s.curve, s)).toThrow(UpgradeContractError);
});
