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
import { extractDesignSystemFromSource } from "../src/services/design-system-extract";
import { systemsDir } from "../src/lib/paths";
import { persistCanonicalExtraction, readDesignSystemTokens } from "../src/services/design-system-extract";
import { buildAssetGuideReadme, paletteTone, toHexColor } from "../src/services/extraction-assets";
import { parseCssSource } from "../src/services/extraction-css";
import { collectSourceEvidence, gridTrackCount, type SourceEvidence } from "../src/services/extraction-evidence";
import { buildSectionPatternReadme, measureSourceLayout } from "../src/services/extraction-layout";
import { analyzeLocalTree } from "../src/services/extraction-local-tree";
import type { CssDeclarationEvidence } from "../src/services/extraction-css";

const NO_EVIDENCE: SourceEvidence = collectSourceEvidence([], []);
const guideFor = (overrides: Partial<Parameters<typeof buildAssetGuideReadme>[0]> = {}) => extractDesignSystemAssetGuide(buildAssetGuideReadme({ brandName: "Brand", primary: "#112233", action: "#112233", colors: [], fontFamilies: [], radii: [], logoPaths: [], evidence: NO_EVIDENCE, ...overrides }));

const defaultUsage = (kind: string) => guideFor().rules.find(rule => rule.kind === kind)!.usage;
const usageOf = (guide: ReturnType<typeof guideFor>, kind: string) => guide.rules.find(rule => rule.kind === kind)!.usage;

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
      "--layout-section-y": "96px",
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
    const logo = guideFor({ fontFamilies: ["-apple-system", "BlinkMacSystemFont", "Brand Sans"] }).rules.find(rule => rule.kind === "logo")!;
    expect(logo.prompt).toContain("Brand Sans");
    expect(logo.prompt).not.toContain("apple-system");
  });

  test("Given repeat() track lists through the real CSS parser, then page and feature columns count every repeated track", async () => {
    const parsed = await parseCssSource({ content: ".page { grid-template-columns: repeat(8, 1fr 2fr); } .cards { grid-template-columns: repeat(2, 1fr 2fr); }", sourceId: "fixture.css", fileOrder: 0, signal: new AbortController().signal });
    expect(measureSourceLayout(parsed.declarations, []).tokens["--layout-columns"]).toBe("16");
    expect(collectSourceEvidence([], parsed.declarations).featureColumns).toBe(4);
    const six = await parseCssSource({ content: ".cards { grid-template-columns: repeat(3, 1fr 2fr); }", sourceId: "six.css", fileOrder: 0, signal: new AbortController().signal });
    expect(collectSourceEvidence([], six.declarations).featureColumns).toBeNull();
  });

  test("Given rem and em declaration lengths, then they are not measured, while media-query em widths still are", () => {
    expect(measureSourceLayout([declaration("max-width", "80rem"), declaration("gap", "2rem"), declaration("padding", "6em 0"), declaration("display", "grid", "@media (min-width: 48em)")], ["1rem", "2em"]).tokens).toEqual({ "--layout-bp-md": "768px" });
  });

  test("Given alignment, timing, breakpoint and footer edge cases, then only unambiguous values are observed", async () => {
    const align = (...keywords: string[]) => collectSourceEvidence([], keywords.map(value => declaration("text-align", value))).alignment;
    expect(align("right", "right", "right", "right", "left", "left", "left")).toBe("right");
    expect(align("start", "start", "start")).toBeNull();
    expect(align("left", "center", "right")).toBeNull();
    const parsed = await parseCssSource({ content: ":root { --duration: 1s } .a { transition: opacity var(--duration, 200ms) } .c { transition-duration: var(--d, calc(1s + 5ms)) } .b { animation: spin-2s 3s linear }", sourceId: "t.css", fileOrder: 0, signal: new AbortController().signal });
    expect(collectSourceEvidence([], parsed.declarations).motionMs).toEqual([3000, 3000]);
    const math = await parseCssSource({ content: ":root { --duration: 1s } .a { animation-duration: calc(1s / 2) } .b { transition-duration: calc(var(--duration) + 200ms) }", sourceId: "m.css", fileOrder: 0, signal: new AbortController().signal });
    const mathEvidence = collectSourceEvidence([], math.declarations);
    expect(mathEvidence.motionMs).toBeNull();
    expect(usageOf(guideFor({ evidence: mathEvidence }), "motion")).toBe(defaultUsage("motion"));
    const fallbacks = await parseCssSource({ content: ":root { --bg: #fff; --pattern: none } .a { background: var(--bg, linear-gradient(#111, #222)) } .b { background-image: var(--pattern, repeating-linear-gradient(45deg, #000 0 2px, transparent 2px 8px)) } .c { background-image: linear-gradient(#333, #444) }", sourceId: "g.css", fileOrder: 0, signal: new AbortController().signal });
    const fallbackEvidence = collectSourceEvidence([], fallbacks.declarations);
    expect({ gradients: fallbackEvidence.gradients, patterns: fallbackEvidence.patterns }).toEqual({ gradients: 1, patterns: 0 });
    const contexts = await parseCssSource({ content: "@supports (max-width: 1200px) { .a { display: block } } @container (min-width: 900px) { .b { display: block } }", sourceId: "c.css", fileOrder: 0, signal: new AbortController().signal });
    expect(measureSourceLayout(contexts.declarations, []).tokens).toEqual({});
    expect(collectSourceEvidence([`<footer>${"<ul><li>a</li></ul>".repeat(8)}</footer>`], []).footerColumns).toBe(8);
  });

  test("Given only a large breakpoint, then it is measured without a medium one", () => {
    expect(measureSourceLayout([declaration("display", "grid", "@media (min-width: 1280px)")], []).tokens).toEqual({ "--layout-bp-lg": "1280px" });
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
      const rhythm = provenance.content.entries.find((entry: { key: string }) => entry.key === "layout-section-y");
      expect({ state: rhythm.state, value: rhythm.candidates[0].value }).toEqual({ state: "observed", value: "96px" });
    } finally {
      getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(id);
      await rm(path.join(systemsDir, id), { recursive: true, force: true });
      await rm(source, { recursive: true, force: true });
    }
  });
});

