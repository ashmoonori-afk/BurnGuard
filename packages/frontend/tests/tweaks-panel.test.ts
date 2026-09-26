import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TweaksPanel, { sizeRuleFor } from "../src/components/modes/TweaksPanel";
import type { TweaksTarget } from "../src/components/canvas/TweaksLayer";
import { t } from "../src/i18n/t";

const target: TweaksTarget = { bg_id: "hero", tag: "p", computed: { color: "rgb(23, 25, 26)", "background-color": "rgba(0, 0, 0, 0)", width: "200px", height: "100px" }, inline: {}, geometry: { width: 200, height: 100 } };

function panel(overrides: Partial<TweaksTarget> = {}): string {
  return renderToStaticMarkup(createElement(TweaksPanel, { target: { ...target, ...overrides }, saving: false, onApply() {}, onResetAll() {}, onClear() {}, review: null }));
}
const colorRowText = (html: string, styleKey: string) => html.match(new RegExp(`>${styleKey}</span><button[\\s\\S]*?<span class="min-w-0 flex-1 truncate text-left">([^<]*)</span>`))?.[1] ?? null;

describe("color row value (UXM-24)", () => {
  test("Given a computed color and no inline override When rendered Then the computed value is readable, not a dash", () => {
    expect(colorRowText(panel(), "color")).toBe("rgb(23, 25, 26)");
  });

  test("Given a transparent computed background When rendered Then the placeholder dash shows", () => {
    expect(colorRowText(panel(), "background-color")).toBe("—");
  });

  test("Given an inline override When rendered Then the inline value wins", () => {
    expect(colorRowText(panel({ inline: { color: "#112233" } }), "color")).toBe("#112233");
  });
});

describe("rotation range (UXM-25)", () => {
  test("Given the rotation input When rendered Then its range matches the stored -180..180 normalisation", () => {
    const input = panel().match(new RegExp(`<input[^>]*aria-label="${t("modes.rotation")}"[^>]*>`))?.[0] ?? "";
    expect(input).toContain('min="-180"');
    expect(input).toContain('max="180"');
  });
});

describe("aspect preset echo (UXM-26)", () => {
  const selected = (html: string) => html.match(/<option[^>]*selected=""[^>]*>/)?.[0].match(/value="([^"]*)"/)?.[1] ?? null;

  test("Given a 4:3 preset stored inline When rendered Then the 4:3 option is selected", () => {
    expect(selected(panel({ inline: { "aspect-ratio": "1.3333333333333333 / 1" } }))).toBe(String(4 / 3));
  });

  test("Given a locked custom ratio When rendered Then the lock option is selected, and auto selects free", () => {
    expect(selected(panel({ inline: { "aspect-ratio": "300 / 150" } }))).toBe("locked");
    expect(selected(panel({ inline: { "aspect-ratio": "auto" } }))).toBe("free");
  });
});

describe("text size floors (CSS-08)", () => {
  test("Given a slide target When the font-size rule resolves Then the floor is 24px, and 12px for a web target", () => {
    expect(sizeRuleFor("font-size", { inSlide: true }).min).toBe(24);
    expect(sizeRuleFor("font-size", { inSlide: false }).min).toBe(12);
    expect(sizeRuleFor("font-size", {}).min).toBe(12);
  });

  test("Given a target When the line-height rule resolves Then it shares the text floor and letter-spacing keeps its negative range", () => {
    expect(sizeRuleFor("line-height", { inSlide: true }).min).toBe(24);
    expect(sizeRuleFor("line-height", { inSlide: false }).min).toBe(12);
    expect(sizeRuleFor("letter-spacing", { inSlide: true })).toMatchObject({ min: -8, allowNegative: true });
  });
});
