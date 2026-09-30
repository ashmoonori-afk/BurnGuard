import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TweaksPanel from "../src/components/modes/TweaksPanel";
import type { TweaksTarget } from "../src/components/canvas/TweaksLayer";
import { applySideDraft, normalizeSideDraft, parseSides, sideDisplay } from "../src/components/modes/tweaks-utils";
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

describe("side editor keeps authored side values", () => {
  test("Given inline margin '0 auto' When the Style panel renders Then the horizontal margin shows its authored keyword, not an empty side that commits as 0px", () => {
    const html = render({ margin: "0 auto" });
    expect(sideValues(html, "top")[1]).toBe("0");
    expect(sideValues(html, "right")[1]).toBe("auto");
    expect(sideValues(html, "left")[1]).toBe("auto");
  });

  test("Given inline border-radius 50% When the Style panel renders Then the radius keeps its unit instead of reading as the pixel value 50", () => {
    const html = render({ "border-radius": "50%" });
    expect(sideValues(html, "top")[2]).toBe("50%");
  });

  test("Given an elliptical border-radius '10px / 20px' When parsed into sides Then it is reported as unsupported and the slash is never a side token", () => {
    expect(parseSides("10px / 20px")).toBeNull();
    expect(parseSides("10px/20px")).toBeNull();
  });

  test("Given an elliptical border-radius When the Style panel renders Then the row is one read-only field holding the authored value", () => {
    const html = render({ "border-radius": "10px / 20px" });
    expect(sideValues(html, "top")).toHaveLength(2);
    const field = html.match(/<input[^>]*aria-label="border-radius"[^>]*>/)?.[0] ?? "";
    expect(field).toContain('value="10px / 20px"');
    expect(field).toContain('readonly=""');
    expect(field).toContain('disabled=""');
  });

  test("Given a shorthand the four inputs cannot represent When parsed Then it is unsupported", () => {
    for (const value of ["inherit", "UNSET", "var(--gap)", "4px var(--gap)", "1px 2px 3px 4px 5px", "calc(1px + 2px", "4px)"]) {
      expect(parseSides(value), value).toBeNull();
    }
  });

  test("Given functions and mixed whitespace When parsed Then each side keeps its whole authored token", () => {
    expect(parseSides("calc(100% - 8px) 2rem")).toEqual({ top: "calc(100% - 8px)", right: "2rem", bottom: "calc(100% - 8px)", left: "2rem" });
    expect(parseSides("calc(10px / 2) auto")).toEqual({ top: "calc(10px / 2)", right: "auto", bottom: "calc(10px / 2)", left: "auto" });
    expect(parseSides("  0\r\n\tauto ")).toEqual({ top: "0", right: "auto", bottom: "0", left: "auto" });
    expect(parseSides("0\n auto")).toEqual({ top: "0", right: "auto", bottom: "0", left: "auto" });
    expect(parseSides("")).toEqual({ top: "", right: "", bottom: "", left: "" });
  });

  test("Given authored tokens When displayed Then only px lengths lose their unit", () => {
    expect(["24px", "-0.5PX", "0", "auto", "50%", "2rem", ""].map(sideDisplay)).toEqual(["24", "-0.5", "0", "auto", "50%", "2rem", ""]);
  });
});

describe("side editor commits one side", () => {
  const sidesOf = (value: string) => {
    const sides = parseSides(value);
    if (!sides) throw new Error(`unsupported shorthand: ${value}`);
    return sides;
  };

  test("Given margin '0 auto' When the top side is set to 20 Then the other sides keep their authored tokens", () => {
    expect(applySideDraft("margin", sidesOf("0 auto"), "top", "20")).toEqual({ sides: { top: "20px", right: "auto", bottom: "0", left: "auto" }, shorthand: "20px auto 0" });
  });

  test("Given border-radius 50% When one corner is set to 8 Then the other corners stay 50%", () => {
    expect(applySideDraft("border-radius", sidesOf("50%"), "top", "8")?.shorthand).toBe("8px 50% 50%");
    expect(applySideDraft("border-radius", sidesOf("50%"), "left", "8")?.shorthand).toBe("50% 50% 50% 8px");
  });

  test("Given an untouched or rejected draft When committed Then nothing is written", () => {
    expect(applySideDraft("margin", sidesOf("0 auto"), "right", "auto")).toBeNull();
    expect(applySideDraft("margin", sidesOf("0 auto"), "right", "10%")).toBeNull();
    expect(applySideDraft("padding", sidesOf("16px"), "top", " 16 ")).toBeNull();
    expect(applySideDraft("border-radius", sidesOf("50%"), "top", "50%")).toBeNull();
  });

  test("Given px sides When one is cleared Then it writes 0px, and clearing the last one drops the override", () => {
    expect(applySideDraft("padding", sidesOf("8px 4px"), "top", "")?.shorthand).toBe("0px 4px 8px");
    expect(applySideDraft("padding", { top: "8px", right: "", bottom: "", left: "" }, "top", "")).toEqual({ sides: { top: "", right: "", bottom: "", left: "" }, shorthand: "" });
  });
});

describe("box model numeric input", () => {
  test("padding and corner radii clamp negative values while margins preserve them", () => {
    expect(normalizeSideDraft("padding", "-8")).toBe("0");
    expect(normalizeSideDraft("border-radius", "-0.5")).toBe("0");
    expect(normalizeSideDraft("margin", "-8.5")).toBe("-8.5");
  });

  test("empty values clear overrides and finite decimal values normalize", () => {
    expect(normalizeSideDraft("padding", "  ")).toBe("");
    expect(normalizeSideDraft("padding", " 08.50 ")).toBe("8.5");
    expect(normalizeSideDraft("margin", "-0")).toBe("0");
  });

  test("malformed and nonfinite values are rejected without producing CSS", () => {
    for (const value of ["abc", "-", ".", "8px", "1e3", "9".repeat(400)]) {
      expect(normalizeSideDraft("padding", value)).toBeNull();
    }
  });
});
