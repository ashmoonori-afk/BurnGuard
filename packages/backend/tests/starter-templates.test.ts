import { describe, expect, test } from "bun:test";
import { parse } from "node-html-parser";
import { renderInitialArtifact } from "../src/db/templates";

function styleOf(html: string): string {
  const style = parse(html).querySelector("style")?.textContent;
  expect(style).toBeDefined();
  return style!;
}

/** A warm off-white: red leads green leads blue by more than a rounding error. */
function warmCream(hex: string): boolean {
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
  return r > g && g > b && r - b > 10;
}

function pageBackground(style: string): string {
  const match = /--page-background:\s*#([0-9a-f]{6})\b/iu.exec(style);
  expect(match).not.toBeNull();
  return match![1]!;
}

describe("starter templates", () => {
  test("Given the prototype starter When rendered Then it declares a neutral --page-background and paints body from it", () => {
    const style = styleOf(renderInitialArtifact({ name: "x", type: "prototype" }));

    expect(warmCream(pageBackground(style))).toBe(false);
    expect(style).toMatch(/body\s*\{[^}]*background:[^;}]*var\(--page-background\)/u);
  });

  test("Given the slide-deck starter When rendered Then it declares --page-background plus the projection tokens it uses and no raw px text below 24", () => {
    const style = styleOf(renderInitialArtifact({ name: "x", type: "slide_deck", options: { use_speaker_notes: true } }));

    expect(warmCream(pageBackground(style))).toBe(false);
    expect(style).toMatch(/body\s*\{[^}]*background:[^;}]*var\(--page-background\)/u);
    for (const token of ["--deck-type-hero", "--deck-type-heading", "--deck-type-body", "--deck-type-caption", "--deck-pad-slide", "--deck-pad-block"]) {
      expect(style).toMatch(new RegExp(`${token}:\\s*\\d+px`, "u"));
      expect(style).toContain(`var(${token})`);
    }
    expect(style).toMatch(/\.deck-slide\s*\{[^}]*font-size:\s*var\(--deck-type-body\)/u);
    for (const [, px] of style.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/gu)) expect(Number(px)).toBeGreaterThanOrEqual(24);
    expect(style).not.toMatch(/font-size:\s*clamp\(/u);
  });
});
