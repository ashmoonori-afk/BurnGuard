import { beforeAll, describe, expect, test } from "bun:test";
import { getSqlite } from "../src/db/sqlite-client";
import { CHART_AUTHORING_RULES } from "../src/harness/chart-authoring";
import { buildPrompt } from "../src/harness/prompt-builder";
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