describe("Source evidence drives section patterns and asset style", () => {
  const html = [
    '<header><nav class="nav"><a href="/">Home</a></nav></header>',
    '<section class="hero"><h1>Title</h1><p>Lead</p><img src="img/team.jpg" alt=""></section>',
    '<section class="features"><svg fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 0"/></svg><svg fill="none"><path stroke="currentColor" stroke-width="1.5" d="M0 0"/></svg><svg class="brand-logo"><path d="M0 0"/></svg><img src="img/art.svg" alt=""></section>',
    '<section class="pricing-plans"><h2>Plans</h2></section><section><blockquote>Great</blockquote></section>',
    '<footer><ul><li>a</li></ul><ul><li>b</li></ul><ul><li>c</li></ul></footer>',
  ].join("");
  const css = [
    declaration("grid-template-columns", "repeat(3, 1fr)"), declaration("grid-template-columns", "repeat(3, 1fr)"),
    declaration("text-align", "left"), declaration("text-align", "left"), declaration("text-align", "center"),
    declaration("background-image", "linear-gradient(90deg, #111, #222)"), declaration("transition", "color 150ms ease, transform .3s"),
  ];

  test("Given source HTML and CSS, then hero, feature columns, proof, pricing, testimonials, footer, alignment, icons, images, backgrounds and motion are observed", () => {
    expect(collectSourceEvidence([html], css)).toEqual({
      hero: { media: true }, featureColumns: 3, proofStrip: false, pricing: true, testimonials: true, footerColumns: 3, alignment: "left",
      iconCount: 2, photos: 1, illustrations: 1, gradients: 1, patterns: 0,
      motionMs: [150, 300], animations: 0,
    });
    const patterns = extractDesignSystemLayout("", buildSectionPatternReadme(collectSourceEvidence([html], css))).sections.find(section => section.kind === "patterns")!.text;
    expect(patterns.split("\n").map(line => /^- ([^(]+) \((observed|default)\)/.exec(line)?.slice(1, 3).join(":"))).toEqual([
      "Navigation:default", "Hero:observed", "Feature grid:observed", "Logo or proof strip:default", "Pricing:observed", "Testimonials:observed", "Call to action:default", "Footer:observed",
    ]);
  });

  test("Given hero markup, then only headline and media presence are observed and arrangement is never claimed", () => {
    const hero = (markup: string) => collectSourceEvidence([markup], []).hero;
    expect(hero('<section class="hero"><div style="display:flex;flex-flow:column nowrap"><div><h1>T</h1></div><div><img src="a.jpg"></div></div></section>')).toEqual({ media: true });
    expect(hero('<section class="hero"><h1>T</h1><p>L</p></section>')).toEqual({ media: null });
    expect(hero('<section class="hero"><header><h1>Brand</h1></header><img src="team.jpg"></section>')).toEqual({ media: true });
    expect(hero('<section class="hero"><header><h1>Brand</h1></header><svg viewBox="0 0 10 10"><path d="M0 0"/></svg></section>')).toEqual({ media: null });
    expect(hero('<main><p>No headline</p></main>')).toBeNull();
    for (const wrapper of ["hero-content", "hero__copy"]) expect(hero(`<section class="hero"><div class="${wrapper}"><h1>Brand</h1></div><img src="team.jpg"></section>`)).toEqual({ media: true });
    expect(hero('<body><div><h1>Loose</h1></div><img src="x.jpg"></body>')).toBeNull();
    const wrapped = extractDesignSystemLayout("", buildSectionPatternReadme(collectSourceEvidence(['<section class="hero"><div class="hero-content"><h1>Brand</h1></div><img src="team.jpg"></section>'], []))).sections.find(section => section.kind === "patterns")!.text;
    expect(wrapped).toBe(extractDesignSystemLayout("", buildSectionPatternReadme(collectSourceEvidence(['<section><h1>Brand</h1><img src="a.jpg"></section>'], []))).sections.find(section => section.kind === "patterns")!.text);
    expect(["minmax(0, 1fr)", "repeat(1, 1fr)", "repeat(3, minmax(0, 1fr))", "[full] 1fr [mid] 2fr", "[content-start main-start] minmax(0, 1fr) [content-end main-end]", "repeat(auto-fit, 200px)", "fit-content(10px", "1fr !important", "repeat(3, 1fr 2fr)", "repeat(2, [a] 1fr [b] repeat(2, 10px))", "subgrid", "repeat(8, var(--tracks))", "var(--cols)", "repeat(8,[a]1fr[b] 2fr)", "[a]1fr[b]"].map(gridTrackCount)).toEqual([1, 1, 3, 2, 1, null, null, 1, 6, 6, null, null, null, 16, 1]);
  });

  test("Given no evidence, then every section pattern and asset kind is labelled as a default", () => {
    const patterns = extractDesignSystemLayout("", buildSectionPatternReadme(NO_EVIDENCE)).sections.find(section => section.kind === "patterns")!.text;
    expect(patterns).not.toContain("(observed)");
    const guide = guideFor();
    expect(guide.rules.map(rule => rule.kind)).toEqual([...ASSET_KINDS]);
    const observed = guideFor({ evidence: collectSourceEvidence([html], css) });
    for (const kind of ["icons", "illustrations", "photography", "backgrounds", "motion"]) expect(usageOf(observed, kind)).not.toBe(defaultUsage(kind));
    for (const kind of ["patterns"]) expect(usageOf(observed, kind)).toBe(defaultUsage(kind));
  });

  test("Given the generated guide, then it carries no website region placement so fixed surfaces can receive it", () => {
    const guide = guideFor({ evidence: collectSourceEvidence([html], css), logoPaths: ["assets/logos/logo.svg"] });
    expect(JSON.stringify(guide)).not.toMatch(/navigation|footer|hero|\bsection\b|grid column/i);
  });

  test("Given an rgb-only dark source, then colours are normalised to hex and the ground is dark", () => {
    expect(["rgb(10, 20, 30)", "rgba(10 20 30 / 50%)", "hsl(0, 100%, 50%)", "#ABC", "#11223344", "var(--x)"].map(toHexColor)).toEqual(["#0a141e", "#0a141e", "#ff0000", "#aabbcc", "#112233", null]);
    expect(["hsl(180 100% 50%)", "hsl(180deg 100% 50%)", "hsl(0.5turn 100% 50%)", "hsl(200grad 100% 50%)", "hsl(1foo 100% 50%)"].map(toHexColor)).toEqual(["#00ffff", "#00ffff", "#00ffff", "#00ffff", null]);
    expect(paletteTone(["rgb(10, 20, 30)", "rgb(20, 20, 40)"].map(color => toHexColor(color)!))).toBe("dark");
    expect(paletteTone(["#ffffff", "#f0f0f0"])).toBe("light");
    expect(paletteTone([])).toBeNull();
    expect(guideFor({ colors: ["rgb(10, 20, 30)", "rgb(20, 20, 40)"] }).rules.find(rule => rule.kind === "illustrations")!.prompt).toContain("#0a141e");
  });

  test("Given animation names without timing and gradients through the real CSS parser, then only their presence is observed and fallback timing stays a default", async () => {
    const parsed = await parseCssSource({ content: ".a { animation-name: fade; } .b { background-image: linear-gradient(90deg, #111, #222); } .c { background-image: url('/photos/team.jpg'); }", sourceId: "fixture.css", fileOrder: 0, signal: new AbortController().signal });
    const evidence = collectSourceEvidence([], parsed.declarations);
    expect({ motionMs: evidence.motionMs, animations: evidence.animations, gradients: evidence.gradients }).toEqual({ motionMs: null, animations: 1, gradients: 1 });
    expect(usageOf(guideFor({ evidence }), "motion")).not.toBe(defaultUsage("motion"));
  });

  test("Given icons whose paint any stylesheet could change, then only their count is observed", () => {
    const svg = '<svg fill="none" stroke="currentColor" stroke-width="2"><path d="M0 0"/></svg><svg class="brand-logo"><path d="M0 0"/></svg>';
    const evidence = collectSourceEvidence([`<style>svg { fill: currentColor; stroke: none }</style>${svg}${svg}`], []);
    expect(evidence.iconCount).toBe(2);
    const icons = guideFor({ evidence }).rules.find(rule => rule.kind === "icons")!;
    expect(icons.usage).not.toBe(defaultUsage("icons"));
    expect(icons.prompt).toBe(guideFor().rules.find(rule => rule.kind === "icons")!.prompt);
  });

  test("Given nested footer navigation, then each link list counts once", () => {
    const footer = (markup: string) => collectSourceEvidence([markup], []).footerColumns;
    expect(footer('<footer><nav><ul><li>a</li></ul></nav><nav><ul><li>b</li></ul></nav></footer>')).toBe(2);
    expect(footer('<footer><nav><a href="/a">a</a></nav><nav><a href="/b">b</a></nav></footer>')).toBe(2);
    expect(footer('<footer><ul><li>a</li></ul></footer>')).toBeNull();
  });
});

describe("Evidence comes from the original source, not sanitized or generated HTML", () => {
  test("Given a website with photos and SVG art, when acquired through the real fetch and sanitizer, then the published guide still observes them", async () => {
    const page = '<!doctype html><html><head><meta charset="utf-8"></head><body><section class="hero"><div class="row"><div><h1>Brand</h1></div><div><img src="/img/team.jpg" alt="Team"></div></div></section><section><img src="/img/art.svg" alt="Art"></section></body></html>';
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(page, { headers: { "content-type": "text/html" } }) });
    const origin = `http://127.0.0.1:${server.port}`;
    const settings = {
      BG_EXTRACTION_QA_ADAPTER_SOURCE_URL: `${origin}/source`,
      BG_EXTRACTION_QA_ADAPTER_STALL_URL: `${origin}/stall`,
      BG_EXTRACTION_QA_ADAPTER_RESOURCE_URLS: `${origin}/source,${origin}/stall`,
      BG_EXTRACTION_QA_ADAPTER_SECRET: "asset-guide-fixture-secret-000000001",
    };
    const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
    Object.assign(process.env, settings);
    const id = `asset-website-${process.pid}`;
    try {
      await extractDesignSystemFromSource({ system_id: id, name: "Brand", source_type: "website", source_url: `${origin}/source` });
      const stored = await readFile(path.join(systemsDir, id, "uploads", "source.html"), "utf8");
      expect(stored).not.toContain("team.jpg");
      const guide = parseDesignSystemAssetGuide((await readDesignSystemTokens(id)).assets);
      for (const kind of ["photography", "illustrations"]) expect(guide.rules.find(rule => rule.kind === kind)!.usage).not.toBe(defaultUsage(kind));
      const layout = (await readDesignSystemTokens(id)).layout.sections.find(section => section.kind === "patterns")!.text;
      expect(layout).toMatch(/^- Hero \(observed\)/m);
    } finally {
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await server.stop(true);
      getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(id);
      await rm(path.join(systemsDir, id), { recursive: true, force: true });
    }
  });

  test("Given an upload-style analysis whose UI kit holds generated preview HTML, when persisted, then nothing from the preview is observed", async () => {
    const id = `asset-upload-${process.pid}`;
    const source = await mkdtemp(path.join(tmpdir(), "bg-asset-upload-"));
    try {
      const preview = path.join(source, "page-1.html");
      await writeFile(preview, '<html><body><section class="hero"><h1>Generated preview</h1><img alt="preview"></section><blockquote>q</blockquote></body></html>');
      const signal = new AbortController().signal;
      const empty = path.join(source, "empty");
      await mkdir(empty);
      const base = await analyzeLocalTree(empty, "Upload", signal);
      const analysis = { ...base, sourceEvidence: undefined, uiKitFiles: [{ absolutePath: preview, fileName: "page-1.html" }] };
      await persistCanonicalExtraction({ requestedId: id, brandName: "Upload", sourceType: "upload", sourceReference: "upload://fixture", lineage: null, analysis, signal });
      const tokens = await readDesignSystemTokens(id);
      expect(tokens.layout.sections.find(section => section.kind === "patterns")!.text).not.toContain("(observed)");
      expect(parseDesignSystemAssetGuide(tokens.assets)).toEqual(guideFor({ brandName: "Upload", primary: "#0057B8", action: "#0057B8" }));
    } finally {
      getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(id);
      await rm(path.join(systemsDir, id), { recursive: true, force: true });
      await rm(source, { recursive: true, force: true });
    }
  });
});
