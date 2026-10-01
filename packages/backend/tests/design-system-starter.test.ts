import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MEASURED_VIEWPORTS, parseDesignSystemMeasuredLayout, type MeasuredViewportLayout } from "@bg/shared";
import { appendDesignSystemContext, appendDesignSystemStarter } from "../src/harness/prompt-design-system";
import { literalValueFindings, declaredMeasuredPage, reviewDesignSystemConformance } from "../src/services/design-system-conformance";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { buildStarterCss, entrypointBuiltAgainstSystem, heroArrangement, provisionDesignSystemStarter, seedStarterEntrypoint, STARTER_CSS_PATH, STARTER_MARKER, starterPlan } from "../src/services/design-system-starter";
import { resolveStaticClosure } from "../src/services/export-closure";
import { prepareBundledFontExport } from "../src/services/export-stage";
import { ensureTokensCssImportsFonts } from "../src/services/extraction-css";

const viewport = (name: "desktop" | "mobile", hero: number, align: "center" | "left"): MeasuredViewportLayout => ({
  viewport: { ...MEASURED_VIEWPORTS[name] }, page_height: 2000, container: { left: name === "desktop" ? 120 : 20, width: name === "desktop" ? 1200 : 350 }, gutter: 24, section_gap: 96,
  type_scale: { hero, subheading: 24, cta: 17, h2: 40, h3: 24, body: 17, nav: 16 },
  blocks: { hero_heading: { x: name === "desktop" ? 346 : 43, y: 120, width: name === "desktop" ? 749 : 304, height: 80, align } },
  sections: [{ heading: "Hero", top: 120, height: 600, columns: 1, align }, { heading: "Features", top: 720, height: 600, columns: 3, align: "left" }],
});
const layout = { schema_version: 1, method: "rendered-offline", pages: [
  { path: "/", page_type: "home", viewports: { desktop: viewport("desktop", 64, "center"), mobile: viewport("mobile", 40, "center") } },
  { path: "/about", page_type: "about", viewports: { desktop: viewport("desktop", 48, "left"), mobile: viewport("mobile", 32, "left") } },
  { path: "/a\"}b", page_type: "other", viewports: { desktop: viewport("desktop", 30, "left"), mobile: viewport("mobile", 30, "left") } },
] };
const tokens = ":root {\n  --bg: #0f0a1c;\n  --fg-1: #d6d6d6;\n  --primary-blue: #b77dea;\n  --layout-bp-md: 900px;\n}";

async function pinnedContext(measured: { readonly pages: readonly unknown[] } = layout): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-starter-system-"));
  try {
    await writeFile(path.join(dir, "layout-measured.json"), JSON.stringify(measured));
    const system = { id: "starter", name: "Starter", status: "draft", source_type: "website", is_template: false, dir_path: dir, skill_md_path: null, tokens_css_path: null, readme_md_path: null, thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null } as const;
    const lines: string[] = [];
    await appendDesignSystemContext(lines, system, "full", "website", true);
    return lines.join("\n");
  } finally { await rm(dir, { recursive: true, force: true }); }
}

