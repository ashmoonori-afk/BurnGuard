import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MEASURED_VIEWPORTS, parseDesignSystemLayoutReference, parseDesignSystemMeasuredLayout, type MeasuredViewportLayout } from "@bg/shared";
import { appendDesignSystemContext } from "../src/harness/prompt-design-system";
import { heroAssetsFromPinnedContext, provisionDesignSystemHeroAssets } from "../src/services/design-system-layout-reference";
import { buildStarterHtml, starterPlan } from "../src/services/design-system-starter";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const HERO = new TextEncoder().encode("hero-image-bytes");
const shot = (name: "desktop" | "mobile") => ({ path: "/", viewport: name, file: `layout-reference/p0-${name}.jpg`, width: MEASURED_VIEWPORTS[name].width, height: 1800, size: 4, sha256: sha(new Uint8Array([1, 2, 3, 4])) });
const heroAsset = { file: "assets/hero/hero.png", size: HERO.byteLength, sha256: sha(HERO) };

const viewport = (name: "desktop" | "mobile", overlapping: boolean): MeasuredViewportLayout => ({
  viewport: { ...MEASURED_VIEWPORTS[name] }, page_height: 2000, container: { left: 120, width: 1200 }, gutter: 24, section_gap: 96, type_scale: { hero: 64 },
  blocks: { hero_heading: { x: 300, y: 200, width: 700, height: 120, align: "center" }, media: overlapping ? { x: 0, y: 100, width: 1440, height: 600, align: "center" } : { x: 900, y: 900, width: 400, height: 300, align: "right" } },
  sections: [{ heading: "Hero", top: 100, height: 700, columns: 1, align: "center" }],
});
const measured = (overlapping: boolean) => ({ schema_version: 1, method: "rendered-offline", pages: [{ path: "/", page_type: "home", viewports: { desktop: viewport("desktop", overlapping), mobile: viewport("mobile", overlapping) } }] });

async function withSystem(overlapping: boolean, run: (dir: string, context: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-hero-assets-"));
  try {
    await mkdir(path.join(dir, "assets", "hero"), { recursive: true });
    await writeFile(path.join(dir, "assets", "hero", "hero.png"), HERO);
    await writeFile(path.join(dir, "layout-measured.json"), JSON.stringify(measured(overlapping)));
    await mkdir(path.join(dir, "layout-reference"));
    for (const name of ["desktop", "mobile"] as const) await writeFile(path.join(dir, "layout-reference", `p0-${name}.jpg`), new Uint8Array([1, 2, 3, 4]));
    await writeFile(path.join(dir, "layout-reference.json"), JSON.stringify({ schema_version: 1, shots: [shot("desktop"), shot("mobile")], hero_assets: [heroAsset] }));
    const system = { id: "hero", name: "Hero", status: "draft", source_type: "website", is_template: false, dir_path: dir, skill_md_path: null, tokens_css_path: null, readme_md_path: null, thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null } as const;
    const lines: string[] = [];
    await appendDesignSystemContext(lines, system, "full", "website", true);
    await run(dir, lines.join("\n"));
  } finally { await rm(dir, { recursive: true, force: true }); }
}

describe("Design-system hero assets", () => {
  test("Given reference indexes, then hero_assets are accepted only as bounded assets/hero files with a digest", () => {
    const base = { schema_version: 1, shots: [shot("desktop")] };
    expect(parseDesignSystemLayoutReference({ ...base, hero_assets: [heroAsset] }).hero_assets).toEqual([heroAsset]);
    expect(parseDesignSystemLayoutReference(base).hero_assets).toBeUndefined();
    for (const bad of [{ ...heroAsset, file: "../hero.png" }, { ...heroAsset, file: "assets/hero/a/b.png" }, { ...heroAsset, file: "assets/logo/hero.png" }, { ...heroAsset, sha256: "x" }, { ...heroAsset, size: 0 }, { ...heroAsset, size: 9_000_000 }, { ...heroAsset, extra: 1 }]) {
      expect(() => parseDesignSystemLayoutReference({ ...base, hero_assets: [bad] })).toThrow();
    }
    expect(() => parseDesignSystemLayoutReference({ ...base, hero_assets: [heroAsset, heroAsset, heroAsset] })).toThrow();
    expect(() => parseDesignSystemLayoutReference({ ...base, hero_assets: [{ ...heroAsset, file: "assets/hero/Hero.png" }, { ...heroAsset, file: "assets/hero/hero.png" }] })).toThrow();
  });

  test("Given a system with a hero asset, then the pinned context freezes it and staging copies it only while its bytes match", async () => {
    await withSystem(true, async (dir, context) => {
      expect(heroAssetsFromPinnedContext(context)).toEqual([heroAsset]);
      const stage = await mkdtemp(path.join(tmpdir(), "bg-hero-assets-stage-"));
      try {
        expect(await provisionDesignSystemHeroAssets(stage, context, null)).toEqual([]);
        expect(await provisionDesignSystemHeroAssets(stage, context, dir)).toEqual(["assets/hero/hero.png"]);
        expect(new Uint8Array(await readFile(path.join(stage, "assets", "hero", "hero.png")))).toEqual(HERO);
        await writeFile(path.join(stage, "assets", "hero", "hero.png"), new TextEncoder().encode("user-edited"));
        expect(await provisionDesignSystemHeroAssets(stage, context, dir)).toEqual([]);
        expect(await readFile(path.join(stage, "assets", "hero", "hero.png"), "utf8")).toBe("user-edited");
        await rm(path.join(stage, "assets"), { recursive: true });
        await writeFile(path.join(dir, "assets", "hero", "hero.png"), new TextEncoder().encode("re-extracted"));
        expect(await provisionDesignSystemHeroAssets(stage, context, dir)).toEqual([]);
        expect(await readFile(path.join(stage, "assets", "hero", "hero.png")).catch(() => null)).toBeNull();
      } finally { await rm(stage, { recursive: true, force: true }); }
    });
  });

  test("Given a hero whose media overlaps the heading, then the plan is media-behind and names the pinned hero image; a hero without overlap and a context without a pin do not", async () => {
    await withSystem(true, async (_dir, context) => {
      const page = starterPlan(context)!.pages[0]!;
      expect([page.hero, page.hero_media]).toEqual(["media-behind", "assets/hero/hero.png"]);
    });
    await withSystem(false, async (_dir, context) => {
      const page = starterPlan(context)!.pages[0]!;
      expect(page.hero).toBe("centered");
      expect(page.hero_media).toBeUndefined();
    });
    await withSystem(true, async (_dir, context) => {
      const without = context.replace(/<selected_design_system_hero_assets>[\s\S]*?<\/selected_design_system_hero_assets>\n?/, "");
      expect(starterPlan(without)!.pages[0]!.hero_media).toBeUndefined();
    });
  });

  test("Given a hero media path, then the skeleton uses the image in the media slot; otherwise the slot stays a placeholder", () => {
    const page = parseDesignSystemMeasuredLayout(measured(true)).pages[0]!;
    const html = buildStarterHtml(page, "assets/hero/hero.png");
    expect(html).toContain('<img src="assets/hero/hero.png" alt="">');
    expect(buildStarterHtml(page)).not.toContain("<img");
  });
});
