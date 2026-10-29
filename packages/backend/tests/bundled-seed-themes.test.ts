import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseHexColor, rgbToOklch } from "@bg/shared/color";
import { emitPaletteCss, parsePaletteState, serializePalette } from "@bg/shared/palette";
import {
  BundledPaletteGenerationError, bundledPalettePaths, emitBundledPalettePatch,
  extendBundledPaletteHistory, generateBundledPalettePlan, generateThemePalettePair,
} from "../../../scripts/build-theme-palettes";
import { seedBundledDesignSystems } from "../src/bootstrap";
import {
  bundledDesignSystemId,
  bundledDesignSystems,
} from "../src/data/bundled-design-systems";
import { resolveRepoRoot } from "../src/lib/paths";
import { extractCssCustomProperties } from "../src/services/design-system-extract";
import { runMigrationsFrom } from "../src/db/migrate";
import {
  bundledThemeHistory, themeAdditiveDigest, themeFileHash, type BundledThemeHistory,
} from "../src/services/bundled-theme-refresh";
import { paletteContentEnvironment, readDesignSystemPalette } from "../src/services/design-system-palette";
import frozenBrands from "./fixtures/theme-engine/baseline/brand-anchors.json";
import frozenLegacy from "./fixtures/theme-engine/baseline/legacy-inventory.json";

/**
 * The first ten built-in themes. Their palettes are authored for BurnGuard; the slugs predate the
 * original families and stay because seeded workspaces key off `builtin-theme-<slug>`.
 */
const CLASSIC_SLUGS = [
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

/** Original systems authored for BurnGuard; no third-party palette, no third-party license. */
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
  "exploded-field-module",
  "long-form-press",
  "wide-gutter-review",
  "quarterly-folio",
  "night-edition",
  "studio-counter",
  "atelier-counter",
  "market-stack",
  "vitrine-mono",
  "modular-configurator",
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

const THEME_SLUGS = [...CLASSIC_SLUGS, ...ORIGINAL_SLUGS] as const;

/** WCAG 2.2 relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** Text pairs need 4.5:1 (WCAG 1.4.3); component boundaries and focus need 3:1 (WCAG 1.4.11). */
const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // fg-4 sets captions, bylines and catalogue labels at 9.5-12px, so it is normal text, not a component.
  ...["fg-1", "fg-2", "fg-3", "fg-4"].flatMap((text) =>
    ["bg", "bg-subtle", "bg-muted", "surface"].map((ground) => [text, ground] as const),
  ),
  ["fg-on-dark", "surface-inverse"],
  ["fg-on-brand", "primary-blue"],
  ["fg-on-secondary", "secondary"],
  ["fg-on-accent", "accent"],
  ["fg-on-info", "info"],
  ["fg-on-success", "success"],
  ["fg-on-warning", "warning-yellow"],
  ["fg-on-error", "error"],
];
const COMPONENT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["border-strong", "bg"],
  ["focus-ring", "bg"],
  ["primary-blue", "bg"],
];

const themesRoot = path.join(resolveRepoRoot(), "design system themes");
const canonicalTokensPath = path.join(
  resolveRepoRoot(),
  "design system sample",
  "colors_and_type.css",
);

