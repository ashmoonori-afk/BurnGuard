import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { designSystemLayoutPreview, extractDesignSystemLayout, missingDesignSystemLayout, parseDesignSystemLayout, supplementDesignSystemLayout } from "@bg/shared";
import { bundledDesignSystems } from "../src/data/bundled-design-systems";
import { originalSamples } from "../src/data/original-samples";
import { SAMPLE_LAYOUTS, sampleLayoutFiles } from "../src/data/sample-layouts";
import { PROMPT_SAMPLES } from "../src/db/seed-tutorials";
import { resolveRepoRoot } from "../src/lib/paths";
import { readDesignSystemLayout } from "../src/services/design-system-layout";

describe("Design system layout contract", () => {
  test("Given every bundled theme and preset, then grid, composition and responsive rules are complete", async () => {
    const dirs = [...bundledDesignSystems.map(s => ["design system themes", s.slug]), ...originalSamples.map(s => ["samples", "original", s.slug, "design-system"]), ["design system sample"]];
    for (const dir of dirs) {
      const root = path.join(resolveRepoRoot(), ...dir);
      const [css, readme] = await Promise.all([readFile(path.join(root, "colors_and_type.css"), "utf8"), readFile(path.join(root, "README.md"), "utf8")]);
      const layout = extractDesignSystemLayout(css, readme);
      expect({ system: dir.join("/"), missing: missingDesignSystemLayout(layout) }).toEqual({ system: dir.join("/"), missing: [] });
      expect(parseDesignSystemLayout(layout)).toEqual(layout);
    }
    for (const key of Object.keys(SAMPLE_LAYOUTS) as (keyof typeof SAMPLE_LAYOUTS)[]) expect(missingDesignSystemLayout(sampleLayoutFiles(key).layout)).toEqual([]);
  });

  test("Given old installed systems, when reading rules, then missing rules are supplied without changing authored files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bg-layout-"));
    try {
      const css = path.join(dir, "colors_and_type.css");
      const readme = path.join(dir, "README.md");
      await writeFile(css, ":root { --layout-max: 999px; }");
      await writeFile(readme, "## Composition\n\nKeep the authored layout.\n");
      for (const id of ["builtin-theme-dark", ...PROMPT_SAMPLES.map(s => `sample-system-${s.slug}`), "splash", "sample-system-original-halide", "northvale-capital"]) {
        const layout = await readDesignSystemLayout({ id, dir_path: dir, tokens_css_path: css, readme_md_path: readme });
        expect(missingDesignSystemLayout(layout)).toEqual([]);
        expect(layout.tokens["--layout-max"]).toBe("999px");
        expect(layout.sections.find(s => s.kind === "composition")?.text).toBe("Keep the authored layout.");
        expect(layout.supplemented).toBe(true);
      }
      const custom = await readDesignSystemLayout({ id: "manual-layout", dir_path: dir, tokens_css_path: css, readme_md_path: readme });
      expect(custom.supplemented).toBe(false);
      const missingRoot = path.join(dir, "missing");
      expect((await readDesignSystemLayout({ id: "builtin-theme-dark", dir_path: missingRoot, tokens_css_path: path.join(missingRoot, "colors_and_type.css"), readme_md_path: null })).supplemented).toBe(true);
      expect(missingDesignSystemLayout(custom).length).toBeGreaterThan(0);
      expect(await readFile(css, "utf8")).toBe(":root { --layout-max: 999px; }");
      expect(await readFile(readme, "utf8")).toBe("## Composition\n\nKeep the authored layout.\n");
      await expect(readDesignSystemLayout({ id: "manual", dir_path: dir, tokens_css_path: path.join(dir, "..", "private.css"), readme_md_path: null })).rejects.toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  test("Given untrusted layout text, then executable values and unbounded or unknown fields are rejected", () => {
    const layout = extractDesignSystemLayout('/* --layout-max: 1px; */ :root { --layout-max: 1200px; --layout-hero: url(https://invalid.test); --family-ui-navigation-placement: side; }', '## Layout\n\nGrid.\n\n## Composition\n\nStory.\n\n## Responsive behavior\n\nStack.\n\n## Private\n\nExclude.');
    expect(layout.tokens["--layout-max"]).toBe("1200px");
    expect(layout.tokens["--layout-hero"]).toBeUndefined();
    expect(extractDesignSystemLayout(':root { --layout-max: 1200px; } :root { --layout-max: 900px; }', "").tokens["--layout-max"]).toBe("900px");
    expect(layout.sections.map(s => s.kind)).toEqual(["layout", "composition", "responsive"]);
    expect(JSON.stringify(layout)).not.toContain("Exclude");
    expect(() => parseDesignSystemLayout({ ...layout, private_path: "hidden" })).toThrow();
    expect(() => parseDesignSystemLayout({ ...layout, tokens: { "--layout-max": "url(file:///private)" } })).toThrow();
    expect(() => parseDesignSystemLayout({ ...layout, sections: [{ kind: "layout", text: "x".repeat(1801) }] })).toThrow();
    const authored = extractDesignSystemLayout(':root { --layout-max: 900px; }', '## Composition\nAuthored');
    expect(supplementDesignSystemLayout(authored, layout).tokens["--layout-max"]).toBe("900px");
  });

  test("Given different system geometry, then summaries reflect the system and remain bounded", () => {
    const split = designSystemLayoutPreview(sampleLayoutFiles("split-saas").layout);
    const dashboard = designSystemLayoutPreview(sampleLayoutFiles("dashboard").layout);
    const centered = designSystemLayoutPreview(sampleLayoutFiles("liquid-orb").layout);
    expect(split.blocks).not.toEqual(dashboard.blocks);
    expect(split.blocks).not.toEqual(centered.blocks);
    const extreme = designSystemLayoutPreview(extractDesignSystemLayout(':root { --layout-max: 320px; --layout-columns: 24; --layout-gutter: 80px; }', ""));
    for (const preview of [split, dashboard, centered, extreme]) {
      expect(preview.unit).toBeGreaterThan(0);
      for (const block of preview.blocks) {
        expect(block.width).toBeGreaterThan(0);
        expect(block.x + block.width).toBeLessThanOrEqual(640);
        expect(block.y + block.height).toBeLessThanOrEqual(360);
      }
    }
  });
});
