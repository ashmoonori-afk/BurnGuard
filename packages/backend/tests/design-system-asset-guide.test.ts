import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ASSET_KINDS,
  LAYOUT_SECTION_KINDS,
  extractDesignSystemAssetGuide,
  extractDesignSystemLayout,
  missingDesignSystemLayout,
  parseDesignSystemAssetGuide,
  parseDesignSystemLayout,
} from "@bg/shared";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir } from "../src/lib/paths";
import { persistCanonicalExtraction, readDesignSystemTokens } from "../src/services/design-system-extract";
import { buildAssetGuideReadme } from "../src/services/extraction-assets";
import { measureSourceLayout } from "../src/services/extraction-layout";
import { analyzeLocalTree } from "../src/services/extraction-local-tree";
import type { CssDeclarationEvidence } from "../src/services/extraction-css";

const declaration = (property: string, value: string, context = ""): CssDeclarationEvidence => ({
  property, value, context, sourceLocator: "fixture.css", fileOrder: 0, declarationOrder: 0, parseStatus: "observed",
});

describe("Asset guide contract", () => {
  const readme = [
    "# Brand",
    "## Asset usage",
    "### Logo",
    "LOGO_USAGE_RULE",
    "### Photography",
    "PHOTO_USAGE_RULE",
    "### Private",
    "EXCLUDED_KIND",
    "## Asset generation prompts",
    "### Logo",
    "Prompt: LOGO_PROMPT line one",
    "continues here.",
    "Negative: LOGO_NEGATIVE",
    "### 3D and motion",
    "Prompt: MOTION_PROMPT",
    "## Caveats",
    "Unrelated.",
  ].join("\n");

  test("Given README asset sections, when extracted, then usage, prompt and negative constraints are grouped per known kind in canonical order", () => {
    const guide = extractDesignSystemAssetGuide(readme);
    expect(guide.rules.map(rule => rule.kind)).toEqual(["logo", "photography", "motion"]);
    expect(guide.rules[0]).toEqual({ kind: "logo", usage: "LOGO_USAGE_RULE", prompt: "LOGO_PROMPT line one\ncontinues here.", negative: "LOGO_NEGATIVE" });
    expect(guide.rules[1]).toEqual({ kind: "photography", usage: "PHOTO_USAGE_RULE", prompt: null, negative: null });
    expect(guide.rules[2]).toEqual({ kind: "motion", usage: null, prompt: "MOTION_PROMPT", negative: null });
    expect(JSON.stringify(guide)).not.toContain("EXCLUDED_KIND");
    expect(JSON.stringify(guide)).not.toContain("Unrelated");
    expect(parseDesignSystemAssetGuide(guide)).toEqual(guide);
  });

  test("Given an older README without asset sections, then an empty guide loads", () => {
    const guide = extractDesignSystemAssetGuide("# Old\n## Layout\nGrid.\n## ICONOGRAPHY\n- quiet icons\n");
    expect(guide).toEqual({ schema_version: 1, rules: [] });
    expect(parseDesignSystemAssetGuide(guide)).toEqual(guide);
  });

  test("Given untrusted guide data, then unknown fields, kinds, duplicates and oversized text are rejected", () => {
    const guide = extractDesignSystemAssetGuide(readme);
    expect(() => parseDesignSystemAssetGuide({ ...guide, private_path: "x" })).toThrow();
    expect(() => parseDesignSystemAssetGuide({ ...guide, schema_version: 2 })).toThrow();
    expect(() => parseDesignSystemAssetGuide({ ...guide, rules: [{ kind: "script", usage: "x", prompt: null, negative: null }] })).toThrow();
    expect(() => parseDesignSystemAssetGuide({ ...guide, rules: [guide.rules[0], guide.rules[0]] })).toThrow();
    expect(() => parseDesignSystemAssetGuide({ ...guide, rules: [{ ...guide.rules[0]!, usage: "x".repeat(1201) }] })).toThrow();
    expect(() => parseDesignSystemAssetGuide({ ...guide, rules: [{ kind: "logo", usage: null, prompt: null, negative: null }] })).toThrow();
    expect(extractDesignSystemAssetGuide(`## Asset usage\n### Logo\n${"y".repeat(5000)}\n`).rules[0]!.usage!.length).toBeLessThanOrEqual(1200);
  });
});