describe("bundled palette materialization", () => {
  test("Given production CSS When generation repeats Then every owned pair and history byte is deterministic", async () => {
    const first = await generateBundledPalettePlan();
    const second = await generateBundledPalettePlan();
    expect(first).toEqual(second);
    expect(first.pairs.map(pair => pair.slug)).toEqual([...THEME_SLUGS]);
    expect(first.changes).toEqual([]);
    for (const pair of first.pairs) {
      const paths = bundledPalettePaths(resolveRepoRoot(), pair.slug);
      expect((await readdir(path.join(paths.directory, "palette"))).sort()).toEqual(["scales.css", "state.json"]);
      expect(await readFile(paths.state, "utf8")).toBe(pair.json);
      expect(await readFile(paths.css, "utf8")).toBe(pair.css);
      expect(`${serializePalette(parsePaletteState(pair.json))}\n`).toBe(pair.json);
      expect(emitPaletteCss(pair.state)).toBe(pair.css);
    }
  }, 30_000);

  test("Given all frozen brands When production CSS generates palettes Then exact anchors and actual theme hues survive", async () => {
    expect(frozenBrands.rows.map(row => row.slug)).toEqual([...THEME_SLUGS]);
    for (const row of frozenBrands.rows) {
      const source = await readFile(bundledPalettePaths(resolveRepoRoot(), row.slug).source, "utf8");
      const tokens = await extractCssCustomProperties(source);
      const pair = generateThemePalettePair(row.slug, source);
      const brand = pair.state.anchors.find(anchor => anchor.id === "anchor-primary-blue");
      expect(brand?.color, row.slug).toEqual(parseHexColor(row.hex));
      expect(brand?.color, row.slug).toEqual({ space: "srgb", r: row.rgb[0], g: row.rgb[1], b: row.rgb[2] });
      for (const anchor of pair.state.anchors) {
        expect(anchor.color, `${row.slug}: ${anchor.id}`).toEqual(parseHexColor(tokens.get(anchor.name.slice(2))));
      }
      const chromas: number[] = [];
      for (const scale of pair.state.scales) {
        const color = rgbToOklch(parseHexColor(tokens.get(scale.name.slice(2))));
        chromas.push(color.c);
        expect(scale.kind, `${row.slug}: ${scale.id}`).toBe(color.c === 0 ? "neutral" : "hue");
        if (scale.kind === "hue") expect(scale.hue).toBe(color.h);
      }
      expect(pair.state.curve.amount).toBe(Math.max(...chromas));
    }
  }, 30_000);

  test("Given missing or ambiguous production colours When generated Then no default brand is substituted", async () => {
    const source = await readFile(bundledPalettePaths(resolveRepoRoot(), "light").source, "utf8");
    for (const invalid of [
      source.replace(/--primary-blue\s*:[^;]*;/, ""),
      source.replace(/--primary-blue\s*:[^;]*;/, "--primary-blue: var(--accent);"),
      source + "\n:root { --primary-blue: #123456; }\n",
    ]) {
      expect(() => generateThemePalettePair("light", invalid)).toThrow(BundledPaletteGenerationError);
    }
    expect(() => generateThemePalettePair("../light", source)).toThrow(BundledPaletteGenerationError);
    const changed = generateThemePalettePair("light", source.replace(/--primary-blue\s*:[^;]*;/, "--primary-blue: #123456;"));
    expect(changed.state.anchors.find(anchor => anchor.id === "anchor-primary-blue")?.color).toEqual(parseHexColor("#123456"));
    expect(changed.json).not.toBe(generateThemePalettePair("light", source).json);
    expect(generateThemePalettePair("light", source.replace(/\n/g, "\r\n"))).toEqual(generateThemePalettePair("light", source));
  });

  test("Given all shipped pairs When the real palette service reads them Then approved hashes alone grant ownership", async () => {
    const systemsRoot = await mkdtemp(path.join(tmpdir(), "bg-shipped-palettes-"));
    const db = new Database(":memory:");
    try {
      db.run("PRAGMA foreign_keys=ON");
      await runMigrationsFrom(db, path.join(import.meta.dir, "../src/db/migrations"));
      const env = paletteContentEnvironment(db, systemsRoot);
      for (const { slug } of bundledDesignSystems) {
        const id = bundledDesignSystemId(slug), live = path.join(systemsRoot, id);
        const shipped = bundledPalettePaths(resolveRepoRoot(), slug);
        await mkdir(live);
        await cp(path.join(shipped.directory, "palette"), path.join(live, "palette"), { recursive: true });
        db.query("INSERT INTO design_systems(id,name,status,dir_path,created_at,updated_at) VALUES (?,?,'draft',?,1,1)")
          .run(id, slug, live);
        const result = await readDesignSystemPalette(id, env);
        expect(result.state).toEqual(parsePaletteState(await readFile(shipped.state, "utf8")));
        expect(result.css).toBe(await readFile(shipped.css, "utf8"));
        expect(result.receipt_id).toBeNull();
        expect(result.content_revision).toBe(0);
      }
      const id = bundledDesignSystemId("light"), live = path.join(systemsRoot, id);
      const current = await readDesignSystemPalette(id, env);
      if (current.state === null) throw new Error("Missing shipped palette state");
      const next = { ...current.state, display: { ...current.state.display, scale_gap: current.state.display.scale_gap + 1 } };
      await writeFile(path.join(live, "palette", "state.json"), `${serializePalette(next)}\n`);
      await expect(readDesignSystemPalette(id, env)).rejects.toMatchObject({ code: "palette_ownership_conflict" });
      await writeFile(path.join(live, "palette", "state.json"), `${serializePalette(current.state)}\n`);
      await writeFile(path.join(live, "palette", "extra.css"), "");
      await expect(readDesignSystemPalette(id, env)).rejects.toMatchObject({ code: "palette_ownership_conflict" });
      expect(db.query("SELECT COUNT(*) AS count FROM design_system_receipts").get()).toEqual({ count: 0 });
    } finally {
      db.close(true);
      await rm(systemsRoot, { recursive: true, force: true });
    }
  }, 30_000);

  test("Given exact shipped subtrees When history is extended Then only nonempty palette authority is added", async () => {
    const pairs = (await generateBundledPalettePlan()).pairs;
    const empty = themeAdditiveDigest(new Map(), "palette");
    for (const pair of pairs) {
      const files = new Map([
        ["palette/state.json", themeFileHash(Buffer.from(pair.json))],
        ["palette/scales.css", themeFileHash(Buffer.from(pair.css))],
      ]);
      const frame = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([name, hash]) => `${name}\t${hash}\n`).join("");
      expect(pair.digest).toBe(createHash("sha256").update(frame).digest("hex"));
      expect(pair.digest).not.toBe(empty);
      expect(bundledThemeHistory.additive?.[pair.slug]?.palette).toContain(pair.digest);
      expect(bundledThemeHistory.additive?.[pair.slug]?.palette).not.toContain(empty);
      expect(themeAdditiveDigest(new Map([...files, ["canonical/tokens.json", "a".repeat(64)], ["README.md", "b".repeat(64)]]), "palette"))
        .toBe(pair.digest);
      expect(themeAdditiveDigest(new Map([["palette/state.json", files.get("palette/state.json") ?? ""]]), "palette")).not.toBe(pair.digest);
    }
    const prior: BundledThemeHistory = {
      themes: bundledThemeHistory.themes, retired: bundledThemeHistory.retired,
      additive: { light: { palette: ["a".repeat(64)], canonical: ["b".repeat(64)] }, retired_slug: { palette: ["c".repeat(64)] } },
    };
    const before = JSON.stringify(prior);
    const extended = extendBundledPaletteHistory(prior, pairs);
    expect(JSON.stringify(prior)).toBe(before);
    expect(extended.themes).toEqual(prior.themes);
    expect(extended.retired).toEqual(prior.retired);
    expect(extended.additive?.light?.canonical).toEqual(prior.additive?.light?.canonical);
    expect(extended.additive?.light?.palette).toContain("a".repeat(64));
    expect(extended.additive?.retired_slug).toEqual(prior.additive?.retired_slug);
    expect(extendBundledPaletteHistory(extended, pairs)).toEqual(extended);
  }, 30_000);

  test("Given the frozen legacy inventory When palettes are added Then every prior theme and font file stays unchanged", async () => {
    const files = [...frozenLegacy.systems.flatMap(system => system.files), ...frozenLegacy.shared_inputs.flatMap(input => input.files)];
    expect(frozenLegacy.systems.map(system => system.slug)).toEqual([...THEME_SLUGS]);
    expect(files).toHaveLength(frozenLegacy.counts.theme_files + frozenLegacy.counts.shared_font_files);
    for (const file of files) {
      const bytes = await readFile(path.join(resolveRepoRoot(), ...file.path.split("/")));
      // Text checkout endings may differ on Windows; binary font bytes never do.
      const normalized = /\.(css|md|txt|json)$/i.test(file.path)
        ? Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n")) : bytes;
      expect(normalized.length, file.path).toBe(file.bytes);
      expect(createHash("sha256").update(normalized).digest("hex"), file.path).toBe(file.sha256);
    }
  }, 30_000);

  test("Given Windows and POSIX roots When paths and patches are formed Then IO is native and palette identities stay portable", () => {
    for (const [flavor, root] of [[path.win32, "C:\\work\\BurnGuard"], [path.posix, "/work/BurnGuard"]] as const) {
      const paths = bundledPalettePaths(root, "light", flavor);
      expect(paths.state).toBe(flavor.join(root, "design system themes", "light", "palette", "state.json"));
      expect(paths.css).toBe(flavor.join(root, "design system themes", "light", "palette", "scales.css"));
      expect(paths.source).toBe(flavor.join(root, "design system themes", "light", "colors_and_type.css"));
      expect(paths.relative).toBe("design system themes/light");
    }
    for (const slug of ["..", "../light", "..\\light", "C:\\light", "/light"]) {
      expect(() => bundledPalettePaths("/work", slug)).toThrow(BundledPaletteGenerationError);
    }
    const relative = "design system themes/light/palette/state.json";
    const patch = emitBundledPalettePatch([{ relative, before: null, after: "{}\n" }]);
    expect(patch).toContain(`+++ "b/${relative}"\n`);
    expect(patch).toContain("@@ -0,0 +1,1 @@\n+{}\n");
    expect(patch).not.toContain("\\ No newline at end of file");
    expect(emitBundledPalettePatch([])).toBe("");
  });
});

