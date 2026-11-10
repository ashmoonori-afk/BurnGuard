import { expect, test } from "bun:test";
import { ASPECT_PRESETS, aspectPresetValue, dimensionPatch, isAspectLocked, rotationPatch, targetDimensions, targetOffset, translatePatch } from "../src/lib/element-geometry";
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
