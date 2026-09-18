import { describe, expect, test } from "bun:test";
import { buildPrompt, MAX_SKILL_CHARS } from "../src/harness/prompt-builder";
import { COMPACT_DECK_SKILL_MD, COMPACT_PROTOTYPE_SKILL_MD } from "../src/harness/prompt-compact-skills";
import { DECK_SKILL_MD } from "../src/harness/skills/deck-skill";
import { DIAGRAM_SKILL_MD } from "../src/harness/skills/diagram-skill";
import {
  DECK_VISUAL_CRAFT,
  DEFAULT_VISUAL_IDENTITY,
  GRAPHIC_VISUAL_CRAFT,
  LOGO_VISUAL_CRAFT,
  MAX_VISUAL_CRAFT_CHARS,
  PROTOTYPE_VISUAL_CRAFT,
  VISUAL_CRAFT_CORE,
} from "../src/harness/skills/visual-craft-skill";

type BuildContext = Parameters<typeof buildPrompt>[0];
type ProjectType = BuildContext["project"]["project_type"];

const CRAFT_BY_TYPE: Record<string, string> = {
  prototype: PROTOTYPE_VISUAL_CRAFT,
  slide_deck: DECK_VISUAL_CRAFT,
  graphic: GRAPHIC_VISUAL_CRAFT,
};

const TYPE_SENTINELS: Record<string, string> = {
  prototype: "PROTOTYPE_VISUAL_CRAFT",
  slide_deck: "DECK_VISUAL_CRAFT",
  graphic: "GRAPHIC_VISUAL_CRAFT",
};

const IDENTITY_SENTINEL = "DEFAULT_VISUAL_IDENTITY";

function makeContext(
  projectType: ProjectType,
  designSystem: BuildContext["designSystem"] = null,
): BuildContext {
  return {
    project: {
      project_id: `visual-${projectType}`,
      project_name: "Visual craft test",
      project_type: projectType,
      entrypoint: projectType === "slide_deck" ? "deck.html" : "index.html",
      project_dir: `/missing/visual-${projectType}`,
      options_json: projectType === "graphic"
        ? JSON.stringify({ graphic_canvas: { width: 1080, height: 1350 } })
        : null,
    },
    files: [],
    attachments: [],
    designSystem,
    openComments: [],
  } as BuildContext;
}

const FAKE_DESIGN_SYSTEM = {
  id: "visual-craft-test-system",
  name: "Northvale",
  dir_path: "/missing/ds",
  skill_md_path: null,
  tokens_css_path: null,
  readme_md_path: null,
} as unknown as NonNullable<BuildContext["designSystem"]>;

/**
 * Returns the slice of `prompt` occupying the position of `block`, so the
 * caller can assert equality against the exported shipped string rather than
 * mere containment.
 */
function sliceShippedBlock(prompt: string, block: string): string {
  const shipped = block.trim();
  const heading = shipped.slice(0, shipped.indexOf("\n"));
  const start = prompt.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  return prompt.slice(start, start + shipped.length);
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

describe("visual craft skill", () => {
  test("ships the core and the matching per-type craft block verbatim in both context modes", async () => {
    for (const projectType of ["prototype", "slide_deck", "graphic"] as const) {
      for (const contextMode of ["full", "compact"] as const) {
        const prompt = await buildPrompt(
          makeContext(projectType),
          { type: "user.message", text: "Build it" },
          { contextMode },
        );
        expect(sliceShippedBlock(prompt, VISUAL_CRAFT_CORE)).toBe(VISUAL_CRAFT_CORE.trim());
        const craft = CRAFT_BY_TYPE[projectType]!;
        expect(sliceShippedBlock(prompt, craft)).toBe(craft.trim());
      }
    }
  });

  test("never leaks another deliverable type's craft sentinel into a selection", async () => {
    for (const projectType of ["prototype", "slide_deck", "graphic"] as const) {
      for (const contextMode of ["full", "compact"] as const) {
        const prompt = await buildPrompt(
          makeContext(projectType),
          { type: "user.message", text: "Build it" },
          { contextMode },
        );
        for (const [type, sentinel] of Object.entries(TYPE_SENTINELS)) {
          expect(countOccurrences(prompt, sentinel)).toBe(type === projectType ? 1 : 0);
        }
      }
    }
  });

  test("injects exactly one default visual identity only when no design system is selected", async () => {
    for (const projectType of ["prototype", "slide_deck", "graphic"] as const) {
      for (const contextMode of ["full", "compact"] as const) {
        const bare = await buildPrompt(
          makeContext(projectType),
          { type: "user.message", text: "Build it" },
          { contextMode },
        );
        expect(countOccurrences(bare, IDENTITY_SENTINEL)).toBe(1);
        expect(sliceShippedBlock(bare, DEFAULT_VISUAL_IDENTITY)).toBe(DEFAULT_VISUAL_IDENTITY.trim());

        const branded = await buildPrompt(
          makeContext(projectType, FAKE_DESIGN_SYSTEM),
          { type: "user.message", text: "Build it" },
          { contextMode },
        );
        expect(countOccurrences(branded, IDENTITY_SENTINEL)).toBe(0);
      }
    }
  });

  test("keeps every visual block inside the per-turn budget", () => {
    const blocks = [
      VISUAL_CRAFT_CORE,
      PROTOTYPE_VISUAL_CRAFT,
      DECK_VISUAL_CRAFT,
      GRAPHIC_VISUAL_CRAFT,
      LOGO_VISUAL_CRAFT,
      DEFAULT_VISUAL_IDENTITY,
    ];
    for (const block of blocks) {
      expect(block.length).toBeLessThanOrEqual(MAX_SKILL_CHARS);
    }
    const largestPerType = Math.max(
      PROTOTYPE_VISUAL_CRAFT.length,
      DECK_VISUAL_CRAFT.length,
      GRAPHIC_VISUAL_CRAFT.length,
      LOGO_VISUAL_CRAFT.length,
    );
    expect(MAX_VISUAL_CRAFT_CHARS).toBe(6400);
    expect(
      VISUAL_CRAFT_CORE.length + largestPerType + DEFAULT_VISUAL_IDENTITY.length,
    ).toBeLessThanOrEqual(MAX_VISUAL_CRAFT_CHARS);
  });

  test("compact deck skill ships the same projection scale as the full skill", () => {
    for (const declaration of [
      "--deck-type-hero: 80px",
      "--deck-type-heading: 52px",
      "--deck-type-body: 32px",
      "--deck-type-caption: 24px",
      "--deck-pad-slide: 72px",
    ]) {
      expect(COMPACT_DECK_SKILL_MD).toContain(declaration);
      expect(DECK_SKILL_MD).toContain(declaration);
    }
    expect(DECK_VISUAL_CRAFT).toContain("--deck-type-caption (24px)");
    expect(DECK_VISUAL_CRAFT).toContain("--deck-pad-slide");
  });

  test("diagram skill carries its visual craft section within budget", () => {
    expect(DIAGRAM_SKILL_MD).toContain("DIAGRAM_VISUAL_CRAFT");
    expect(DIAGRAM_SKILL_MD.length).toBeLessThanOrEqual(MAX_SKILL_CHARS);
  });

  test("the 320 px reflow floor lives in the prototype surfaces", () => {
    expect(COMPACT_PROTOTYPE_SKILL_MD).toContain("320");
    expect(COMPACT_PROTOTYPE_SKILL_MD).not.toContain("360 px");
    expect(PROTOTYPE_VISUAL_CRAFT).toContain("320px");
    expect(VISUAL_CRAFT_CORE).not.toContain("320");
  });
});
