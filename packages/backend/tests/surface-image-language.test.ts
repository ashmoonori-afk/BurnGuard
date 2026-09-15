import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildPrompt } from "../src/harness/prompt-builder";
import { resolveRepoRoot } from "../src/lib/paths";

type PromptContext = Parameters<typeof buildPrompt>[0];

function context(slug: string, projectType: "graphic" | "slide_deck" | "prototype"): PromptContext {
  const dir = path.join(resolveRepoRoot(), "design system themes", slug);
  return {
    project: {
      project_id: `image-language-${slug}`,
      project_name: "Image language test",
      project_type: projectType,
      entrypoint: projectType === "slide_deck" ? "deck.html" : "index.html",
      project_dir: "/missing/image-language",
      options_json: projectType === "graphic"
        ? JSON.stringify({ graphic_canvas: { width: 1080, height: 1350 } })
        : null,
    },
    files: [],
    attachments: [],
    openComments: [],
    designSystem: {
      id: `builtin-theme-${slug}`,
      name: slug,
      dir_path: dir,
      skill_md_path: null,
      tokens_css_path: path.join(dir, "colors_and_type.css"),
      readme_md_path: path.join(dir, "README.md"),
    },
  } as unknown as PromptContext;
}

/** The labelled fields a theme's `## Image direction` section is written in. */
async function imageDirectionFields(slug: string): Promise<Map<string, string>> {
  const readme = await readFile(path.join(resolveRepoRoot(), "design system themes", slug, "README.md"), "utf8");
  const section = /^## Image direction\s*\r?\n([\s\S]*?)(?=^## )/m.exec(readme)?.[1] ?? "";
  return new Map(
    [...section.matchAll(/\*\*([A-Z][^.*]{2,40})[.:]\*\*\s*([^\n*]{20,})/g)]
      .map((match) => [match[1]!.trim(), match[2]!.trim()] as const),
  );
}

/**
 * A theme's imagery is the strongest thing that separates one design system's artboards from another's:
 * subject, treatment, light and palette behaviour. Every original theme authors ~2k characters of it,
 * and until this contract existed none of it reached a fixed-surface turn — the model only ever saw the
 * generic craft recipe, which is why every theme produced the same looking artboard.
 *
 * Framing is deliberately excluded: on a fixed frame the framing is the surface's job
 * (`--content-anchor`, `--content-figure`, `--slide-pad-edge`), and several themes phrase that field
 * against the website opening's hero geometry, which must never reach a slide or an artboard.
 */
describe("Theme image language on fixed surfaces", () => {
  const THEMES = ["night-marquee", "signal-console", "index-table"] as const;

  test("Given an optional imagery section, then its enforcement only appears when authored", async () => {
    for (const projectType of ["graphic", "slide_deck"] as const) for (const contextMode of ["full", "compact"] as const) {
      const absent = await buildPrompt(context("light", projectType), { type: "user.message", text: "Make it" }, { contextMode });
      const present = await buildPrompt(context("night-marquee", projectType), { type: "user.message", text: "Make it" }, { contextMode });
      expect(absent).not.toContain("<selected_design_system_imagery_rules>");
      expect(present).toContain("<selected_design_system_imagery_rules>");
    }
  });

  test("Given a graphic project, then the theme's own subject, treatment and light reach the model", async () => {
    for (const slug of THEMES) {
      const fields = await imageDirectionFields(slug);
      expect(fields.size, `${slug}: parsed image-direction fields`).toBeGreaterThan(0);
      for (const contextMode of ["full", "compact"] as const) {
        const prompt = await buildPrompt(context(slug, "graphic"), { type: "user.message", text: "Make it" }, { contextMode });
        for (const field of ["Subject", "Treatment", "Light"]) {
          const value = fields.get(field);
          if (value === undefined) continue;
          const probe = value.slice(0, 48);
          expect(prompt.includes(probe), `${slug}/${contextMode}: ${field} — "${probe}"`).toBe(true);
        }
      }
    }
  });

  test("Given a slide deck, then the same imagery direction reaches the model", async () => {
    const fields = await imageDirectionFields("night-marquee");
    const subject = fields.get("Subject")!.slice(0, 48);
    for (const contextMode of ["full", "compact"] as const) {
      const prompt = await buildPrompt(context("night-marquee", "slide_deck"), { type: "user.message", text: "Make it" }, { contextMode });
      expect(prompt.includes(subject), `slides/${contextMode}`).toBe(true);
    }
  });

  test("Given a fixed surface, then website framing never rides in on the imagery", async () => {
    // night-marquee's Framing field is written against the website opening; a slide has no hero region.
    const fields = await imageDirectionFields("night-marquee");
    const framing = fields.get("Framing");
    expect(framing, "night-marquee authors a Framing field").toBeDefined();
    for (const projectType of ["graphic", "slide_deck"] as const) for (const contextMode of ["full", "compact"] as const) {
      const prompt = await buildPrompt(context("night-marquee", projectType), { type: "user.message", text: "Make it" }, { contextMode });
      expect(prompt.includes(framing!.slice(0, 48)), `${projectType}: framing must stay out`).toBe(false);
      expect(prompt).not.toContain("--layout-hero-media-position");
    }
  });

  test("Given a website project, then nothing about its existing layout contract changed", async () => {
    const prompt = await buildPrompt(context("night-marquee", "prototype"), { type: "user.message", text: "Make it" }, { contextMode: "compact" });
    expect(prompt).toContain("<selected_design_system_layout>");
    expect(prompt).toContain('<selected_design_system_surface surface="website">');
    // The website surface keeps taking its imagery from the layout contract's own sections.
    expect(prompt.split("<selected_design_system_surface").length - 1).toBe(1);
  });
});
