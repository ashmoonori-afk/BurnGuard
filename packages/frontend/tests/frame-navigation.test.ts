import { describe, expect, test } from "bun:test";
import {
  FRAME_SAFE_ZONE,
  frameScopedSelector,
  frameSelector,
  isNineBySixteen,
  safeZoneBands,
  stepFrameIndex,
} from "../src/lib/frame-navigation";

describe("frame navigator index", () => {
  test.each([
    [0, 5, 1, 1],
    [4, 5, 1, 4],
    [0, 5, -1, 0],
    [3, 5, -1, 2],
    [9, 5, 1, 4],
    [-3, 5, -1, 0],
  ])(
    "Given frame %p of %p When stepping by %p Then the index clamps to %p",
    (index, count, delta, expected) => {
      expect(stepFrameIndex(index, count, delta)).toBe(expected);
    },
  );

  test("Given no frames When stepping Then the index stays at zero", () => {
    expect(stepFrameIndex(0, 0, 1)).toBe(0);
    expect(stepFrameIndex(2, 0, -1)).toBe(0);
  });
});

describe("frame selectors", () => {
  test("Given a frame index When a selector is built Then it addresses that artboard only", () => {
    expect(frameSelector(0)).toBe("[data-graphic-artboard]:nth-child(1 of [data-graphic-artboard])");
    expect(frameSelector(3)).toBe("[data-graphic-artboard]:nth-child(4 of [data-graphic-artboard])");
  });

  test("Given an element selector When scoped to a frame Then targeting stays inside that frame", () => {
    expect(frameScopedSelector(1, "[data-bg-node-id='title']")).toBe(
      "[data-graphic-artboard]:nth-child(2 of [data-graphic-artboard]) [data-bg-node-id='title']",
    );
  });
});

describe("9:16 safe zone", () => {
  test.each([
    [1080, 1920, true],
    [720, 1280, true],
    [1080, 1350, false],
    [1080, 1080, false],
    [860, 16_000, false],
  ])("Given a %p×%p frame When checked Then 9:16 is %p", (width, height, expected) => {
    expect(isNineBySixteen(width, height)).toBe(expected);
  });

  test("Given a rendered 9:16 artboard When bands are computed Then they scale with the rendered height", () => {
    const bands = safeZoneBands({ top: 40, left: 100, width: 270, height: 480 });

    expect(bands).toEqual([
      { top: 40, left: 100, width: 270, height: 62.5 },
      { top: 457.5, left: 100, width: 270, height: 62.5 },
    ]);
    expect(FRAME_SAFE_ZONE).toEqual({ frameHeight: 1920, top: 250, bottom: 250 });
  });

  test("Given a collapsed rect When bands are computed Then nothing is drawn", () => {
    expect(safeZoneBands({ top: 0, left: 0, width: 0, height: 0 })).toEqual([]);
  });
});
