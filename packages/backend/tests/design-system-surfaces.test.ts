import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  CONTENT_TYPE_FLOOR_PX,
  DESIGN_SURFACE_FILES,
  DESIGN_SURFACES,
  extractDesignSystemSurface,
  missingDesignSystemSurface,
  parseDesignSystemSurface,
  REQUIRED_SURFACE_TOKENS,
  supplementDesignSystemSurface,
  surfaceForProjectType,
  type DesignSurface,
} from "@bg/shared";
import { bundledDesignSystems } from "../src/data/bundled-design-systems";
import { originalSamples } from "../src/data/original-samples";
import { resolveRepoRoot } from "../src/lib/paths";
import { readDesignSystemSurface } from "../src/services/design-system-surface";
import { buildPrompt } from "../src/harness/prompt-builder";

/** Every design system that ships with the app and therefore owes the complete surface contract. */
const SHIPPED_SYSTEMS = [
  ...bundledDesignSystems.map((theme) => ["design system themes", theme.slug]),
  ...originalSamples.map((sample) => ["samples", "original", sample.slug, "design-system"]),
  ["design system sample"],
];

async function readSurfaceFiles(dir: readonly string[]): Promise<Record<DesignSurface, string>> {
  const root = path.join(resolveRepoRoot(), ...dir);
  const entries = await Promise.all(
    DESIGN_SURFACES.map(async (surface) =>
      [surface, await readFile(path.join(root, DESIGN_SURFACE_FILES[surface].split("/").join(path.sep)), "utf8")] as const),
  );
  return Object.fromEntries(entries) as Record<DesignSurface, string>;
}

type PromptContext = Parameters<typeof buildPrompt>[0];

function promptContext(projectType: string, dirPath: string): PromptContext {
  return {
    project: {
      project_id: `surface-${projectType}`,
      project_name: "Surface test",
      project_type: projectType,
      entrypoint: projectType === "slide_deck" ? "deck.html" : "index.html",
      project_dir: "/missing/surface-project",
      options_json: projectType === "graphic" ? JSON.stringify({ graphic_canvas: { width: 1080, height: 1350 } }) : null,
    },
    files: [],
    attachments: [],
    designSystem: {
      id: "builtin-theme-night-marquee",
      name: "Night Marquee",
      dir_path: dirPath,
      skill_md_path: null,
      tokens_css_path: path.join(dirPath, "colors_and_type.css"),
      readme_md_path: path.join(dirPath, "README.md"),
    },
    openComments: [],
  } as unknown as PromptContext;
}

