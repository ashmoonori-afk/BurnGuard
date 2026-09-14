import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedBundledDesignSystems } from "../src/bootstrap";
import {
  bundledDesignSystemId,
  bundledDesignSystems,
} from "../src/data/bundled-design-systems";
import { resolveRepoRoot } from "../src/lib/paths";
import { extractCssCustomProperties } from "../src/services/design-system-extract";

/** Themes converted from the daisyUI donor palettes; these carry the MIT attribution. */
const DONOR_SLUGS = [
  "light",
  "dark",
  "cupcake",
  "retro",
  "cyberpunk",
  "synthwave",
  "luxury",
  "dracula",
  "nord",
  "business",
] as const;

/** Original systems authored for BurnGuard; no donor palette, no third-party license. */
const LEGACY_ORIGINAL_SLUGS = [
  "cobalt-atelier",
  "signal-reel",
  "daylight-press",
  "blueprint-manual",
  "ledger-index",
  "dune-editorial",
  "archive-folio",
] as const;

/**
 * Original systems authored per design family. Beyond the layout contract they ship `--family-*`
 * tokens for the structural decision their family turns on, so two artifacts on the same theme
 * agree on more than colour.
 */
const FAMILY_ORIGINAL_SLUGS = [
  "signal-console",
  "paper-instrument",
  "quiet-runtime",
  "graphite-spec",
  "long-form-press",
  "wide-gutter-review",
  "quarterly-folio",
  "night-edition",
  "studio-counter",
  "atelier-counter",
  "market-stack",
  "vitrine-mono",
  "night-marquee",
  "stencil-field",
  "press-riso",
  "exhibit-wall",
  "index-table",
  "facet-archive",
  "console-ledger",
  "field-register",
  "warm-vestibule",
  "stone-court",
  "linen-retreat",
  "timber-hall",
] as const;

const ORIGINAL_SLUGS = [...LEGACY_ORIGINAL_SLUGS, ...FAMILY_ORIGINAL_SLUGS] as const;

const THEME_SLUGS = [...DONOR_SLUGS, ...ORIGINAL_SLUGS] as const;

const themesRoot = path.join(resolveRepoRoot(), "design system themes");
const canonicalTokensPath = path.join(
  resolveRepoRoot(),
  "design system sample",
  "colors_and_type.css",
);

