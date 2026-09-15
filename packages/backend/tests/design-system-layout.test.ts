import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { LAYOUT_SECTION_KINDS, designSystemLayoutPreview, extractDesignSystemLayout, missingDesignSystemLayout, parseDesignSystemLayout, supplementDesignSystemLayout } from "@bg/shared";
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
    const catalogue = await readFile(path.join(resolveRepoRoot(), "design system themes", "catalogue.html"), "utf8");
    expect(catalogue).not.toMatch(/:root\s*\{[^}]*--layout-/);
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

  test("Given a version-one installed layout, then missing region rules supplement its authored composition without making new sections mandatory", () => {
    const legacy = sampleLayoutFiles("split-saas").layout;
    const authored = extractDesignSystemLayout(":root { --layout-nav-pattern: authored-nav; --layout-nav-h: 64px; --layout-hero: 16 / 10; }", "## Composition\nAUTHORED_COMPOSITION\n## Hero\nAUTHORED_HERO");
    const regions = extractDesignSystemLayout(":root { --layout-nav-pattern: bundled-nav; --layout-hero-pattern: bundled-hero; --layout-footer-pattern: bundled-footer; --layout-nav-height: 96px; --layout-hero-media-ratio: 3 / 1; }", "## Navigation\nNAV_RULE\n## Hero\nHERO_RULE\n## Footer\nFOOTER_RULE");
    const bundled = supplementDesignSystemLayout(legacy, regions);
    const actual = supplementDesignSystemLayout(authored, bundled);
    expect(parseDesignSystemLayout(legacy)).toEqual(legacy);
    expect(missingDesignSystemLayout(legacy)).toEqual([]);
    expect(parseDesignSystemLayout(actual)).toEqual(actual);
    expect(actual.tokens["--layout-nav-pattern"]).toBe("authored-nav");
    expect(actual.tokens["--layout-footer-pattern"]).toBe("bundled-footer");
    expect(actual.tokens["--layout-nav-h"]).toBe("64px");
    expect(actual.tokens["--layout-hero"]).toBe("16 / 10");
    expect(actual.tokens["--layout-nav-height"]).toBe("96px");
    expect(actual.tokens["--layout-hero-media-ratio"]).toBe("3 / 1");
    const preview = designSystemLayoutPreview(actual);
    expect(preview.blocks.find(block => block.role === "navigation")?.height).toBeCloseTo(96 * 544 / 1440);
    const media = preview.blocks.find(block => block.role === "media")!;
    expect(media.width / media.height).toBeCloseTo(3);
    expect(actual.sections.find(section => section.kind === "composition")?.text).toBe("AUTHORED_COMPOSITION");
    expect(actual.sections.filter(section => ["navigation", "hero", "footer"].includes(section.kind))).toEqual([
      { kind: "navigation", text: "NAV_RULE" }, { kind: "hero", text: "AUTHORED_HERO" }, { kind: "footer", text: "FOOTER_RULE" },
    ]);
    expect(actual.supplemented).toBe(true);
    const seven = { ...actual, sections: LAYOUT_SECTION_KINDS.map(kind => ({ kind, text: kind })) };
    expect(parseDesignSystemLayout(seven)).toEqual(seven);
    expect(() => parseDesignSystemLayout({ ...seven, sections: [...seven.sections, seven.sections[0]] })).toThrow();
    expect(() => parseDesignSystemLayout({ ...actual, sections: [{ kind: "navigation", text: "one" }, { kind: "navigation", text: "two" }] })).toThrow();
    expect(() => parseDesignSystemLayout({ ...actual, tokens: { "--layout-nav-pattern": "url(file:///private)" } })).toThrow();
    expect(() => parseDesignSystemLayout({ ...actual, sections: [{ kind: "script", text: "hidden" }] })).toThrow();
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

  test("Given region geometry, then overview and direction diagrams distinguish placement and footer columns inside the canvas", () => {
    const base = { ...sampleLayoutFiles("split-saas").layout, tokens: { "--layout-max": "1280px", "--layout-columns": "12", "--layout-gutter": "24px", "--layout-nav-pattern": "fixture-nav", "--layout-hero-pattern": "fixture-hero", "--layout-footer-pattern": "fixture-footer", "--layout-hero-copy-ratio": "40%", "--layout-footer-columns": "4" } };
    const previews = [];
    for (const nav of ["top", "side", "overlay", "bottom"]) for (const media of ["left", "right", "background", "below"]) {
      const preview = designSystemLayoutPreview({ ...base, tokens: { ...base.tokens, "--layout-nav-position": nav, "--layout-hero-media-position": media, "--layout-nav-width": "240px" } });
      const message = preview.blocks.find(block => block.role === "message")!;
      const image = preview.blocks.find(block => block.role === "media")!;
      const navigation = preview.blocks.find(block => block.role === "navigation")!;
      expect(preview.blocks.filter(block => block.role === "footer")).toHaveLength(4);
      if (media === "left") expect(image.x + image.width).toBeLessThan(message.x);
      if (media === "right") expect(message.x + message.width).toBeLessThan(image.x);
      if (media === "below") expect(message.y + message.height).toBeLessThan(image.y);
      if (media === "background") expect(message.x).toBeGreaterThanOrEqual(image.x);
      if (nav === "side") expect(navigation.x + navigation.width).toBeLessThanOrEqual(image.x);
      if (nav === "bottom") expect(navigation.y).toBeGreaterThan(image.y + image.height);
      previews.push(preview);
    }
    expect(new Set(previews.map(preview => JSON.stringify(preview.blocks))).size).toBe(16);
    previews.push(designSystemLayoutPreview({ ...base, tokens: { ...base.tokens, "--layout-max": "320px", "--layout-gutter": "80px", "--layout-nav-position": "side", "--layout-nav-width": "99999px", "--layout-hero-min-height": "1px", "--layout-footer-height": "99999px", "--layout-footer-columns": "99999" } }));
    for (const preview of previews) for (const block of preview.blocks) {
      expect(block.width).toBeGreaterThan(0);
      expect(block.height).toBeGreaterThan(0);
      expect(block.x).toBeGreaterThanOrEqual(0);
      expect(block.y).toBeGreaterThanOrEqual(0);
      expect(block.x + block.width).toBeLessThanOrEqual(640);
      expect(block.y + block.height).toBeLessThanOrEqual(360);
    }
  });
});