describe("Design-system starter", () => {
  test("Given measured pages, then the stylesheet is deterministic, carries tokens and home values at :root, other safe pages behind their meta, mobile values below the token breakpoint, and no literal values outside definitions", () => {
    const pages = parseDesignSystemMeasuredLayout(layout).pages;
    const css = buildStarterCss(tokens, pages);
    expect(buildStarterCss(tokens, pages)).toBe(css);
    expect(css.startsWith(STARTER_MARKER)).toBe(true);
    expect(css).toContain("--primary-blue: #b77dea;");
    // A stored system keeps its colour-named token; the starter reads the neutral name first and falls back to it.
    expect(css).toContain("var(--brand-primary, var(--primary-blue))");
    expect(/:root \{\n  [^}]*--m-type-hero: 64px;/u.test(css)).toBe(true);
    expect(css).toContain(':root:has(meta[name="bg-measured-page"][content="/about"]) {\n  --m-container: 1200px;');
    expect(css).not.toContain('content="/a"}b"');
    expect(css).toContain("@media (max-width: 899.98px)");
    expect(literalValueFindings([css])).toEqual([]);
  });

  test("Given measured hero blocks, then the arrangement follows alignment and media overlap", () => {
    const base = viewport("desktop", 64, "center");
    expect(heroArrangement(base)).toBe("centered");
    expect(heroArrangement({ ...base, blocks: { ...base.blocks, media: { x: 120, y: 70, width: 1200, height: 900, align: "center" } } })).toBe("media-behind");
    expect(heroArrangement({ ...base, blocks: { hero_heading: { ...base.blocks.hero_heading!, x: 120, align: "left", width: 500 }, media: { x: 760, y: 100, width: 500, height: 400, align: "right" } } })).toBe("split");
    expect(heroArrangement({ ...base, blocks: {} })).toBe("text-only");
  });

  test("Given a pinned context, then the plan and prompt block list the safe pages with hero and skeleton; a slide surface and a pin without measurements get none", async () => {
    const context = await pinnedContext();
    const plan = starterPlan(context);
    expect(plan?.stylesheet).toBe(STARTER_CSS_PATH);
    expect(plan?.pages.map(page => [page.path, page.hero, page.skeleton])).toEqual([
      ["/", "centered", ".burnguard-inputs/design-system-starter/home.html"],
      ["/about", "text-only", ".burnguard-inputs/design-system-starter/about.html"],
    ]);
    const lines: string[] = [];
    appendDesignSystemStarter(lines, context, "website");
    expect(lines[0]).toBe("<design_system_starter>");
    expect(JSON.parse(lines[1]!)).toEqual(plan);
    const slides: string[] = [];
    appendDesignSystemStarter(slides, context, "slides");
    appendDesignSystemStarter(slides, "no measured block", "website");
    expect(slides).toEqual([]);
  });

  test("Given a stage, then the starter writes the stylesheet and skeletons, rewrites its own file, and leaves a stylesheet it did not write untouched", async () => {
    const stage = await mkdtemp(path.join(tmpdir(), "bg-starter-stage-"));
    try {
      const pin = { context: await pinnedContext(), tokens };
      expect(await provisionDesignSystemStarter(stage, { context: "none", tokens })).toBeNull();
      await provisionDesignSystemStarter(stage, pin);
      const written = await readFile(path.join(stage, STARTER_CSS_PATH), "utf8");
      expect(written.startsWith(STARTER_MARKER)).toBe(true);
      expect(await readFile(path.join(stage, ".burnguard-inputs/design-system-starter/about.html"), "utf8")).toContain('content="/about"');
      await provisionDesignSystemStarter(stage, pin);
      expect(await readFile(path.join(stage, STARTER_CSS_PATH), "utf8")).toBe(written);
      await writeFile(path.join(stage, STARTER_CSS_PATH), "body{}");
      await provisionDesignSystemStarter(stage, pin);
      expect(await readFile(path.join(stage, STARTER_CSS_PATH), "utf8")).toBe("body{}");
    } finally { await rm(stage, { recursive: true, force: true }); }
  });

  test.skipIf(process.env.BG_BROWSER_SMOKE !== "1")("Given a real Chromium, when the home skeleton is rendered with the starter stylesheet, then the hero is centred and its type matches the measured page", async () => {
    const stage = await mkdtemp(path.join(tmpdir(), "bg-starter-render-"));
    try {
      const context = await pinnedContext();
      await provisionDesignSystemStarter(stage, { context, tokens });
      await mkdir(path.join(stage, "design-system"), { recursive: true });
      await writeFile(path.join(stage, "index.html"), await readFile(path.join(stage, ".burnguard-inputs/design-system-starter/home.html"), "utf8"));
      const result = await reviewDesignSystemConformance({ projectDir: stage, entrypoint: "index.html", pinnedContext: context, changedPaths: ["index.html"], signal: AbortSignal.timeout(60_000) });
      const targets = new Set(result!.findings.map(finding => `${finding.viewport}:${finding.code}:${finding.target}`));
      for (const name of ["desktop", "mobile"]) {
        expect(targets.has(`${name}:block_alignment:hero_heading`)).toBe(false);
        expect(targets.has(`${name}:type_size:hero`)).toBe(false);
        expect(targets.has(`${name}:container:container`)).toBe(false);
      }
      expect(result!.findings.filter(finding => finding.code === "literal_value")).toEqual([]);
    } finally { await rm(stage, { recursive: true, force: true }); }
  }, 90_000);

  test("Given an extracted system whose token CSS imports ./fonts/fonts.css, When the starter seeds a fresh website and the export closure is resolved, Then every stylesheet the page loads exists in the project", async () => {
    const stage = await mkdtemp(path.join(tmpdir(), "bg-starter-closure-"));
    try {
      const context = await pinnedContext();
      // The extraction writes its token file through this helper, so the pinned tokens start with the relative font import.
      const extracted = ensureTokensCssImportsFonts(`${tokens}\n`);
      expect(extracted).toContain("./fonts/fonts.css");
      await mkdir(path.join(stage, "fonts"), { recursive: true });
      await writeFile(path.join(stage, "fonts", "fonts.css"), "/* project font store */\n");
      await provisionDesignSystemStarter(stage, { context, tokens: extracted });
      expect(await seedStarterEntrypoint(stage, context, "index.html")).toBe(true);

      // The same font preparation and strict closure runExport performs before rendering.
      await prepareBundledFontExport(stage);
      const closure = await resolveStaticClosure(stage, "index.html", await inspectCanonicalTree(stage)).then(
        resolved => resolved.referenced_paths,
        (error: unknown) => error instanceof Error ? error.message : String(error),
      );
      expect(closure).toEqual(expect.arrayContaining([STARTER_CSS_PATH, "fonts/fonts.css"]));
    } finally { await rm(stage, { recursive: true, force: true }); }
  });

  test("Given token CSS with relative, root-relative, remote and data references, When the starter stylesheet is built, Then only the relative ones are rebased to the stylesheet's directory", () => {
    const pages = parseDesignSystemMeasuredLayout(layout).pages;
    const css = buildStarterCss(`@import "fonts/extra.css";\n@import url("./fonts/fonts.css");\n:root { --a: url(assets/a.png); --b: url('/b.png'); --c: url(https://example.com/c.png); --d: url(data:image/png;base64,AAAA); --e: url(#e); }`, pages);
    expect(css).toContain('@import "../fonts/extra.css";');
    expect(css).toContain('@import url("../fonts/fonts.css");');
    expect(css).toContain("--a: url(../assets/a.png);");
    expect(css).toContain("--b: url('/b.png'); --c: url(https://example.com/c.png); --d: url(data:image/png;base64,AAAA); --e: url(#e);");
  });

  test("Given measured pages at / and /home, When the starter plan is built and provisioned, Then each measured page gets its own skeleton file", async () => {
    const stage = await mkdtemp(path.join(tmpdir(), "bg-starter-skeletons-"));
    try {
      const page = (pagePath: string, pageType: string, hero: number) => ({ path: pagePath, page_type: pageType, viewports: { desktop: viewport("desktop", hero, "center"), mobile: viewport("mobile", hero - 16, "center") } });
      // /home and /Home collide with the home page's name and, on case-insensitive filesystems, with each other.
      const context = await pinnedContext({ ...layout, pages: [page("/", "home", 64), page("/home", "other", 48), page("/Home", "other", 40)] });
      const plan = starterPlan(context);
      const skeletons = plan?.pages.map(entry => entry.skeleton) ?? [];
      expect(skeletons.length).toBe(3);
      expect(new Set(skeletons.map(name => name.toLowerCase())).size).toBe(3);

      await provisionDesignSystemStarter(stage, { context, tokens });
      for (const entry of plan!.pages) {
        expect(await readFile(path.join(stage, ...entry.skeleton.split("/")), "utf8")).toContain(`<meta name="bg-measured-page" content="${entry.path}">`);
      }
    } finally { await rm(stage, { recursive: true, force: true }); }
  });
});

