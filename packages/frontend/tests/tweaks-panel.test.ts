import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectPalette } from "@bg/shared";
import TweaksPanel, { BUNDLED_FONTS_QUERY_KEY, TweaksPaletteSwatches, sizeRuleFor, tweaksPaletteQueryKey } from "../src/components/modes/TweaksPanel";
import type { TweaksTarget } from "../src/components/canvas/TweaksLayer";
import { messages } from "../src/i18n/messages";
import { t } from "../src/i18n/t";

const target: TweaksTarget = { bg_id: "hero", tag: "p", computed: { color: "rgb(23, 25, 26)", "background-color": "rgba(0, 0, 0, 0)", width: "200px", height: "100px" }, inline: {}, geometry: { width: 200, height: 100 } };

function panel(overrides: Partial<TweaksTarget> = {}, client = new QueryClient()): string {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(TweaksPanel, { projectId: "project", relPath: "index.html", target: { ...target, ...overrides }, saving: false, onApply() {}, onResetAll() {}, onClear() {}, review: null })));
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

describe("page palette swatches (CSS-09)", () => {
  test("Given the current page's palette When the colour popover body renders Then swatches carry the page colours grouped by custom property and none of the app's own accents", async () => {
    const palette: ProjectPalette = { rel_path: "index.html", revision: 1, artifact_digest: "a".repeat(64), files: ["index.html"], colors: [{ id: "#e6f0ff", name: "#e6f0ff", value: "#e6f0ff", count: 2 }, { id: "#0b1220", name: "--page-background", value: "#0b1220", count: 1 }] };
    const client = new QueryClient();
    client.setQueryData(tweaksPaletteQueryKey("project", "index.html"), palette);
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(TweaksPaletteSwatches, { projectId: "project", relPath: "index.html", onPick() {} })));
    const swatches = html.match(/<button[^>]*title="[^"]*"[^>]*>/g) ?? [];
    expect(swatches.map((button) => button.match(/title="([^"]*)"/)?.[1])).toEqual(["--page-background #0b1220", "#e6f0ff"]);
    expect(swatches[0]).toContain("background-color:#0b1220");
    expect(swatches[1]).toContain("background-color:#e6f0ff");
    for (const appAccent of ["#004fff", "#00ce78"]) expect(html).not.toContain(appAccent);
    expect(html.indexOf(t("modes.tweaks.paletteTokens"))).toBeLessThan(html.indexOf(t("modes.tweaks.paletteColors")));
    expect(await Bun.file(new URL("../src/components/modes/tweaks-palette.ts", import.meta.url)).exists()).toBe(false);
    for (const key of ["modes.palette.grey", "modes.palette.blue", "modes.palette.accent"]) expect(Object.hasOwn(messages, key), key).toBe(false);
  });
});

describe("bundled font list (CSS-10)", () => {
  test("Given the bundled-fonts query When the font row renders Then every family is offered and the hint count follows the list", () => {
    const client = new QueryClient();
    const families = ["DM Sans", "Geist", "Newsreader", "Noto Sans KR", "SUIT"];
    client.setQueryData(BUNDLED_FONTS_QUERY_KEY, { schema_version: 1, families });
    const html = panel({}, client);
    for (const family of families) expect(html).toContain(`<option value="${JSON.stringify(family).replace(/"/g, "&quot;")}">${family}</option>`);
    expect(html).toContain(t("modes.tweaks.bundledFontsHint", { count: families.length }));
    expect(panel()).toContain(t("modes.tweaks.bundledFontsHint", { count: 7 }));
  });
});
