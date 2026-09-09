import { describe, expect, test } from "bun:test";
import { buildPrompt, MAX_SKILL_CHARS } from "../src/harness/prompt-builder";
import { PROTOTYPE_NAVIGATION_CONTRACT, PROTOTYPE_SKILL_MD } from "../src/harness/skills/prototype-skill";

const SPATIAL_SENTINELS = ["scroll-owner", "wrap-first", "load-bearing"];
const ORIGINAL_ARCHETYPE_DESCRIPTIONS = [
  "large centered headline + subheadline + single CTA",
  "copy left, product shot or illustration right",
  "full-bleed loop + dark overlay + centered copy",
  "3-column responsive cards (icon + title + body)",
  "image/text rows flipping L↔R every row",
  "horizontal monochrome row of customer logos",
  "oversized pull quote + attribution, calm background",
  "2–3 column testimonial cards",
  'side-by-side tier cards, "popular" tier highlighted',
  "3–4 oversized numbers + labels, thin dividers",
  "disclosure pattern using `<details><summary>`",
  "narrow band, one sentence + button, edge-to-edge",
  "three-column logo / link groups / legal",
];

describe("prototype spatial layout vocabulary", () => {
  test("Given full compact and vanilla modes When building a prompt Then only prototypes receive the shared navigation contract once", async () => {
    for (const projectType of ["prototype", "slide_deck", "graphic"] as const) {
      for (const contextMode of ["full", "compact"] as const) {
        for (const vanilla of [false, true]) {
          const prompt = await buildPrompt({
            project: {
              project_id: "prototype-navigation-test",
              project_name: "Prototype navigation test",
              project_type: projectType,
              entrypoint: "index.html",
              project_dir: "/missing/prototype-navigation-test",
              options_json: null,
            },
            files: [], attachments: [], designSystem: null, openComments: [],
          }, { type: "user.message", text: "Build the requested website" }, {
            contextMode,
            backendId: "codex",
            generation: { model: "gpt-5.4", provider: "native", effort: "low", vanilla },
          });
          expect(prompt.split(PROTOTYPE_NAVIGATION_CONTRACT.trim())).toHaveLength(projectType === "prototype" ? 2 : 1);
        }
      }
    }
  });

  test("ships each spatial rule group in the built prototype prompt", async () => {
    const prompt = await buildPrompt(
      {
        project: {
          project_id: "spatial-layout-test",
          project_name: "Spatial layout test",
          project_type: "prototype",
          entrypoint: "index.html",
          project_dir: "/missing/spatial-layout-test",
          options_json: null,
        },
        files: [],
        attachments: [],
        designSystem: null,
        openComments: [],
      },
      { type: "user.message", text: "Build a responsive page" },
    );

    for (const sentinel of SPATIAL_SENTINELS) {
      expect(prompt).toContain(sentinel);
    }
  });

  test("retains the original archetype descriptions", () => {
    for (const description of ORIGINAL_ARCHETYPE_DESCRIPTIONS) {
      expect(PROTOTYPE_SKILL_MD).toContain(description);
    }
  });

  test("retains the dedicated Don'ts guardrails", () => {
    expect(PROTOTYPE_SKILL_MD).toContain("## Don'ts");
    expect(PROTOTYPE_SKILL_MD).toContain("Vite");
    expect(PROTOTYPE_SKILL_MD).toContain("npm install");
  });

  test("stays within the injected skill budget", () => {
    expect(PROTOTYPE_SKILL_MD.length).toBeLessThanOrEqual(MAX_SKILL_CHARS);
  });
});