const measuredPageHtml = (meta: string): string => `<!doctype html><html><head>${meta}<link rel="stylesheet" href="design-system/system.css"></head><body class="bg-page"><h1>Built</h1></body></html>`;

describe("Measured page declaration", () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ["name before content", '<meta name="bg-measured-page" content="/about">', "/about"],
    ["content before name", '<meta content="/about" name="bg-measured-page">', "/about"],
    ["an attribute between name and content", '<meta name="bg-measured-page" data-bg-node-id="n1" content="/pricing">', "/pricing"],
    ["an attribute before both and single quotes", "<meta data-x='1' content='/pricing' name='bg-measured-page' />", "/pricing"],
  ];
  for (const [label, meta, expected] of cases) {
    test(`Given a bg-measured-page meta with ${label}, When the declaration is read, Then it yields the declared path and the page counts as built against the system`, () => {
      const html = measuredPageHtml(meta);
      expect(declaredMeasuredPage(html)).toBe(expected);
      expect(entrypointBuiltAgainstSystem(html, false)).toBe(true);
    });
  }

  test("Given a meta with another name or no content, When the declaration is read, Then nothing is declared", () => {
    for (const meta of ['<meta content="/about" name="viewport">', '<meta name="bg-measured-page">', "<meta name=\"bg-measured-page\" content=\"\">"]) {
      const html = measuredPageHtml(meta);
      expect(declaredMeasuredPage(html)).toBeNull();
      expect(entrypointBuiltAgainstSystem(html, false)).toBe(false);
    }
  });
});
