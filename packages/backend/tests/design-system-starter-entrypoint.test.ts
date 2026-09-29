import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MEASURED_VIEWPORTS, type MeasuredViewportLayout } from "@bg/shared";
import { appendDesignSystemContext } from "../src/harness/prompt-design-system";
import { generationOutputComplete } from "../src/services/generation-output";
import { renderInitialArtifact } from "../src/db/templates";
import { entrypointBuiltAgainstSystem, seedStarterEntrypoint } from "../src/services/design-system-starter";

const viewport = (name: "desktop" | "mobile"): MeasuredViewportLayout => ({
  viewport: { ...MEASURED_VIEWPORTS[name] }, page_height: 2400, container: { left: 120, width: 1200 }, gutter: 24, section_gap: 96, type_scale: { hero: 64, subheading: 24 },
  blocks: { hero_heading: { x: 346, y: 300, width: 749, height: 128, align: "center" } },
  sections: [{ heading: "Hero", top: 200, height: 700, columns: 1, align: "center" }, { heading: "Features", top: 900, height: 700, columns: 3, align: "center" }],
});
const measured = { schema_version: 1, method: "rendered-offline", pages: [{ path: "/", page_type: "home", viewports: { desktop: viewport("desktop"), mobile: viewport("mobile") } }] };

async function pinnedContext(withMeasured: boolean): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-seed-system-"));
  try {
    if (withMeasured) await writeFile(path.join(dir, "layout-measured.json"), JSON.stringify(measured));
    const system = { id: "seed", name: "Seed", status: "draft", source_type: "website", is_template: false, dir_path: dir, skill_md_path: null, tokens_css_path: null, readme_md_path: null, thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null } as const;
    const lines: string[] = [];
    await appendDesignSystemContext(lines, system, "full", "website", true);
    return lines.join("\n");
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function withStage(run: (stage: string) => Promise<void>): Promise<void> {
  const stage = await mkdtemp(path.join(tmpdir(), "bg-seed-stage-"));
  try { await run(stage); } finally { await rm(stage, { recursive: true, force: true }); }
}

describe("Design-system starter entrypoint", () => {
  test("Given a fresh stage and a measured home, then the class-based skeleton becomes the entrypoint and an untouched skeleton is never complete", async () => {
    const context = await pinnedContext(true);
    await withStage(async (stage) => {
      expect(await seedStarterEntrypoint(stage, context, "index.html")).toBe(true);
      const html = await readFile(path.join(stage, "index.html"), "utf8");
      expect(html).toContain('<meta name="bg-measured-page" content="/">');
      expect(html).toContain('href="design-system/system.css"');
      expect(html).toContain('class="bg-page"');
      expect(html).toContain("data-bg-placeholder");
      expect(await generationOutputComplete(stage, "index.html", "website")).toBe(false);
      await writeFile(path.join(stage, "index.html"), html.replace(/ data-bg-placeholder(?:="[^"]*")?/g, "").replace("HEADLINE", "Own your AI."));
      expect(await generationOutputComplete(stage, "index.html", "website")).toBe(true);
    });
  });

  test("Given an entrypoint that already has content, a nested entrypoint or a context without measured pages, then nothing is written", async () => {
    const context = await pinnedContext(true);
    await withStage(async (stage) => {
      await writeFile(path.join(stage, "index.html"), "<!doctype html><h1>Mine</h1>");
      expect(await seedStarterEntrypoint(stage, context, "index.html")).toBe(false);
      expect(await readFile(path.join(stage, "index.html"), "utf8")).toBe("<!doctype html><h1>Mine</h1>");
    });
    await withStage(async (stage) => {
      expect(await seedStarterEntrypoint(stage, context, "pages/index.html")).toBe(false);
      expect(await readFile(path.join(stage, "pages", "index.html")).catch(() => null)).toBeNull();
      expect(await seedStarterEntrypoint(stage, await pinnedContext(false), "index.html")).toBe(false);
      expect(await readFile(path.join(stage, "index.html")).catch(() => null)).toBeNull();
    });
  });

  test("Given the page a new project is created with, then it counts as fresh and is seeded, while a page the user changed is not", async () => {
    const context = await pinnedContext(true);
    const creation = renderInitialArtifact({ name: "Acme", type: "prototype" });
    await withStage(async (stage) => {
      await writeFile(path.join(stage, "index.html"), creation);
      expect(await seedStarterEntrypoint(stage, context, "index.html")).toBe(true);
      expect((await readFile(path.join(stage, "index.html"), "utf8")).includes("Start a new prototype")).toBe(false);
    });
    await withStage(async (stage) => {
      const edited = creation.replace("Send your first prompt in chat to generate the first revision.", "My own copy.");
      await writeFile(path.join(stage, "index.html"), edited);
      expect(await seedStarterEntrypoint(stage, context, "index.html")).toBe(false);
      expect(await readFile(path.join(stage, "index.html"), "utf8")).toBe(edited);
    });
  });

  test("Given a page that declares its measured page, then it is built against the system only when it was not seeded this turn and no placeholder remains", () => {
    const declared = '<meta name="bg-measured-page" content="/">';
    expect(entrypointBuiltAgainstSystem(declared, false)).toBe(true);
    expect(entrypointBuiltAgainstSystem(declared, true)).toBe(false);
    expect(entrypointBuiltAgainstSystem(declared + "<section data-bg-placeholder></section>", false)).toBe(false);
    expect(entrypointBuiltAgainstSystem("<h1>No declaration</h1>", false)).toBe(false);
  });

  test("Given an empty entrypoint file, then it is treated as fresh and seeded", async () => {
    const context = await pinnedContext(true);
    await withStage(async (stage) => {
      await mkdir(stage, { recursive: true });
      await writeFile(path.join(stage, "index.html"), "  \n");
      expect(await seedStarterEntrypoint(stage, context, "index.html")).toBe(true);
      expect((await readFile(path.join(stage, "index.html"), "utf8")).includes("bg-measured-page")).toBe(true);
    });
  });
});