describe("bundled daisyUI-derived design systems", () => {
  test("register the curated themes and ship the complete seed shape", async () => {
    expect(bundledDesignSystems.map(({ slug }) => slug)).toEqual(THEME_SLUGS);

    for (const slug of THEME_SLUGS) {
      const themeDir = path.join(themesRoot, slug);
      for (const fileName of ["colors_and_type.css", "SKILL.md", "README.md"]) {
        expect((await stat(path.join(themeDir, fileName))).isFile()).toBe(true);
      }
    }
  });

  test("state provenance truthfully per theme", async () => {
    // A donor theme must keep its attribution, and an original must not borrow one it does not owe.
    for (const slug of DONOR_SLUGS) {
      const readme = await readFile(path.join(themesRoot, slug, "README.md"), "utf8");
      expect(readme, slug).toContain("daisyUI");
      expect(readme, slug).toContain("MIT License");
    }
    for (const slug of ORIGINAL_SLUGS) {
      const readme = await readFile(path.join(themesRoot, slug, "README.md"), "utf8");
      const css = await readFile(path.join(themesRoot, slug, "colors_and_type.css"), "utf8");
      expect(readme, slug).toContain("Original system authored for BurnGuard");
      for (const borrowed of ["daisyUI", "MIT License", "Copyright"]) {
        expect(readme, `${slug}: ${borrowed}`).not.toContain(borrowed);
        expect(css, `${slug}: ${borrowed}`).not.toContain(borrowed);
      }
    }
  });

  test("ship layout as tokens, not as a per-artifact decision", async () => {
    // A design system is grid, measure and rhythm as much as colour and type. Without these an
    // artifact has to invent a layout, and two artifacts on the same theme stop matching.
    const required = [
      "layout-max", "layout-measure", "layout-columns", "layout-gutter", "layout-margin",
      "layout-section-y", "layout-rule", "layout-bp-md", "layout-bp-lg", "layout-hero",
    ];
    for (const slug of ORIGINAL_SLUGS) {
      const css = await readFile(path.join(themesRoot, slug, "colors_and_type.css"), "utf8");
      const tokens = await extractCssCustomProperties(css);
      for (const token of required) {
        expect(tokens.has(token), `${slug}: --${token}`).toBe(true);
        expect(tokens.get(token)?.trim(), `${slug}: --${token}`).not.toBe("");
      }
      // The README has to document the grid it ships, so a reader can reproduce it.
      const readme = await readFile(path.join(themesRoot, slug, "README.md"), "utf8");
      expect(readme, slug).toContain("## Layout");
      expect(readme, slug).toContain("--layout-measure");
    }
  });

  test("carry enough direction to be rebuilt from the theme alone", async () => {
    // The bar for an original system is that a reader with these three files and an image generator
    // can rebuild the look. Tokens alone do not carry composition or imagery, so both are written
    // down, and the self-check list is what makes the result verifiable rather than approximate.
    for (const slug of ORIGINAL_SLUGS) {
      const readme = await readFile(path.join(themesRoot, slug, "README.md"), "utf8");
      for (const section of ["## Composition", "## Image direction", "## Reproducing this system"]) {
        expect(readme, `${slug}: ${section}`).toContain(section);
      }
    }

    // A family system additionally encodes the structural choice its family turns on.
    for (const slug of FAMILY_ORIGINAL_SLUGS) {
      const css = await readFile(path.join(themesRoot, slug, "colors_and_type.css"), "utf8");
      const tokens = await extractCssCustomProperties(css);
      const family = [...tokens.keys()].filter((token) => token.startsWith("family-"));
      expect(family.length, `${slug}: --family-* tokens`).toBeGreaterThan(0);
      for (const token of family) {
        expect(tokens.get(token)?.trim(), `${slug}: --${token}`).not.toBe("");
      }
      const readme = await readFile(path.join(themesRoot, slug, "README.md"), "utf8");
      expect(readme, slug).toContain("## Family tokens");
      for (const token of family) {
        expect(readme, `${slug}: --${token}`).toContain(`--${token}`);
      }
    }
  });

  test("bootstrap copies token files that satisfy the canonical token contract", async () => {
    // The default 5 s test timeout is too tight for this many file copies
    // on Windows I/O; 30s gives headroom without masking a real regression.
    const destinationRoot = await mkdtemp(path.join(tmpdir(), "bg-theme-seeds-"));
    try {
      const canonicalCss = await readFile(canonicalTokensPath, "utf8");
      const requiredTokens = [...(await extractCssCustomProperties(canonicalCss)).keys()];
      expect(requiredTokens.length).toBeGreaterThan(0);

      await seedBundledDesignSystems(resolveRepoRoot(), destinationRoot);

      for (const slug of THEME_SLUGS) {
        const css = await readFile(
          path.join(
            destinationRoot,
            bundledDesignSystemId(slug),
            "colors_and_type.css",
          ),
          "utf8",
        );
        expect(css).toBe(await readFile(path.join(themesRoot, slug, "colors_and_type.css"), "utf8"));
        expect(css.toLowerCase()).not.toContain("oklch(");

        const tokens = await extractCssCustomProperties(css);
        for (const token of requiredTokens) {
          expect(tokens.has(token), `${slug}: --${token}`).toBe(true);
          expect(tokens.get(token)?.trim(), `${slug}: --${token}`).not.toBe("");
        }

        const colorSection = css.split("/* Type families */", 1)[0] ?? "";
        for (const [token, value] of await extractCssCustomProperties(colorSection)) {
          expect(value, `${slug}: --${token}`).toMatch(/^#[0-9a-f]{6}$/i);
        }

        expect(css).not.toMatch(/--(?:r-selector|r-field|r-box|depth)\s*:/);
      }
    } finally {
      await rm(destinationRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
