import { beforeAll, describe, expect, test } from "bun:test";
import { getSqlite } from "../src/db/sqlite-client";
import { CHART_AUTHORING_RULES } from "../src/harness/chart-authoring";
import { DESIGN_CRAFT_RULES } from "../src/harness/design-craft";
import { buildPrompt } from "../src/harness/prompt-builder";
import {
  DEFAULT_VISUAL_IDENTITY,
  MAX_VISUAL_CRAFT_CHARS,
  PROTOTYPE_VISUAL_CRAFT,
  VISUAL_CRAFT_CORE,
} from "../src/harness/skills/visual-craft-skill";
import { ensureLearningSchema } from "./learning-fixture";

type BuildContext = Parameters<typeof buildPrompt>[0];
type ProjectType = BuildContext["project"]["project_type"];

const REQUEST = { type: "user.message", text: "Build it" } as const;

beforeAll(() => ensureLearningSchema(getSqlite()));

function makeContext(
  projectType: ProjectType,
  extra: Partial<Omit<BuildContext, "project">> = {},
  optionsJson: string | null = projectType === "graphic" ? JSON.stringify({ graphic_canvas: { schema_version: 1, width: 1080, height: 1350 } }) : null,
): BuildContext {
  return {
    project: {
      project_id: `guidance-${projectType}`,
      project_name: "Guidance consistency",
      project_type: projectType,
      entrypoint: projectType === "slide_deck" ? "deck.html" : "index.html",
      project_dir: `/missing/guidance-${projectType}`,
      options_json: optionsJson,
    },
    files: [],
    attachments: [],
    designSystem: null,
    openComments: [],
    ...extra,
  } as BuildContext;
}

/** The prompt text between two headings; the end heading may be absent when the section runs to the end. */
function section(prompt: string, start: string, end: string): string {
  const from = prompt.indexOf(start);
  expect(from, `${start} present`).toBeGreaterThanOrEqual(0);
  const to = prompt.indexOf(end, from + start.length);
  return prompt.slice(from, to === -1 ? undefined : to);
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("chart guidance", () => {
  test("PH-08: Given a full-mode deck prompt When the deck skill and deck craft blocks are sliced Then charts are native data-bg-chart figures and the chart rules ship once", async () => {
    const prompt = await buildPrompt(makeContext("slide_deck"), REQUEST, { contextMode: "full" });
    const skill = section(prompt, "## Slide deck skill", "## Visual craft");
    const craft = section(prompt, "## Deck craft (DECK_VISUAL_CRAFT)", "## Default visual identity");

    for (const block of [skill, craft]) {
      expect(block).not.toContain("inline SVG");
      expect(block).not.toContain("dot terminators");
      expect(block).toContain("data-bg-chart");
    }
    expect(countOccurrences(prompt, CHART_AUTHORING_RULES)).toBe(1);
  });
});

describe("palette guidance", () => {
  /** A warm off-white: red leads green leads blue by more than a rounding error. */
  const warmCream = (hex: string): boolean => {
    const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
    return r > g && g > b && r - b > 10;
  };

  test("PH-09: Given the default visual identity When its palette examples are parsed Then no light ground is a warm cream", () => {
    const palettes = [...DEFAULT_VISUAL_IDENTITY.matchAll(/--bg:#([0-9A-F]{6}) --surface:#([0-9A-F]{6}) --surface-2:#([0-9A-F]{6})/gu)];
    expect(palettes).toHaveLength(2);
    const light = palettes.filter(([, bg]) => [0, 2, 4].reduce((sum, offset) => sum + Number.parseInt(bg!.slice(offset, offset + 2), 16), 0) > 384);
    expect(light).toHaveLength(1);
    for (const [, bg, , surface2] of light) {
      expect(warmCream(bg!), `--bg #${bg}`).toBe(false);
      expect(warmCream(surface2!), `--surface-2 #${surface2}`).toBe(false);
    }
    expect(DEFAULT_VISUAL_IDENTITY).not.toContain("--bg:#F6F1E8");
  });
});

describe("Hangul typography guidance", () => {
  const KOREAN_BRIEF = JSON.stringify({
    design_brief: {
      schema_version: 1, output_type: "prototype", audience: "방문자", objective: "서비스 소개", content_source: "none",
      locale: "ko", brand_mode: "none", visual_mood: "formal", density: "balanced", output_size: "responsive",
    },
  });

  test("PH-12/CSS-19: Given a Korean brief without a design system When the prompt is built in both modes Then Hangul rules ship once before the request within the craft budget", async () => {
    for (const contextMode of ["full", "compact"] as const) {
      const prompt = await buildPrompt(makeContext("prototype", {}, KOREAN_BRIEF), REQUEST, { contextMode });
      const request = prompt.indexOf("## Request");
      expect(prompt.slice(0, request)).toContain("keep-all");
      expect(prompt.slice(0, request)).toContain("Hangul");
      expect(countOccurrences(prompt, DESIGN_CRAFT_RULES)).toBe(1);
    }
    expect(VISUAL_CRAFT_CORE).toMatch(/-0\.04em \(Latin only\)/u);
    expect(VISUAL_CRAFT_CORE.length + PROTOTYPE_VISUAL_CRAFT.length + DEFAULT_VISUAL_IDENTITY.length).toBeLessThanOrEqual(MAX_VISUAL_CRAFT_CHARS - 118);
  });
});

describe("prototype viewport guidance", () => {
  test("OWN-5: Given the website craft block Then it names the audited widths beside the 320px authoring floor within the craft budget", () => {
    // design-audit.ts renders responsive pages at 1280x900 and 375x812; the craft block must not promise a third measured width.
    for (const width of ["1280", "375", "320px"]) expect(PROTOTYPE_VISUAL_CRAFT).toContain(width);
    expect(PROTOTYPE_VISUAL_CRAFT).toContain("audits");
    expect(VISUAL_CRAFT_CORE.length + PROTOTYPE_VISUAL_CRAFT.length + DEFAULT_VISUAL_IDENTITY.length).toBeLessThanOrEqual(MAX_VISUAL_CRAFT_CHARS - 118);
  });
});