describe("bundled design systems", () => {
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
    // Every bundled palette is BurnGuard's own, so no theme may claim an attribution it does not owe.
    const themes = await Promise.all(THEME_SLUGS.map(async (slug) => ({
      slug,
      readme: await readFile(path.join(themesRoot, slug, "README.md"), "utf8"),
      css: await readFile(path.join(themesRoot, slug, "colors_and_type.css"), "utf8"),
    })));
    for (const { slug, readme, css } of themes) {
      expect(readme, slug).toContain(
        (CLASSIC_SLUGS as readonly string[]).includes(slug)
          ? "Palette authored for BurnGuard"
          : "Original system authored for BurnGuard",
      );
      for (const borrowed of ["Derived from", "MIT License", "Copyright"]) {
        expect(readme, `${slug}: ${borrowed}`).not.toContain(borrowed);
        expect(css, `${slug}: ${borrowed}`).not.toContain(borrowed);
      }
    }
    // Eighty-two theme files; allow bounded slow-disk I/O as the seed-copy case below does.
  }, 30_000);

  test("Given every bundled theme palette When its colour pairs are measured Then each meets WCAG 2.2 AA", async () => {
    for (const slug of THEME_SLUGS) {
      const css = await readFile(path.join(themesRoot, slug, "colors_and_type.css"), "utf8");
      const colors = await extractCssCustomProperties(css);
      const color = (token: string): string => {
        const value = colors.get(token)?.trim();
        expect(value, `${slug}: --${token}`).toMatch(/^#[0-9a-f]{6}$/i);
        return value!;
      };
      for (const [minimum, pairs] of [[4.5, TEXT_PAIRS], [3, COMPONENT_PAIRS]] as const) {
        for (const [foreground, background] of pairs) {
          const ratio = contrastRatio(color(foreground), color(background));
          expect(ratio, `${slug}: --${foreground} on --${background}`).toBeGreaterThanOrEqual(minimum);
        }
      }
    }
  }, 30_000);

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
    // Forty-one systems each own a font bundle; allow bounded Windows disk I/O.
    const destinationRoot = await mkdtemp(path.join(tmpdir(), "bg-theme-seeds-"));
    try {
      const canonicalCss = await readFile(canonicalTokensPath, "utf8");
      // Preserve shipped shared keys and new canonical keys. Only the additional
      // stops in Northvale's ten preview ramps are specific to that sample.
      const sharedCss = await readFile(path.join(import.meta.dir, "fixtures/northvale-legacy/colors_and_type.css"), "utf8");
      const sharedTokens = await extractCssCustomProperties(sharedCss);
      const sampleTokens = await extractCssCustomProperties(canonicalCss);
      const requiredTokens = [...new Set([...sharedTokens.keys(), ...sampleTokens.keys()])].filter(token =>
        !token.startsWith("family-") &&
        (sharedTokens.has(token) || !/^(red|orange|yellow|green|teal|aqua|blue|ultramarine|purple|pink)-(10|20|30|40|50|60|70|80|90|100)$/.test(token)),
      );
      expect(requiredTokens.length).toBeGreaterThan(0);
      for (const token of requiredTokens) {
        expect(sampleTokens.has(token), `northvale: --${token}`).toBe(true);
        expect(sampleTokens.get(token)?.trim(), `northvale: --${token}`).not.toBe("");
      }

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
  }, 120_000);
});