describe("Design system surfaces", () => {
  test("Given a project type, then its surface follows the deliverable rather than a user choice", () => {
    expect(surfaceForProjectType("prototype")).toBe("website");
    expect(surfaceForProjectType("slide_deck")).toBe("slides");
    expect(surfaceForProjectType("graphic")).toBe("content");
    expect(surfaceForProjectType("from_template")).toBe("website");
    expect(surfaceForProjectType("other")).toBe("website");
  });

  test("Given every shipped design system, then all three surfaces are complete and contract-valid", async () => {
    for (const dir of SHIPPED_SYSTEMS) {
      const files = await readSurfaceFiles(dir);
      const readme = await readFile(path.join(resolveRepoRoot(), ...dir, "README.md"), "utf8");
      for (const section of ["## Surfaces", "## Slide deck", "## Content artboards"]) {
        expect(readme, `${dir.join("/")}: ${section}`).toContain(section);
      }
      for (const surface of DESIGN_SURFACES) {
        const contract = extractDesignSystemSurface(files[surface], readme, surface);
        expect({ system: dir.join("/"), surface, missing: missingDesignSystemSurface(contract) })
          .toEqual({ system: dir.join("/"), surface, missing: [] });
        expect(parseDesignSystemSurface(contract)).toEqual(contract);
        // A surface file is tokens only: colour stays in colors_and_type.css and nothing is imported.
        expect(files[surface], `${dir.join("/")}: ${surface}`).not.toMatch(/@import|#[0-9a-f]{3,8}\b|rgb\(|oklch\(/i);
        expect(files[surface].match(/\{/g) ?? []).toHaveLength(1);
      }
    }
  });

  test("Given a shipped slides surface, then projection geometry is fixed and readable", async () => {
    for (const dir of SHIPPED_SYSTEMS) {
      const files = await readSurfaceFiles(dir);
      const slides = extractDesignSystemSurface(files.slides, "", "slides").tokens;
      // Authoring, the design audit and both exporters all assume one deck geometry.
      expect({ system: dir.join("/"), w: slides["--slide-w"], h: slides["--slide-h"], aspect: slides["--slide-aspect"] })
        .toEqual({ system: dir.join("/"), w: "1920px", h: "1080px", aspect: "16 / 9" });
      const px = (name: string): number => Number.parseFloat(slides[name]!);
      expect(px("--slide-type-caption"), `${dir.join("/")} caption`).toBeGreaterThanOrEqual(24);
      expect(px("--slide-type-caption")).toBeLessThanOrEqual(px("--slide-type-body"));
      expect(px("--slide-type-body")).toBeLessThanOrEqual(px("--slide-type-heading"));
      expect(px("--slide-type-heading")).toBeLessThanOrEqual(px("--slide-type-hero"));
      expect(px("--slide-pad-edge"), `${dir.join("/")} safe area`).toBeGreaterThanOrEqual(64);
    }
  });

  test("Given a shipped content surface, then the safe area and figure stay inside usable bounds", async () => {
    for (const dir of SHIPPED_SYSTEMS) {
      const files = await readSurfaceFiles(dir);
      const content = extractDesignSystemSurface(files.content, "", "content").tokens;
      const safe = Number(content["--content-safe"]);
      expect(safe, `${dir.join("/")} safe`).toBeGreaterThanOrEqual(0.06);
      expect(safe).toBeLessThanOrEqual(0.12);
      const figure = Number(content["--content-figure"]);
      expect(figure, `${dir.join("/")} figure`).toBeGreaterThanOrEqual(0.3);
      expect(figure).toBeLessThanOrEqual(0.8);
      expect(Number.parseFloat(content["--content-type-caption"]!)).toBeGreaterThanOrEqual(CONTENT_TYPE_FLOOR_PX);
    }
  });

  test("Given two systems with opposite openings, then their fixed surfaces differ in more than colour", async () => {
    // The whole point of the split: a type-led poster theme and a dense data theme must not produce the
    // same deck and the same artboard. Colour and fonts already differed before surfaces existed.
    const [poster, data] = await Promise.all([
      readSurfaceFiles(["design system themes", "night-marquee"]),
      readSurfaceFiles(["design system themes", "index-table"]),
    ]);
    const slidesOf = (files: Record<DesignSurface, string>) => extractDesignSystemSurface(files.slides, "", "slides").tokens;
    const contentOf = (files: Record<DesignSurface, string>) => extractDesignSystemSurface(files.content, "", "content").tokens;
    expect(Number.parseFloat(slidesOf(poster)["--slide-type-hero"]!))
      .toBeGreaterThan(Number.parseFloat(slidesOf(data)["--slide-type-hero"]!));
    expect(Number.parseFloat(slidesOf(poster)["--slide-pad-edge"]!))
      .toBeGreaterThan(Number.parseFloat(slidesOf(data)["--slide-pad-edge"]!));
    expect(Number(contentOf(poster)["--content-figure"]!))
      .toBeLessThan(Number(contentOf(data)["--content-figure"]!));
  });

  test("Given an unusable or unknown value, then it is rejected so the default can take over", () => {
    const hostile = extractDesignSystemSurface(
      ":root { --content-safe: red; --content-base: 1080px; --content-anchor: nowhere; --content-bleed: 2; --content-figure: url(file:///private); --content-columns: 6; --slide-w: 1920px; }",
      "",
      "content",
    );
    expect(hostile.tokens["--content-safe"]).toBeUndefined();
    expect(hostile.tokens["--content-anchor"]).toBeUndefined();
    expect(hostile.tokens["--content-bleed"]).toBeUndefined();
    expect(hostile.tokens["--content-figure"]).toBeUndefined();
    // Another surface's token never rides in on this one.
    expect(hostile.tokens["--slide-w"]).toBeUndefined();
    expect(hostile.tokens["--content-base"]).toBe("1080px");
    expect(missingDesignSystemSurface(hostile).length).toBeGreaterThan(0);
    expect(() => parseDesignSystemSurface({ ...hostile, tokens: { "--content-safe": "red" } })).toThrow();
    expect(() => parseDesignSystemSurface({ ...hostile, supplied: ["--content-unknown"] })).toThrow();
  });

  test("Given an installation without surface files, then the bundled system supplies them and records that", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bg-surface-"));
    try {
      const css = path.join(dir, "colors_and_type.css");
      const readme = path.join(dir, "README.md");
      await writeFile(css, ":root { --layout-max: 999px; }");
      await writeFile(readme, "## Composition\n\nKeep the authored composition.\n");
      const system = { id: "builtin-theme-night-marquee", dir_path: dir, tokens_css_path: css, readme_md_path: readme };
      for (const surface of DESIGN_SURFACES) {
        const { contract, file } = await readDesignSystemSurface(system, surface);
        expect(missingDesignSystemSurface(contract)).toEqual([]);
        expect(file).toBeNull();
        for (const token of REQUIRED_SURFACE_TOKENS[surface]) expect(contract.supplied).toContain(token);
      }
      // A system the app does not ship still resolves, from the derived defaults alone.
      const custom = await readDesignSystemSurface({ ...system, id: "user-made" }, "slides");
      expect(custom.contract.tokens["--slide-type-caption"]).toBe("24px");
      expect(missingDesignSystemSurface(custom.contract)).toEqual(["slides"]);
      // Reading never writes into the system directory.
      expect(await readFile(css, "utf8")).toBe(":root { --layout-max: 999px; }");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("Given a local value, then supplementing keeps it and only reports what it filled", () => {
    const local = extractDesignSystemSurface(":root { --slide-pad-edge: 96px; }", "", "slides");
    const filled = supplementDesignSystemSurface(local, {
      schema_version: 1,
      surface: "slides",
      tokens: { "--slide-pad-edge": "72px", "--slide-type-body": "32px" },
      sections: [{ kind: "slides", text: "bundled slide rules" }],
      supplied: [],
    });
    expect(filled.tokens["--slide-pad-edge"]).toBe("96px");
    expect(filled.tokens["--slide-type-body"]).toBe("32px");
    expect(filled.supplied).toEqual(["--slide-type-body", "slides"]);
  });

  test("Given a fixed-surface project, then the prompt withholds website geometry but keeps brand rules", async () => {
    const themeDir = path.join(resolveRepoRoot(), "design system themes", "night-marquee");
    const expectations = {
      prototype: { layout: true, surface: "website" },
      slide_deck: { layout: false, surface: "slides" },
      graphic: { layout: false, surface: "content" },
    } as const;
    for (const [projectType, expected] of Object.entries(expectations)) {
      for (const contextMode of ["full", "compact"] as const) {
        const prompt = await buildPrompt(
          promptContext(projectType, themeDir),
          { type: "user.message", text: "Build it" },
          { contextMode },
        );
        const label = `${projectType}/${contextMode}`;
        expect(prompt, label).toContain(`<selected_design_system_surface surface="${expected.surface}">`);
        expect(prompt.split("<selected_design_system_surface").length - 1, label).toBe(1);
        expect(prompt, label).toContain("untrusted design data");
        // The layout contract is emitted for every surface, but a fixed frame receives only its
        // brand half: no grid, no navigation, hero or footer geometry.
        const block = /<selected_design_system_layout>\n([^\n]+)\n<\/selected_design_system_layout>/.exec(prompt);
        expect(block, label).not.toBeNull();
        const layout = JSON.parse(block![1]!) as { tokens: Record<string, string>; sections: { kind: string }[] };
        expect(Object.keys(layout.tokens).some((token) => token.startsWith("--layout-")), label).toBe(expected.layout);
        expect(layout.sections.some((section) => section.kind === "composition"), label).toBe(true);
        if (!expected.layout) {
          expect(layout.sections.map((section) => section.kind), label).toEqual(["composition"]);
          expect(Object.keys(layout.tokens).every((token) => token.startsWith("--family-")), label).toBe(true);
        }
      }
    }
  });
});
