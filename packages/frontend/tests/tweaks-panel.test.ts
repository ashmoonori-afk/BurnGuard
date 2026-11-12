import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectPalette } from "@bg/shared";
import TweaksPanel, { BUNDLED_FONTS_QUERY_KEY, PositionSection, TweaksPaletteSwatches, sizeRuleFor, tweaksPaletteQueryKey } from "../src/components/modes/TweaksPanel";
import { useUIStore } from "../src/state/uiStore";
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

describe("position and align (magnet release)", () => {
  const moved: TweaksTarget = { ...target, inline: { translate: "40px -8px" }, parent: { bgId: "row", display: "flex" } };
  const section = (overrides: Partial<TweaksTarget> = {}, props: { moving?: { x: number; y: number } | null; saving?: boolean; align?: boolean } = {}) =>
    renderToStaticMarkup(createElement(PositionSection, { target: { ...moved, ...overrides }, moving: props.moving ?? null, saving: props.saving ?? false, onApply() {}, onAlign: props.align === false ? undefined : () => {} }));
  const field = (html: string, label: string) => html.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";
  const reset = (html: string) => html.match(/<button[^>]*data-position-reset=""[^>]*>/)?.[0] ?? null;
  const aligns = (html: string) => [...html.matchAll(/<button[^>]*data-align="([a-z]+)"[^>]*>/g)];

  test("Given a saved offset When the section renders Then X and Y show it and Reset position is available", () => {
    const html = section();
    expect(field(html, "X")).toContain('value="40"');
    expect(field(html, "Y")).toContain('value="-8"');
    expect(reset(html)).not.toContain('disabled=""');
    expect(html).toContain('data-position-state="ready"');
  });

  test("Given no inline offset When the section renders Then the fields read 0 and Reset position is disabled", () => {
    const html = section({ inline: {} });
    expect(field(html, "X")).toContain('value="0"');
    expect(reset(html)).toContain('disabled=""');
  });

  test("Given a move in progress When the section renders Then the numbers follow the gesture", () => {
    const html = section({}, { moving: { x: 63.5, y: 12 } });
    expect(field(html, "X")).toContain('value="63.5"');
    expect(field(html, "Y")).toContain('value="12"');
  });

  test("Given a position in a unit other than pixels, or text inside a line When the section renders Then the fields are disabled, no Reset or Align is offered, and each case gives its own reason", () => {
    const refused = [section({ inline: { translate: "10% 0px" } }), section({ inLine: true, computed: { display: "inline" } })];
    for (const html of refused) {
      expect(html).toContain('data-position-state="unsupported"');
      expect(field(html, "X")).toContain('disabled=""');
      expect(reset(html)).toBeNull();
      expect(aligns(html)).toHaveLength(0);
    }
    expect(refused[0]).toContain('data-position-refusal="unit"');
    expect(refused[1]).toContain('data-position-refusal="line"');
    expect(section()).not.toContain("data-position-refusal");
  });

  test("Given an element with a parent When the section renders Then six labelled Align buttons show, in reading order", () => {
    const buttons = aligns(section());
    expect(buttons.map((match) => match[1])).toEqual(["left", "center", "right", "top", "middle", "bottom"]);
    for (const match of buttons) expect(match[0]).toMatch(/aria-label="[^"]+"/);
    expect(new Set(buttons.map((match) => match[0].match(/aria-label="([^"]+)"/)![1])).size).toBe(6);
  });

  test("Given no parent, no align handler or a save in progress When the section renders Then Align is hidden or disabled", () => {
    expect(aligns(section({ parent: null }))).toHaveLength(0);
    expect(aligns(section({}, { align: false }))).toHaveLength(0);
    const saving = section({}, { saving: true });
    for (const match of aligns(saving)) expect(match[0]).toContain('disabled=""');
    expect(reset(saving)).toContain('disabled=""');
    expect(field(saving, "X")).toContain('disabled=""');
  });

  test("Given the UI store When a move reports its offset Then the state follows and clears", () => {
    useUIStore.getState().setCanvasMoveOffset({ x: 3, y: 0 });
    expect(useUIStore.getState().canvasMoveOffset).toEqual({ x: 3, y: 0 });
    useUIStore.getState().setCanvasMoveOffset(null);
    expect(useUIStore.getState().canvasMoveOffset).toBeNull();
  });
});
