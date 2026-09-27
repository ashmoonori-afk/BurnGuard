import { describe, expect, test } from "bun:test";
import { buildPrompt } from "../src/harness/prompt-builder";
import { COMPACT_TASTE_REFERENCE } from "../src/harness/prompt-compact-skills";
import {
  MAX_TASTE_CHARS,
  TASTE_BY_TYPE,
  TASTE_CORE,
} from "../src/harness/skills/taste-skill";

type BuildContext = Parameters<typeof buildPrompt>[0];
type ProjectType = BuildContext["project"]["project_type"];

function makeContext(projectType: ProjectType): BuildContext {
  return {
    project: {
      project_id: `taste-${projectType}`,
      project_name: "Taste test",
      project_type: projectType,
      entrypoint: projectType === "slide_deck" ? "deck.html" : "index.html",
      project_dir: `/missing/taste-${projectType}`,
      options_json: projectType === "graphic"
        ? JSON.stringify({ graphic_canvas: { width: 1080, height: 1350 } })
        : null,
    },
    files: [],
    attachments: [],
    designSystem: null,
    openComments: [],
  } as BuildContext;
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("taste skill", () => {
  test("Given prototype, deck and graphic projects When full prompts are built Then core and only the matching type sentinel ship", async () => {
    const sentinels = {
      prototype: "PROTOTYPE_TASTE",
      slide_deck: "DECK_TASTE",
      graphic: "GRAPHIC_TASTE",
    } as const;
    for (const projectType of ["prototype", "slide_deck", "graphic"] as const) {
      const prompt = await buildPrompt(
        makeContext(projectType),
        { type: "user.message", text: "Build it" },
        { contextMode: "full" },
      );
      expect(count(prompt, "TASTE_CORE")).toBe(1);
      for (const [type, sentinel] of Object.entries(sentinels)) {
        expect(count(prompt, sentinel)).toBe(type === projectType ? 1 : 0);
      }
      expect(prompt).not.toContain("TASTE_COMPACT_REFERENCE");
    }
  });

  test("Given a visual project When compact mode is built Then only the compact taste reference ships", async () => {
    for (const projectType of ["prototype", "slide_deck", "graphic"] as const) {
      const prompt = await buildPrompt(
        makeContext(projectType),
        { type: "user.message", text: "Build it" },
        { contextMode: "compact" },
      );
      expect(count(prompt, "TASTE_COMPACT_REFERENCE")).toBe(1);
      expect(prompt).toContain(COMPACT_TASTE_REFERENCE.trim());
      expect(prompt).not.toContain("TASTE_CORE");
      for (const sentinel of ["PROTOTYPE_TASTE", "DECK_TASTE", "GRAPHIC_TASTE"]) {
        expect(prompt).not.toContain(sentinel);
      }
    }
  });

  test("Given logo, diagram and generic turns When prompts are built Then cross-cutting taste follows visual deliverables only", async () => {
    const logo = await buildPrompt(makeContext("logo"), { type: "user.message", text: "Create a mark" });
    const diagram = await buildPrompt(makeContext("other"), { type: "user.message", text: "Create a flowchart diagram" });
    const generic = await buildPrompt(makeContext("other"), { type: "user.message", text: "Update the notes" });
    expect(count(logo, "TASTE_CORE")).toBe(1);
    expect(count(diagram, "TASTE_CORE")).toBe(1);
    expect(generic).not.toContain("## Taste");
    expect(generic).not.toContain("TASTE_CORE");
    expect(generic).not.toContain("TASTE_COMPACT_REFERENCE");
  });

  test("Given every full taste combination When measured Then the per-turn budget holds", () => {
    expect(MAX_TASTE_CHARS).toBe(3000);
    for (const block of Object.values(TASTE_BY_TYPE)) {
      expect(TASTE_CORE.length + block.length).toBeLessThanOrEqual(MAX_TASTE_CHARS);
    }
    expect(TASTE_CORE.length).toBeLessThanOrEqual(MAX_TASTE_CHARS);
  });
});