describe("Layout section patterns and alignment", () => {
  test("Given README Section patterns and Alignment sections, then they are layout sections and older layouts still parse", () => {
    const layout = extractDesignSystemLayout("", "## Layout\nGrid.\n## Section patterns\nPATTERN_RULE\n## Alignment\nALIGN_RULE\n");
    expect(layout.sections).toEqual([{ kind: "layout", text: "Grid." }, { kind: "patterns", text: "PATTERN_RULE" }, { kind: "alignment", text: "ALIGN_RULE" }]);
    expect(parseDesignSystemLayout(layout)).toEqual(layout);
    expect(LAYOUT_SECTION_KINDS.slice(0, 7)).toEqual(["layout", "composition", "responsive", "family", "navigation", "hero", "footer"]);
    const legacy = extractDesignSystemLayout("", "## Layout\nGrid.\n## Composition\nStory.\n## Responsive\nStack.\n");
    expect(missingDesignSystemLayout({ ...legacy, tokens: {} }).filter(key => !key.startsWith("--"))).toEqual([]);
  });
});

describe("Source layout measurement", () => {
  test("Given source CSS declarations, then container, breakpoints, columns, gutter, rhythm and spacing scale are measured", () => {
    const measured = measureSourceLayout([
      declaration("max-width", "1140px"),
      declaration("max-width", "1140px"),
      declaration("max-width", "40rem"),
      declaration("grid-template-columns", "repeat(12, minmax(0, 1fr))"),
      declaration("grid-template-columns", "repeat(3, 1fr)"),
      declaration("column-gap", "32px"),
      declaration("gap", "32px"),
      declaration("padding", "96px 0"),
      declaration("padding-block", "96px"),
      declaration("padding", "8px"),
      declaration("display", "grid", "@media (min-width: 768px)"),
      declaration("display", "flex", "@media (min-width: 768px)"),
      declaration("display", "flex", "@media screen and (min-width: 1200px)"),
    ], ["8px", "16px 24px", "48px", "96px 0"]);
    expect(measured.tokens).toEqual({
      "--layout-max": "1140px",
      "--layout-columns": "12",
      "--layout-gutter": "32px",
      "--layout-section-y": "clamp(58px, 8vw, 96px)",
      "--layout-bp-md": "768px",
      "--layout-bp-lg": "1200px",
      "--layout-spacing-scale": "8px 16px 24px 48px 96px",
    });
  });

  test("Given a long spacing list, then the scale keeps its smallest and largest steps within ten entries", () => {
    const values = [2, 4, 5, 7, 8, 10, 15, 20, 24, 30, 40, 60, 80, 120].map(value => `${value}px`);
    const scale = measureSourceLayout([], values).tokens["--layout-spacing-scale"]!.split(" ");
    expect(scale).toHaveLength(10);
    expect(scale[0]).toBe("2px");
    expect(scale.at(-1)).toBe("120px");
  });

  test("Given only generic system font stacks before the brand face, then generation prompts name the brand face", () => {
    const readme = buildAssetGuideReadme({ brandName: "Brand", primary: "#112233", action: "#112233", colors: [], fontFamilies: ["-apple-system", "BlinkMacSystemFont", "Brand Sans"], radii: [], shadows: [], logoPaths: [] });
    const logo = extractDesignSystemAssetGuide(readme).rules.find(rule => rule.kind === "logo")!;
    expect(logo.prompt).toContain("Brand Sans");
    expect(logo.prompt).not.toContain("apple-system");
  });

  test("Given no usable declarations, then nothing is claimed as measured", () => {
    expect(measureSourceLayout([declaration("max-width", "100%"), declaration("gap", "0")], []).tokens).toEqual({});
  });
});

