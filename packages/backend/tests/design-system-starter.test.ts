import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MEASURED_VIEWPORTS, parseDesignSystemMeasuredLayout, type MeasuredViewportLayout } from "@bg/shared";
import { appendDesignSystemContext, appendDesignSystemStarter } from "../src/harness/prompt-design-system";
import { literalValueFindings, reviewDesignSystemConformance } from "../src/services/design-system-conformance";
import { buildStarterCss, heroArrangement, provisionDesignSystemStarter, STARTER_CSS_PATH, STARTER_MARKER, starterPlan } from "../src/services/design-system-starter";

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

async function pinnedContext(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-starter-system-"));
  try {
    await writeFile(path.join(dir, "layout-measured.json"), JSON.stringify(layout));
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
});
