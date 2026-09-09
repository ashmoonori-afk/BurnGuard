import { describe, expect, test } from "bun:test";
import { parseDesignBriefV1 } from "@bg/shared";
import { appendDesignBriefContext } from "../src/harness/prompt-design-brief";
import { PROMPT_SAMPLES, renderPromptSampleHtml, promptSampleDesignSystemId } from "../src/db/seed-tutorials";
import { SPLASH_TEMPLATE_LANDING_HTML } from "../src/db/seeded-project-html";
const brief = { schema_version: 1, output_type: "prototype", audience: "팀", objective: "소개", content_source: "none", locale: "ko", brand_mode: "none", visual_mood: "formal", density: "balanced", output_size: "responsive" };
describe("creation section contract", () => {
  test("Given requested sections When parsed and prompted Then the exact count survives and invalid counts fail", () => {
    const parsed = parseDesignBriefV1({ ...brief, section_count: 8 });
    const lines: string[] = []; appendDesignBriefContext(lines, parsed);
    expect(JSON.parse(lines[1]!)).toMatchObject({ section_count: 8 });
    expect(lines.join("\n")).toContain("exactly 8 complete vertical content sections");
    for (const section_count of [0, 31, 1.5, "6", null]) expect(() => parseDesignBriefV1({ ...brief, section_count })).toThrow();
    expect(parseDesignBriefV1(brief).section_count).toBeUndefined();
    expect(() => parseDesignBriefV1({ ...brief, output_type: "graphic", section_count: 6 })).toThrow();
  });
  test("Given every shipped landing When rendered Then five substantive sections follow its hero and its design system has a unique identity", () => {
    expect((SPLASH_TEMPLATE_LANDING_HTML.match(/<section\b/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(new Set(PROMPT_SAMPLES.map((sample) => promptSampleDesignSystemId(sample.slug))).size).toBe(PROMPT_SAMPLES.length);
    for (const sample of PROMPT_SAMPLES.filter((sample) => sample.layout !== "dashboard")) {
      const html = renderPromptSampleHtml(sample);
      for (const section of ["features", "workflow", "story", "pricing", "faq"]) expect(html).toContain(`data-bg-node-id="landing-${section}"`);
      expect((html.match(/<section\b/g) ?? []).length).toBeGreaterThanOrEqual(6);
      expect(html).toContain(sample.theme.bg);
      expect(html).toContain("<details>");
    }
    expect(renderPromptSampleHtml(PROMPT_SAMPLES.find((s) => s.slug === "daon-korean-saas")!)).toContain('<html lang="ko">');
    expect(renderPromptSampleHtml(PROMPT_SAMPLES.find((s) => s.layout === "dashboard")!)).not.toContain('data-bg-node-id="landing-pricing"');
  });
});
