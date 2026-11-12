import { expect, test } from "bun:test";
import { ALIGN_MODES, alignOffset, ASPECT_PRESETS, aspectPresetValue, dimensionPatch, isAspectLocked, nudgeTravel, offsetDelta, rotationPatch, targetDimensions, targetOffset, translatePatch } from "../src/lib/element-geometry";
import type { TweaksTarget } from "../src/components/canvas/TweaksLayer";

const target: TweaksTarget = { bg_id: "image", tag: "img", computed: { width: "180px", height: "80px", rotate: "0.25turn" }, inline: {}, geometry: { width: 200, height: 100 } };

test("Given padded geometry When resizing or rotating Then preserve ratio and unrelated transforms with bounded values", () => {
  expect(targetDimensions(target)).toEqual({ width: 200, height: 100, rotation: 90 });
  expect(dimensionPatch(target, 300, 100, true)).toEqual({ width: "300px", height: "150px", "box-sizing": "border-box", "aspect-ratio": "300 / 150" });
  expect(dimensionPatch(target, 200, 180, true).width).toBe("360px");
  expect(dimensionPatch(target, 50000, 100, true)).toMatchObject({ width: "16384px", height: "8192px" });
  expect(dimensionPatch(target, -2, 40, false)).toMatchObject({ width: "1px", height: "40px", "aspect-ratio": "auto" });
  expect(dimensionPatch(target, NaN, 100, true)).toEqual({});
  expect(rotationPatch(450)).toEqual({ rotate: "90deg" });
  expect(rotationPatch(Infinity)).toEqual({});
  const saved = { ...target, inline: { ...dimensionPatch(target, 320, 160, true) } } as TweaksTarget;
  expect(targetDimensions(saved).width).toBe(320);
  expect(isAspectLocked(saved)).toBe(true);
  expect(isAspectLocked(target)).toBe(false);
  expect(dimensionPatch({ ...target, computed: { ...target.computed, display: "inline" } }, 200, 100, false).display).toBe("inline-block");
});

test("Given a stored aspect-ratio When the preset value is derived Then a matching preset is echoed and other ratios fall back to lock or free", () => {
  expect(aspectPresetValue({ ...target, inline: { "aspect-ratio": "1.3333333333333333 / 1" } })).toBe(String(4 / 3));
  expect(aspectPresetValue({ ...target, inline: { "aspect-ratio": "16 / 9" } })).toBe(String(16 / 9));
  expect(aspectPresetValue({ ...target, inline: { "aspect-ratio": "300 / 150" } })).toBe("locked");
  expect(aspectPresetValue({ ...target, inline: { "aspect-ratio": "auto" } })).toBe("free");
  expect(aspectPresetValue(target)).toBe("free");
  expect(ASPECT_PRESETS.map((preset) => preset.value)).toEqual([1, 4 / 3, 16 / 9, 9 / 16]);
  for (const preset of ASPECT_PRESETS) expect(aspectPresetValue({ ...target, inline: { "aspect-ratio": `${preset.value} / 1` } })).toBe(String(preset.value));
});

test("Given a stored translate When the offset is read Then pixel values parse, none is zero and other units are left alone", () => {
  expect(targetOffset(target)).toEqual({ x: 0, y: 0 });
  expect(targetOffset({ ...target, computed: { ...target.computed, translate: "none" } })).toEqual({ x: 0, y: 0 });
  expect(targetOffset({ ...target, computed: { translate: "12px 3px" }, inline: { translate: "40px -8.5px" } })).toEqual({ x: 40, y: -8.5 });
  expect(targetOffset({ ...target, computed: { translate: "12px" } })).toEqual({ x: 12, y: 0 });
  expect(targetOffset({ ...target, computed: { translate: "12px 4px 0px" } })).toEqual({ x: 12, y: 4 });
  expect(targetOffset({ ...target, inline: { translate: "10% 0px" } })).toBeNull();
  expect(targetOffset({ ...target, inline: { translate: "calc(1px + 2px)" } })).toBeNull();
  expect(targetOffset({ ...target, inline: { translate: "1px 2px 3px" } })).toBeNull();
});

test("Given an offset When the move patch is built Then only translate is written, rounded to two decimals", () => {
  expect(translatePatch(40, 0)).toEqual({ translate: "40px 0px" });
  expect(translatePatch(-12.346, 0.004)).toEqual({ translate: "-12.35px 0px" });
  expect(translatePatch(-0, -0.001)).toEqual({ translate: "0px 0px" });
  expect(translatePatch(Number.NaN, 1)).toEqual({});
  expect(translatePatch(1, Number.POSITIVE_INFINITY)).toEqual({});
});

test("Given an element inside its parent's content box When aligned Then one side or centre lines up and the other axis keeps its offset", () => {
  const input = { rect: { left: 100, top: 100, width: 60, height: 40 }, content: { left: 0, top: 0, width: 400, height: 300 }, offset: { x: 5, y: 5 }, basis: undefined };
  const align = (mode: (typeof ALIGN_MODES)[number], overrides = {}) => alignOffset({ ...input, ...overrides, mode });
  expect(align("left")).toEqual({ x: -95, y: 5 });
  expect(align("center")).toEqual({ x: 75, y: 5 });
  expect(align("right")).toEqual({ x: 245, y: 5 });
  expect(align("top")).toEqual({ x: 5, y: -95 });
  expect(align("middle")).toEqual({ x: 5, y: 35 });
  expect(align("bottom")).toEqual({ x: 5, y: 165 });
  // In a slide scaled to 50%, 70 client px are 140 of the element's own pixels.
  expect(align("center", { basis: [0.5, 0, 0, 0.5] })).toEqual({ x: 145, y: 5 });
  // Under a parent turned a quarter, travel to the right on screen is travel up in the element's own pixels.
  expect(align("left", { basis: [0, 1, -1, 0] })).toEqual({ x: 5, y: 105 });
  expect(align("left", { offset: { x: 5, y: 1.2345 } })).toEqual({ x: -95, y: 1.2345 });
  expect(ALIGN_MODES).toEqual(["left", "center", "right", "top", "middle", "bottom"]);
});

test("Given the transforms above an element When a distance on screen is converted Then it comes back in the element's own translate pixels, and a flattened or unreadable basis moves nothing", () => {
  expect(offsetDelta(undefined, 40, -8)).toEqual({ x: 40, y: -8 });
  expect(offsetDelta([0.5, 0, 0, 0.5], 40, -8)).toEqual({ x: 80, y: -16 });
  // A quarter turn: right on screen is up for the element.
  expect(offsetDelta([0, 1, -1, 0], 40, 0)).toEqual({ x: 0, y: -40 });
  expect(offsetDelta([2, 0, 0, 0], 40, 8)).toEqual({ x: 0, y: 0 });
  expect(offsetDelta([Number.NaN, 0, 0, 1], 40, 8)).toEqual({ x: 0, y: 0 });
  expect(offsetDelta(JSON.parse('"1 0 0 1"'), 40, 8)).toEqual({ x: 40, y: 8 });
  expect(nudgeTravel([0, 3, -0.5, 0], { x: 1, y: 10 })).toEqual({ x: 0.5, y: 30 });
});
