import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildPrompt } from "../src/harness/prompt-builder";
import { resolveRepoRoot } from "../src/lib/paths";

const FONT_POINTER_SENTINEL = "BUNDLED_FONT_REFERENCE";

type BuildContext = Parameters<typeof buildPrompt>[0];
type ProjectType = BuildContext["project"]["project_type"];

const FAKE_DESIGN_SYSTEM = {
  name: "Northvale",
  dir_path: "/missing/ds",
  skill_md_path: null,
  tokens_css_path: null,
  readme_md_path: null,
} as unknown as NonNullable<BuildContext["designSystem"]>;

function makeContext(projectType: ProjectType, designSystem: BuildContext["designSystem"] = null): BuildContext {
  return {
    project: {
      project_id: `font-ref-${projectType}`,
      project_name: "Font reference test",
      project_type: projectType,
      entrypoint: projectType === "slide_deck" ? "deck.html" : "index.html",
      project_dir: path.join(import.meta.dir, "fixtures", "missing-font-project"),
      options_json: projectType === "graphic" ? JSON.stringify({ graphic_canvas: { width: 1080, height: 1350 } }) : null,
    },
    files: [],
    attachments: [],
    designSystem,
    openComments: [],
  } as BuildContext;
}

describe("bundled font reference", () => {
  test("Given the shipped font catalog, when read, then it carries the on-demand pointer sentinel next to fonts.css", async () => {
    const catalog = await readFile(path.join(resolveRepoRoot(), "assets/fonts/fonts.md"), "utf8");
    expect(catalog).toContain(`<!-- ${FONT_POINTER_SENTINEL} -->`);
  });

  test("Given any project type with or without a design system, when the prompt is built, then it points the agent at fonts/fonts.md", async () => {
    for (const projectType of ["prototype", "slide_deck", "graphic"] as const) {
      for (const designSystem of [null, FAKE_DESIGN_SYSTEM]) {
        for (const contextMode of ["full", "compact"] as const) {
          const prompt = await buildPrompt(makeContext(projectType, designSystem), { type: "user.message", text: "Build it" }, { contextMode });
          expect(prompt).toContain(FONT_POINTER_SENTINEL);
          expect(prompt).toContain("fonts/fonts.md");
        }
      }
    }
  });
});
