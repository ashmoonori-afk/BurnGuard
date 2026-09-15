import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractDesignSystemSurface } from "@bg/shared";
import { appendGraphicOutputContext } from "../src/harness/prompt-graphic-set";
import { GRAPHIC_VISUAL_CRAFT } from "../src/harness/skills/visual-craft-skill";
import { bundledDesignSystems } from "../src/data/bundled-design-systems";
import { resolveRepoRoot } from "../src/lib/paths";

function graphicContext(canvas: { width: number; height: number }, kind: "card_news" | "product_detail" | "single", frameCount = 1): string[] {
  const lines: string[] = [];
  appendGraphicOutputContext(lines, canvas as never, { kind, frame_count: frameCount } as never);
  return lines;
}

function outputJson(lines: readonly string[]): Record<string, unknown> {
  const index = lines.indexOf("<burnguard-graphic-output-v1>");
  expect(index).toBeGreaterThanOrEqual(0);
  return JSON.parse(lines[index + 1]!) as Record<string, unknown>;
}

/**
 * Three defects the content research found by arithmetic against these very files, not by taste.
 * Each is a rule that is wrong for frames the product actually ships.
 */
describe("Graphic contract defects", () => {
  test("Given a tall product-detail page, then a story safe zone is not applied to it", () => {
    // 12000 * 9 >= 860 * 16, so a ratio-only predicate calls a marketplace detail page a 9:16 story
    // and reserves 250px of its top and bottom for a platform chrome that is not there.
    const detail = outputJson(graphicContext({ width: 860, height: 12000 }, "product_detail"));
    expect(detail.safe_zone_css_px, "a detail page is not a story frame").toBeUndefined();
    // A real 9:16 card-news frame still gets its zone.
    const story = outputJson(graphicContext({ width: 1080, height: 1920 }, "card_news", 3));
    expect(story.safe_zone_css_px, "a 9:16 card news frame keeps its safe zone").toBeDefined();
  });

  test("Given a story frame larger than the base size, then the safe zone scales with it", () => {
    // Kakao states the rule explicitly for its own zones: a larger image scales the zone by the same
    // ratio. An absolute 250px on a 2160x3840 export protects half of what it should.
    const base = outputJson(graphicContext({ width: 1080, height: 1920 }, "card_news", 3));
    const double = outputJson(graphicContext({ width: 2160, height: 3840 }, "card_news", 3));
    const top = (zone: unknown): number => (zone as { top: number }).top;
    expect(top(double.safe_zone_css_px)).toBeCloseTo(top(base.safe_zone_css_px) * 2, 0);
  });

  test("Given the shipped themes, then the craft block's headline band does not contradict them", async () => {
    // GRAPHIC_VISUAL_CRAFT prescribes "one headline at 8-14% of the artboard height". Measured on the
    // most common frame in the product (1080x1920 card news), every shipped theme sits below 8%, so
    // the craft block and the surface tokens disagree on the single most visible decision.
    const offenders: string[] = [];
    for (const { slug } of bundledDesignSystems) {
      const css = await readFile(path.join(resolveRepoRoot(), "design system themes", slug, "surfaces", "content.css"), "utf8");
      const tokens = extractDesignSystemSurface(css, "", "content").tokens;
      const hero = Number.parseFloat(tokens["--content-type-hero"]!);
      const base = Number.parseFloat(tokens["--content-base"]!);
      // hero scales with the 1080 short side of a 1080x1920 frame, measured against the 1920 height.
      const percentOfHeight = ((hero * (1080 / base)) / 1920) * 100;
      if (percentOfHeight >= 8) offenders.push(`${slug}=${percentOfHeight.toFixed(1)}%`);
    }
    // Either the craft band matches the themes, or the band is gone. It must not claim 8-14% while
    // all 41 themes ship 5.8-7.5%.
    expect(
      { bandInCraft: /8-14% of\s+the artboard height/.test(GRAPHIC_VISUAL_CRAFT.replace(/\s+/g, " ")), themesInsideBand: offenders.length },
      "the 8-14% headline band contradicts every shipped theme",
    ).toEqual({ bandInCraft: false, themesInsideBand: 0 });
  });

  test("Given Korean artboard copy, then the starter template breaks lines at 어절, not mid-word", async () => {
    // The template declares lang="ko" and then sets overflow-wrap: anywhere, which splits 브랜드 into
    // 브 / 랜드 — the most recognisable amateur-Korean-typesetting signal, shipped as the default.
    const template = await readFile(path.join(resolveRepoRoot(), "packages", "backend", "src", "db", "templates", "graphic.ts"), "utf8");
    expect(template).toContain('lang="ko"');
    expect(template, "overflow-wrap: anywhere splits Hangul words").not.toContain("overflow-wrap: anywhere");
    expect(template, "Korean text needs word-break: keep-all").toContain("word-break: keep-all");
    // A graphic artboard is a fixed-size element inside a canvas iframe, so a viewport unit resolves
    // against the preview window rather than the artboard: the starter renders at one size in the
    // canvas and another in the exported PNG. Both GRAPHIC_VISUAL_CRAFT and the content requirement
    // forbid viewport units for exactly this reason.
    const css = /<style>([\s\S]*?)<\/style>/.exec(template)?.[1] ?? template;
    expect(css.match(/\b\d+(?:\.\d+)?v[wh]\b/g) ?? [], "viewport units inside a fixed artboard").toEqual([]);
  });
});