describe("Canonical extraction writes layout and asset guidance", () => {
  test("Given a source tree, when persisted, then measured layout, section patterns, asset usage and on-brand prompts reach the tokens API and provenance", async () => {
    const id = `asset-guide-${process.pid}`;
    const source = await mkdtemp(path.join(tmpdir(), "bg-asset-guide-"));
    try {
      await mkdir(path.join(source, "img"), { recursive: true });
      await writeFile(path.join(source, "styles.css"), [
        ":root { --brand-primary: #e4572e; --radius: 12px; }",
        "body { font-family: 'Fixture Sans', sans-serif; color: #1b1b1f; background: #fff8f0; }",
        ".container { max-width: 1140px; margin: 0 auto; padding: 0 24px; }",
        ".grid { display: grid; grid-template-columns: repeat(12, 1fr); column-gap: 32px; }",
        ".section { padding: 96px 0; }",
        ".card { border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,.08); padding: 24px; }",
        "@media (min-width: 768px) { .grid { gap: 32px; } }",
        "@media (min-width: 1200px) { .container { padding: 0 48px; } }",
      ].join("\n"));
      await writeFile(path.join(source, "img", "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
      const signal = new AbortController().signal;
      const analysis = await analyzeLocalTree(source, "Fixture", signal);
      const result = await persistCanonicalExtraction({ requestedId: id, brandName: "Fixture", sourceType: "github", sourceReference: "https://github.com/fixture/brand.git", lineage: null, analysis, signal });
      const root = path.join(systemsDir, result.system.id);
      const readme = await readFile(path.join(root, "README.md"), "utf8");
      for (const heading of ["## Section patterns", "## Alignment", "## Asset usage", "## Asset generation prompts"]) expect(readme).toContain(heading);
      expect(await readFile(path.join(root, "SKILL.md"), "utf8")).toContain("Asset generation prompts");

      const tokens = await readDesignSystemTokens(result.system.id);
      expect(tokens.layout.tokens["--layout-max"]).toBe("1140px");
      expect(tokens.layout.tokens["--layout-gutter"]).toBe("32px");
      expect(tokens.layout.tokens["--layout-bp-md"]).toBe("768px");
      expect(tokens.layout.tokens["--layout-bp-lg"]).toBe("1200px");
      expect(missingDesignSystemLayout(tokens.layout)).toEqual([]);
      expect(tokens.layout.sections.map(section => section.kind)).toEqual(expect.arrayContaining(["patterns", "alignment"]));
      expect(tokens.layout.sections.find(section => section.kind === "layout")?.text).toContain("1140px");

      const guide = parseDesignSystemAssetGuide(tokens.assets);
      expect(guide.rules.map(rule => rule.kind)).toEqual([...ASSET_KINDS]);
      for (const rule of guide.rules) {
        expect(rule.usage).toBeTruthy();
        expect(rule.prompt).toBeTruthy();
        expect(rule.negative).toBeTruthy();
        expect(rule.prompt!.toLowerCase()).toContain("#e4572e");
      }
      expect(guide.rules.find(rule => rule.kind === "logo")?.usage).toContain("assets/logos/logo.svg");

      const provenance = JSON.parse(await readFile(path.join(root, "extraction-provenance.json"), "utf8"));
      const layoutKeys = provenance.content.entries.filter((entry: { domain: string }) => entry.domain === "layout" || entry.domain === "breakpoint").map((entry: { key: string }) => entry.key);
      expect(layoutKeys).toEqual(expect.arrayContaining(["layout-max", "layout-bp-md"]));
    } finally {
      getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(id);
      await rm(path.join(systemsDir, id), { recursive: true, force: true });
      await rm(source, { recursive: true, force: true });
    }
  });
});
