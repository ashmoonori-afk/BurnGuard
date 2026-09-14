import { describe, expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { bundledDesignSystems } from "../src/data/bundled-design-systems";
import { resolveRepoRoot } from "../src/lib/paths";
import { buildThemePreviews } from "../../../scripts/build-theme-previews";
import { hasBundledSystemPreview, readBundledSystemPreview } from "../src/services/bundled-system-preview";

const previewsRoot = path.join(resolveRepoRoot(), "design system themes", "previews");
const mediaRoot = path.join(previewsRoot, "media");

describe("bundled design system website previews", () => {
  test("Given every bundled website When the installed app reads it Then HTML media and real thumbnails are available through the same resource map", async () => {
    await Promise.all(bundledDesignSystems.map(async ({ slug }) => {
      const id = `builtin-theme-${slug}`;
      expect(await hasBundledSystemPreview(id), slug).toBe(true);
      expect((await readBundledSystemPreview(id, "preview/website.html"))?.toString()).toContain('href="./fonts.css"');
      for (const file of ["preview/thumbnail.webp", `preview/media/${slug}.webp`]) expect((await readBundledSystemPreview(id, file))?.toString("ascii", 8, 12)).toBe("WEBP");
    }));
    expect(await hasBundledSystemPreview("manual-theme")).toBe(false);
    expect(await readBundledSystemPreview("manual-theme", "preview/website.html")).toBeNull();
    expect(await readBundledSystemPreview("builtin-theme-light", "../dark.html")).toBeNull();
    expect(await readBundledSystemPreview("builtin-theme-light", "preview/media/dark.webp")).toBeNull();
  }, 90_000);
  test("Given the theme registry, every theme has one page and one generated image", async () => {
    const slugs = bundledDesignSystems.map(({ slug }) => slug);
    const pages = (await readdir(previewsRoot))
      .filter((file) => file.endsWith(".html") && file !== "index.html")
      .map((file) => file.slice(0, -".html".length))
      .sort();
    const media = (await readdir(mediaRoot))
      .filter((file) => file.endsWith(".webp"))
      .map((file) => file.slice(0, -".webp".length))
      .sort();

    expect(pages).toEqual([...slugs].sort());
    expect(media).toEqual([...slugs].sort());
    for (const slug of slugs) {
      expect((await stat(path.join(mediaRoot, `${slug}.webp`))).size).toBeGreaterThan(10_000);
    }
  });

  test("Given the preview index, it links every registered page exactly once", async () => {
    const index = await readFile(path.join(previewsRoot, "index.html"), "utf8");
    const links = [...index.matchAll(/href="\.\/([^"]+)\.html"/g)].map((match) => match[1]);

    expect(links).toEqual(bundledDesignSystems.map(({ slug }) => slug));
  });

  test("Given a local file URL, every page remains self-contained and identifies its archetype", async () => {
    const archetypes = new Set<string>();
    for (const { slug } of bundledDesignSystems) {
      const page = await readFile(path.join(previewsRoot, `${slug}.html`), "utf8");
      const archetype = page.match(/<body data-archetype="([^"]+)"/)?.[1];

      expect(archetype, slug).toBeDefined();
      expect(page, slug).toContain(`src="./media/${slug}.webp"`);
      expect(page, slug).toContain('href="../../assets/fonts/fonts.css"');
      expect(page, slug).not.toMatch(/(?:src|href)="https?:\/\//);
      if (archetype) archetypes.add(archetype);
    }

    expect([...archetypes].sort()).toEqual(
      ["article", "marketing", "place", "poster", "shop", "workspace"],
    );
  });

  test("Given current layout tokens When rebuilding in check mode Then every committed preview is reproducible", async () => {
    await expect(buildThemePreviews(true)).resolves.toBeDefined();
    for (const { slug } of bundledDesignSystems) {
      const source = await readFile(path.join(resolveRepoRoot(), "design system themes", slug, "colors_and_type.css"), "utf8");
      const page = await readFile(path.join(previewsRoot, `${slug}.html`), "utf8");
      const values = new Map([...source.matchAll(/--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)].map(match => [match[1]!, match[2]!.trim()]));
      expect(page, slug).toContain(`data-layout="${values.get("layout-structure")}"`);
      expect(page, slug).toContain(`@media (max-width:${values.get("layout-bp-md")})`);
      const ratio = values.get("family-media-text-ratio");
      if (ratio) {
        const [media, text = 1] = ratio.split("/").map(Number);
        expect(page, slug).toContain(`grid-template-columns:minmax(0,${media}fr) minmax(0,${text}fr)`);
      }
      if (values.get("family-ui-navigation-placement") === "side") {
        const span = Number(values.get("family-ui-navigation-span"));
        expect(page, slug).toContain(`grid-template-columns:minmax(0,${span}fr) minmax(0,${Number(values.get("layout-columns")) - span}fr)`);
      }
    }
  });
});
