import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TweaksPanel from "../src/components/modes/TweaksPanel";
import type { TweaksTarget } from "../src/components/canvas/TweaksLayer";
import { parseSides } from "../src/components/modes/tweaks-utils";
import { t } from "../src/i18n/t";

const base: TweaksTarget = { bg_id: "card", tag: "div", computed: { width: "200px", height: "100px" }, inline: {}, geometry: { width: 200, height: 100 } };

function render(inline: Record<string, string>): string {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(TweaksPanel, { projectId: "project", relPath: "index.html", target: { ...base, inline }, saving: false, onApply() {}, onResetAll() {}, onClear() {}, review: null })));
}

/** Side inputs render in row order padding, margin, border-radius. */
function sideValues(html: string, side: "top" | "right" | "bottom" | "left"): string[] {
  const label = t(`modes.tweaks.${side}`);
  return [...html.matchAll(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`, "g"))].map((match) => match[0].match(/value="([^"]*)"/)?.[1] ?? "<none>");
}

describe("CANVAS-1 Style side editor keeps authored side values", () => {
  test("Given inline margin '0 auto' When the Style panel renders Then the horizontal margin is not shown as an empty side that commits as 0px", () => {
    const html = render({ margin: "0 auto" });
    const [, marginRight] = sideValues(html, "right");
    expect(marginRight).not.toBe("");
  });

  test("Given inline border-radius 50% When the Style panel renders Then the radius is not shown as the pixel value 50", () => {
    const html = render({ "border-radius": "50%" });
    const [, , radiusTop] = sideValues(html, "top");
    expect(radiusTop).not.toBe("50");
  });

  test("Given an elliptical border-radius '10px / 20px' When parsed into sides Then the slash is not treated as the right radius", () => {
    expect(parseSides("10px / 20px").right).not.toBe("/");
  });
});
