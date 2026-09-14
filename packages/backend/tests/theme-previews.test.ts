import { describe, expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { bundledDesignSystems } from "../src/data/bundled-design-systems";
import { resolveRepoRoot } from "../src/lib/paths";

const previewsRoot = path.join(resolveRepoRoot(), "design system themes", "previews");
const mediaRoot = path.join(previewsRoot, "media");

describe("bundled design system website previews", () => {
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
      const archetype = page.match(/<body data-archetype="([^"]+)">/)?.[1];

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
});
