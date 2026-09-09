import { expect, test } from "bun:test";
import { dimensionPatch, isAspectLocked, rotationPatch, targetDimensions } from "../src/lib/element-geometry";
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
