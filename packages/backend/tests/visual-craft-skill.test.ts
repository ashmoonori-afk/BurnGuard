import { describe, expect, test } from "bun:test";
import { buildPrompt, MAX_SKILL_CHARS } from "../src/harness/prompt-builder";
import { COMPACT_PROTOTYPE_SKILL_MD } from "../src/harness/prompt-compact-skills";
import { DIAGRAM_SKILL_MD } from "../src/harness/skills/diagram-skill";
import {
  DECK_VISUAL_CRAFT,
  DEFAULT_VISUAL_IDENTITY,
  GRAPHIC_VISUAL_CRAFT,
  MAX_VISUAL_CRAFT_CHARS,
  PROTOTYPE_VISUAL_CRAFT,
  VISUAL_CRAFT_CORE,
} from "../src/harness/skills/visual-craft-skill";

type BuildContext = Parameters<typeof buildPrompt>[0];
type ProjectType = BuildContext["project"]["project_type"];

const TYPE_SENTINELS: Record<string, string> = {
  prototype: "PROTOTYPE_VISUAL_CRAFT",
  slide_deck: "DECK_VISUAL_CRAFT",
  graphic: "GRAPHIC_VISUAL_CRAFT",
};

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
  name: "Northvale",
  dir_path: "/missing/ds",
  skill_md_path: null,
  tokens_css_path: null,
  readme_md_path: null,
} as unknown as NonNullable<BuildContext["designSystem"]>;

describe("visual craft skill", () => {
  test("ships the core and the matching per-type craft block in both context modes", async () => {
    for (const projectType of ["prototype", "slide_deck", "graphic"] as const) {
      for (const contextMode of ["full", "compact"] as const) {
        const prompt = await buildPrompt(
          makeContext(projectType),
          { type: "user.message", text: "Build it" },
          { contextMode },
        );
        expect(prompt).toContain("## Visual craft");
        expect(prompt).toContain("VISUAL_CRAFT_CORE");
        for (const [type, sentinel] of Object.entries(TYPE_SENTINELS)) {
          if (type === projectType) {
            expect(prompt).toContain(sentinel);
          } else {
            expect(prompt).not.toContain(sentinel);
          }
        }
      }
    }
  });

  test("injects the default visual identity only when no design system is selected", async () => {
    for (const contextMode of ["full", "compact"] as const) {
      const bare = await buildPrompt(
        makeContext("prototype"),
        { type: "user.message", text: "Build it" },
        { contextMode },
      );
      expect(bare).toContain("## Default visual identity");
      expect(bare).toContain("DEFAULT_VISUAL_IDENTITY");

      const branded = await buildPrompt(
        makeContext("prototype", FAKE_DESIGN_SYSTEM),
        { type: "user.message", text: "Build it" },
        { contextMode },
      );
      expect(branded).not.toContain("DEFAULT_VISUAL_IDENTITY");
    }
  });

  test("keeps every visual block inside the per-turn budget", () => {
    const blocks = [
      VISUAL_CRAFT_CORE,
      PROTOTYPE_VISUAL_CRAFT,
      DECK_VISUAL_CRAFT,
      GRAPHIC_VISUAL_CRAFT,
      DEFAULT_VISUAL_IDENTITY,
    ];
    for (const block of blocks) {
      expect(block.length).toBeLessThanOrEqual(MAX_SKILL_CHARS);
    }
    const largestPerType = Math.max(
      PROTOTYPE_VISUAL_CRAFT.length,
      DECK_VISUAL_CRAFT.length,
      GRAPHIC_VISUAL_CRAFT.length,
    );
    expect(
      VISUAL_CRAFT_CORE.length + largestPerType + DEFAULT_VISUAL_IDENTITY.length,
    ).toBeLessThanOrEqual(MAX_VISUAL_CRAFT_CHARS);
  });

  test("diagram skill carries its visual craft section within budget", () => {
    expect(DIAGRAM_SKILL_MD).toContain("DIAGRAM_VISUAL_CRAFT");
    expect(DIAGRAM_SKILL_MD.length).toBeLessThanOrEqual(MAX_SKILL_CHARS);
  });

  test("compact prototype skill uses the WCAG 320 px reflow floor", () => {
    expect(COMPACT_PROTOTYPE_SKILL_MD).toContain("320");
    expect(COMPACT_PROTOTYPE_SKILL_MD).not.toContain("360 px");
  });
});
