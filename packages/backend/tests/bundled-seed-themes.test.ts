import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseHexColor, rgbToOklch } from "@bg/shared/color";
import { emitPaletteCss, PALETTE_DERIVED_DIGITS, parsePaletteState, serializePalette } from "@bg/shared/palette";
import {
  THEME_CONTRAST_PAIRS, THEME_TOKEN_REGISTRY, SEMANTIC_THEME_MODES,
  emitAppThemeCss, getThemeSettings, parseSemanticTheme, serializeSemanticTheme,
  type SemanticTheme, type ThemeSettings,
} from "@bg/shared/theme";
import {
  BundledCanonicalGenerationError, bundledCanonicalPaths, emitBundledCanonicalPatch,
  extendBundledCanonicalHistory, generateBundledCanonicalPlan, generateThemeCanonical,
  readCommittedCanonicalHistory,
} from "../../../scripts/build-theme-canonical";
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
        if (scale.kind === "hue") expect(scale.hue).toBe(Number(color.h.toFixed(PALETTE_DERIVED_DIGITS)) % 360);
      }
      expect(pair.state.curve.amount).toBe(Number(Math.max(...chromas).toFixed(PALETTE_DERIVED_DIGITS)));
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

describe("bundled canonical production generation", () => {
  const historyRelative = "packages/backend/src/data/bundled-theme-history.json";
  const scalarSources: readonly (readonly [keyof ThemeSettings & string, string])[] = [
    ["font-size-body", "fs-16"], ["font-size-heading", "fs-32"],
    ["font-weight-body", "fw-regular"], ["font-weight-heading", "fw-semibold"],
    ["line-height-body", "lh-normal"], ["line-height-heading", "lh-snug"],
    ["space-1", "sp-1"], ["space-2", "sp-2"], ["space-3", "sp-3"],
    ["space-4", "sp-4"], ["space-6", "sp-6"],
    ["radius", "r-8"], ["radius-control", "r-4"], ["radius-pill", "r-pill"],
    ["motion-fast", "dur-fast"], ["motion-normal", "dur-base"],
  ];
  function requiredValue(values: ReadonlyMap<string, string>, name: string): string {
    const value = values.get(name);
    if (value === undefined) throw new BundledCanonicalGenerationError("test", name);
    return value;
  }
  function emittedVariables(theme: SemanticTheme, css: string, mode: "light" | "dark", app: boolean) {
    const selector = app
      ? `:root[data-bg-app-system="${theme.system_id}"][data-theme="${mode}"]`
      : `[data-bg-system="${theme.system_id}"][data-bg-mode="${mode}"]`;
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = css.indexOf("}", start);
    expect(end).toBeGreaterThan(start);
    const variables = new Map<string, string>();
    for (const match of css.slice(start, end).matchAll(/--([a-z0-9-]+): ([^;\n]+);/g)) {
      const name = match[1], value = match[2];
      if (name === undefined || value === undefined) throw new BundledCanonicalGenerationError("test", "emitted declaration");
      expect(variables.has(name)).toBe(false);
      variables.set(name, value);
    }
    return variables;
  }
  function emittedHex(value: string, app: boolean): string {
    if (!app) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
      return value;
    }
    expect(value).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    const channels = value.split(" ").map(Number);
    for (const n of channels) expect(n).toBeLessThanOrEqual(255);
    return "#" + channels.map(n => n.toString(16).padStart(2, "0")).join("");
  }
  function expectedShadow(source: string) {
    if (source === "none") return { type: "shadow", layers: [] };
    const match = source.match(/^(\S+)\s+(\S+)\s+(\S+)\s+rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
    if (!match) throw new BundledCanonicalGenerationError("test", "production shadow grammar");
    return { type: "shadow", layers: [{
      unit: "px", x: Number.parseFloat(match[1] ?? ""), y: Number.parseFloat(match[2] ?? ""),
      blur: Number.parseFloat(match[3] ?? ""), spread: 0,
      color: { type: "color", space: "srgb", channels: [Number(match[4]), Number(match[5]), Number(match[6])] },
      alpha: Number(match[7]),
    }] };
  }
  async function input(slug = "light") {
    const paths = bundledCanonicalPaths(resolveRepoRoot(), slug);
    return {
      source: await readFile(paths.source, "utf8"),
      palette: parsePaletteState(await readFile(paths.palette, "utf8")),
    };
  }
  async function fixture() {
    const repository = await mkdtemp(path.join(tmpdir(), "bg-canonical-inputs-"));
    try {
      const productionHistory = await readCommittedCanonicalHistory();
      // This owned fixture models the pre-canonical commit, even after production is materialized.
      // Real legacy/palette authority stays intact; only this simulated commit lacks canonical hashes.
      const committed: BundledThemeHistory = {
        themes: productionHistory.themes, retired: productionHistory.retired,
        additive: Object.fromEntries(Object.entries(productionHistory.additive ?? {}).map(([slug, directories]) => [
          slug, directories.palette === undefined ? {} : { palette: directories.palette },
        ])),
      };
      for (const { slug } of bundledDesignSystems) {
        const source = bundledCanonicalPaths(resolveRepoRoot(), slug);
        const destination = bundledCanonicalPaths(repository, slug);
        await mkdir(path.dirname(destination.palette), { recursive: true });
        await cp(source.source, destination.source);
        await cp(source.palette, destination.palette);
      }
      const history = path.join(repository, ...historyRelative.split("/"));
      await mkdir(path.dirname(history), { recursive: true });
      await writeFile(history, `${JSON.stringify(committed, null, 2)}\n`);
      return { repository, committed, history };
    } catch (error) {
      await rm(repository, { recursive: true, force: true });
      throw error;
    }
  }
  async function legacyHashes() {
    const files = [
      ...frozenLegacy.systems.flatMap(system => system.files),
      ...frozenLegacy.shared_inputs.flatMap(group => group.files),
    ];
    const hashes = new Map<string, string>();
    for (const file of files) {
      const bytes = await readFile(path.join(resolveRepoRoot(), ...file.path.split("/")));
      // Compare exact native checkout bytes before/after planning, not normalized text.
      hashes.set(file.path, createHash("sha256").update(bytes).digest("hex"));
    }
    return hashes;
  }

  test("Given all 43 production inputs When planning twice Then exact anchors settings and legacy bytes survive reproducibly", async () => {
    const legacy = await legacyHashes();
    const first = await generateBundledCanonicalPlan();
    const second = await generateBundledCanonicalPlan();
    expect(first).toEqual(second);
    expect(emitBundledCanonicalPatch(first.changes)).toBe(emitBundledCanonicalPatch(second.changes));
    expect(first.themes.map(theme => theme.slug)).toEqual([...THEME_SLUGS]);
    expect(first.themes).toHaveLength(43);
    expect(frozenBrands.rows.map(row => row.slug)).toEqual([...THEME_SLUGS]);
    for (const generated of first.themes) {
      const original = await input(generated.slug);
      const source = await extractCssCustomProperties(original.source);
      const oracle = frozenBrands.rows.find(row => row.slug === generated.slug);
      if (!oracle) throw new BundledCanonicalGenerationError(generated.slug, "frozen brand oracle");
      expect(generated.theme.palette).toEqual(original.palette);
      expect(generated.theme.brand_anchors).toEqual(original.palette.anchors);
      expect(generated.theme.brand_anchors.find(anchor => anchor.id === "anchor-primary-blue")?.color)
        .toEqual(parseHexColor(oracle.hex));
      expect(generated.theme.default_mode).toBe(original.palette.display.appearance);
      expect(generated.theme.sources).toEqual({
        brand: { kind: "anchor", id: "anchor-primary-blue" }, surface: { kind: "scale", id: "scale-gray-50" },
        status: {
          success: parseHexColor(requiredValue(source, "success")),
          warning: parseHexColor(requiredValue(source, "warning-yellow")),
          destructive: parseHexColor(requiredValue(source, "error")),
          info: parseHexColor(requiredValue(source, "info")),
        },
      });
      expect(parseSemanticTheme(generated.json)).toEqual(generated.theme);
      expect(serializeSemanticTheme(generated.theme)).toBe(generated.json);
      expect(generated.theme.contrast_pairs).toEqual(THEME_CONTRAST_PAIRS);
      const settings = getThemeSettings(generated.theme);
      for (const mode of SEMANTIC_THEME_MODES) {
        expect(Object.keys(generated.theme.modes[mode])).toEqual(Object.keys(THEME_TOKEN_REGISTRY));
        for (const [role, sourceName] of scalarSources) {
          const value = settings[mode][role];
          switch (value.type) {
            case "length": case "duration":
              expect(`${value.value}${value.unit}`, `${generated.slug}/${mode}/${role}`).toBe(requiredValue(source, sourceName));
              break;
            case "weight": case "ratio":
              expect(String(value.value), `${generated.slug}/${mode}/${role}`).toBe(requiredValue(source, sourceName));
              break;
            default: throw new BundledCanonicalGenerationError(generated.slug, role);
          }
        }
        for (const role of ["font-sans", "font-mono"] as const) {
          expect(settings[mode][role]).toEqual({
            type: "font-family",
            families: requiredValue(source, role).split(",").map(part => part.trim().replace(/^["']|["']$/g, "")),
          });
        }
        expect(settings[mode]["shadow-sm"]).toEqual(expectedShadow(requiredValue(source, "shadow-1")));
        expect(settings[mode]["shadow-lg"]).toEqual(expectedShadow(requiredValue(source, "shadow-3")));
        const curve = settings[mode]["motion-easing"];
        if (curve.type !== "easing" || typeof curve.value === "string") {
          throw new BundledCanonicalGenerationError(generated.slug, "production cubic curve");
        }
        expect(`cubic-bezier(${curve.value.points.join(", ")})`).toBe(requiredValue(source, "ease-standard"));
      }
      for (const text of [generated.json, generated.css, generated.skill]) {
        expect(text.endsWith("\n")).toBe(true);
        expect(text.endsWith("\n\n")).toBe(false);
        expect(text).not.toContain("\r");
      }
      const files = new Map([
        ["canonical/theme.json", themeFileHash(Buffer.from(generated.json))],
        ["canonical/theme.css", themeFileHash(Buffer.from(generated.css))],
        ["canonical/SKILL.md", themeFileHash(Buffer.from(generated.skill))],
      ]);
      expect(generated.digest).toBe(themeAdditiveDigest(files, "canonical"));
      expect(first.history.additive?.[generated.slug]?.canonical).toContain(generated.digest);
      expect(first.history.additive?.[generated.slug]?.canonical).not.toContain(themeAdditiveDigest(new Map(), "canonical"));
    }
    expect(first.changes.every(change => change.relative === historyRelative ||
      /^design system themes\/[a-z-]+\/canonical\/(theme\.json|theme\.css|SKILL\.md)$/.test(change.relative))).toBe(true);
    expect(await legacyHashes()).toEqual(legacy);
  }, 30_000);

  test("Given real production canonical outputs When both emitter modes are read Then every immutable contrast obligation meets its floor", async () => {
    const plan = await generateBundledCanonicalPlan();
    let pairs = 0;
    for (const generated of plan.themes) {
      for (const app of [false, true]) {
        const css = app ? emitAppThemeCss(generated.theme) : generated.css;
        for (const mode of SEMANTIC_THEME_MODES) {
          const values = emittedVariables(generated.theme, css, mode, app);
          for (const pair of THEME_CONTRAST_PAIRS) {
            const foreground = emittedHex(requiredValue(values, pair.foreground), app);
            const background = emittedHex(requiredValue(values, pair.background), app);
            expect(contrastRatio(foreground, background), `${generated.slug}/${mode}/${pair.foreground}/${pair.background}`)
              .toBeGreaterThanOrEqual(pair.usage === "body" ? 4.5 : 3);
            pairs++;
          }
          for (const [name, kind] of Object.entries(THEME_TOKEN_REGISTRY)) {
            const value = requiredValue(values, name);
            if (kind === "color") emittedHex(value, app);
          }
        }
      }
    }
    expect(pairs).toBe(43 * 2 * 2 * THEME_CONTRAST_PAIRS.length);
  }, 30_000);

  test("Given absent CSS mode When the palette declares one Then it is retained while ambiguous or contradictory modes are rejected", async () => {
    const original = await input();
    const source = original.source.replace(/color-scheme\s*:[^;]*;/, "");
    expect(generateThemeCanonical("light", original.palette, source).theme.default_mode).toBe("light");
    expect(() => generateThemeCanonical("light", {
      ...original.palette, display: { ...original.palette.display, appearance: "system" },
    }, source)).toThrow(BundledCanonicalGenerationError);
    expect(() => generateThemeCanonical("light", original.palette,
      original.source.replace(/color-scheme\s*:[^;]*;/, "color-scheme: dark;"))).toThrow(BundledCanonicalGenerationError);
  });

  test("Given changed production settings When generated Then the corresponding roles and exact curve precision change without changing unrelated roles", async () => {
    const original = await input();
    const before = generateThemeCanonical("light", original.palette, original.source);
    const mutations: readonly (readonly [string, string, keyof ThemeSettings & string])[] = [
      ["font-sans", '"Local Test Sans", sans-serif', "font-sans"],
      // Use a canonical binary64 spelling with 17 significant digits, not an unrepresentable decimal spelling.
      ["fs-16", "1.125rem", "font-size-body"], ["sp-4", "18.125000000000004px", "space-4"],
      ["r-pill", "3px", "radius-pill"], ["dur-base", "287.125ms", "motion-normal"],
      ["shadow-1", "1px -2px 3px 4px rgba(12, 34, 56, 0.375)", "shadow-sm"],
      ["ease-standard", "cubic-bezier(0.12345678901234567, -0.2, 0.8123456789012345, 1.2)", "motion-easing"],
    ];
    for (const [sourceName, replacement, role] of mutations) {
      const changed = generateThemeCanonical("light", original.palette,
        original.source.replace(new RegExp(`--${sourceName}\\s*:[^;]*;`), `--${sourceName}: ${replacement};`));
      expect(changed.json).not.toBe(before.json);
      expect(changed.css).not.toBe(before.css);
      expect(changed.digest).not.toBe(before.digest);
      expect(changed.theme.palette).toEqual(before.theme.palette);
      expect(changed.theme.brand_anchors).toEqual(before.theme.brand_anchors);
      for (const mode of SEMANTIC_THEME_MODES) {
        const prior = getThemeSettings(before.theme)[mode], next = getThemeSettings(changed.theme)[mode];
        expect(next[role]).not.toEqual(prior[role]);
        expect(Object.fromEntries(Object.entries(next).filter(([name]) => name !== role)))
          .toEqual(Object.fromEntries(Object.entries(prior).filter(([name]) => name !== role)));
        const expected = role === "shadow-sm" ? "1px -2px 3px 4px rgb(12 34 56 / 0.375)" :
          role === "motion-easing"
            ? `cubic-bezier(${[0.12345678901234567, -0.2, 0.8123456789012345, 1.2].join(", ")})` : replacement;
        expect(requiredValue(emittedVariables(changed.theme, changed.css, mode, false), role)).toBe(expected);
        if (role === "motion-easing") expect(next[role]).toEqual({
          type: "easing", value: { type: "cubic-bezier", points: [0.12345678901234567, -0.2, 0.8123456789012345, 1.2] },
        });
      }
    }
    expect(generateThemeCanonical("light", original.palette, original.source.replace(/\r?\n/g, "\r\n"))).toEqual(before);
  });

  test("Given changed production palette and status seeds When generated Then exact anchors and associated colour outputs follow those inputs", async () => {
    const original = await input();
    const before = generateThemeCanonical("light", original.palette, original.source);
    const brand = parseHexColor("#903c7a");
    const palette = { ...original.palette, anchors: original.palette.anchors.map(anchor =>
      anchor.id === "anchor-primary-blue" ? { ...anchor, color: brand } : anchor) };
    const after = generateThemeCanonical("light", palette, original.source);
    expect(after.theme.brand_anchors).toEqual(palette.anchors);
    expect(after.theme.modes.light.primary).not.toEqual(before.theme.modes.light.primary);
    expect(getThemeSettings(after.theme)).toEqual(getThemeSettings(before.theme));
    const status = generateThemeCanonical("light", original.palette,
      original.source.replace(/--success\s*:[^;]*;/, "--success: #204e8a;"));
    expect(status.theme.sources.status.success).toEqual(parseHexColor("#204e8a"));
    expect(status.theme.modes.light.success).not.toEqual(before.theme.modes.light.success);
    expect(status.theme.palette).toEqual(original.palette);
    const surface = generateThemeCanonical("light", {
      ...original.palette,
      scales: original.palette.scales.map(scale => scale.id === "scale-gray-50"
        ? { id: scale.id, name: scale.name, kind: "hue", hue: 120 } : scale),
    }, original.source);
    expect(surface.theme.modes.light.background).not.toEqual(before.theme.modes.light.background);
    const dark = generateThemeCanonical("light", {
      ...original.palette, display: { ...original.palette.display, appearance: "dark" },
    }, original.source.replace("color-scheme: light;", "color-scheme: dark;"));
    expect(dark.theme.default_mode).toBe("dark");
    expect(dark.skill).not.toBe(before.skill);
  });

  test("Given unsupported missing or ambiguous production values When generated Then no fallback or cascade guessing is allowed", async () => {
    const { palette, source } = await input();
    const replace = (name: string, value: string) => source.replace(new RegExp(`--${name}\\s*:[^;]*;`), `--${name}: ${value};`);
    const invalid = [
      source.replace(/--font-sans\s*:[^;]*;/, ""), source + "\n:root { --sp-4: 20px; }\n",
      source + "\n.changed { --sp-4: 20px; }\n",
      source + "\n@media (prefers-color-scheme: dark) { :root { --sp-4: 20px; } }\n",
      replace("font-sans", "var(--font-body)"), replace("font-sans", '"Escaped\\ Font", sans-serif'),
      replace("fs-32", "clamp(32px, 4vw, 56px)"), replace("sp-4", "calc(4px * 4)"),
      replace("r-8", "50%"), replace("dur-fast", "0.12s"),
      replace("shadow-1", "inset 0 1px 2px rgba(0, 0, 0, 0.1)"),
      replace("shadow-1", "0 1px 2px rgba(0, 0, 0, 0.1), 0 2px 3px rgba(0, 0, 0, 0.2)"),
      replace("success", "rgba(0, 128, 0, 0.5)"), replace("lh-normal", "1.2"),
      ...["steps(2)", "cubic-bezier(0.2, 0, 0)", "cubic-bezier(0.2, 0, 0, 1, 2)",
        "cubic-bezier(-0.1, 0, 0, 1)", "cubic-bezier(0.2, 0, 1.1, 1)", "cubic-bezier(0.2, NaN, 0, 1)"]
        .map(value => replace("ease-standard", value)),
    ];
    for (const css of invalid) {
      expect(() => generateThemeCanonical("light", palette, css)).toThrow(BundledCanonicalGenerationError);
    }
    for (const bad of [
      { ...palette, anchors: palette.anchors.filter(anchor => anchor.id !== "anchor-primary-blue") },
      { ...palette, scales: palette.scales.filter(scale => scale.id !== "scale-gray-50") },
      { ...palette, display: { ...palette.display, appearance: "dark" } },
    ]) expect(() => generateThemeCanonical("light", bad, source)).toThrow(BundledCanonicalGenerationError);
    expect(() => generateThemeCanonical("../light", palette, source)).toThrow(BundledCanonicalGenerationError);
  });

  test("Given committed authority When extending canonical history Then all prior values survive and no empty or forged triple is appended", async () => {
    const original = await input();
    const generated = generateThemeCanonical("light", original.palette, original.source);
    const prior: BundledThemeHistory = {
      themes: bundledThemeHistory.themes, retired: bundledThemeHistory.retired,
      additive: {
        light: { palette: ["a".repeat(64)], canonical: ["b".repeat(64)] },
        retired_slug: { palette: ["c".repeat(64)], canonical: ["d".repeat(64)] },
      },
    };
    const before = JSON.stringify(prior);
    const next = extendBundledCanonicalHistory(prior, [generated]);
    expect(JSON.stringify(prior)).toBe(before);
    expect(next.themes).toEqual(prior.themes);
    expect(next.retired).toEqual(prior.retired);
    expect(next.additive?.light?.palette).toEqual(prior.additive?.light?.palette);
    expect(next.additive?.light?.canonical).toEqual(["b".repeat(64), generated.digest]);
    expect(next.additive?.retired_slug).toEqual(prior.additive?.retired_slug);
    expect(extendBundledCanonicalHistory(next, [generated])).toEqual(next);
    expect(() => extendBundledCanonicalHistory(prior, [{ ...generated, json: "" }])).toThrow(BundledCanonicalGenerationError);
    expect(() => extendBundledCanonicalHistory(prior, [{ ...generated, digest: "e".repeat(64) }])).toThrow(BundledCanonicalGenerationError);
    expect(() => extendBundledCanonicalHistory(prior, [generated, generated])).toThrow(BundledCanonicalGenerationError);
  });

  test("Given only production input files When complete patches are planned and applied in a temporary fixture Then planning is read only and the next plan is empty", async () => {
    const env = await fixture();
    try {
      const first = await generateBundledCanonicalPlan(env.repository, env.committed);
      expect(first.changes).toHaveLength(43 * 3 + 1);
      for (const generated of first.themes) {
        const paths = bundledCanonicalPaths(env.repository, generated.slug);
        await expect(readdir(paths.canonical)).rejects.toMatchObject({ code: "ENOENT" });
        const production = bundledCanonicalPaths(resolveRepoRoot(), generated.slug);
        expect(await readFile(paths.source)).toEqual(await readFile(production.source));
        expect(await readFile(paths.palette)).toEqual(await readFile(production.palette));
      }
      expect(await readFile(env.history, "utf8")).toBe(`${JSON.stringify(env.committed, null, 2)}\n`);
      // Apply only to this test-owned fixture, never the production checkout.
      for (const change of first.changes) {
        const target = path.join(env.repository, ...change.relative.split("/"));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, change.after);
      }
      const second = await generateBundledCanonicalPlan(env.repository, env.committed);
      expect(second.changes).toEqual([]);
      expect(second.themes).toEqual(first.themes);
      expect(second.history).toEqual(first.history);
      expect(emitBundledCanonicalPatch(second.changes)).toBe("");
      for (const change of first.changes) {
        expect(await readFile(path.join(env.repository, ...change.relative.split("/")), "utf8")).toBe(change.after);
      }
    } finally { await rm(env.repository, { recursive: true, force: true }); }
  }, 30_000);

  test("Given unowned canonical members When planning Then unknown partial and exact but unauthorized subtrees remain untouched", async () => {
    const env = await fixture();
    try {
      const { source, palette } = await input();
      const generated = generateThemeCanonical("light", palette, source);
      const paths = bundledCanonicalPaths(env.repository, "light");
      const cases = [
        [["notes.txt", "unowned\n"]],
        [["theme.json", generated.json]],
        [["theme.json", "{}\n"], ["theme.css", ":root {}\n"], ["SKILL.md", "unowned\n"]],
        [["theme.json", generated.json], ["theme.css", generated.css], ["SKILL.md", generated.skill]],
      ];
      for (const members of cases) {
        await mkdir(paths.canonical);
        for (const member of members) {
          const [name, text] = member;
          if (!name || text === undefined) throw new BundledCanonicalGenerationError("test", "member fixture");
          await writeFile(path.join(paths.canonical, name), text);
        }
        await expect(generateBundledCanonicalPlan(env.repository, env.committed)).rejects.toBeInstanceOf(BundledCanonicalGenerationError);
        for (const member of members) {
          const [name, text] = member;
          if (!name) throw new BundledCanonicalGenerationError("test", "member fixture");
          expect(await readFile(path.join(paths.canonical, name), "utf8")).toBe(text);
        }
        await rm(paths.canonical, { recursive: true });
      }
      await mkdir(path.join(paths.canonical, "theme.json"), { recursive: true });
      await writeFile(paths.css, "unowned\n");
      await writeFile(paths.skill, "unowned\n");
      await expect(generateBundledCanonicalPlan(env.repository, env.committed)).rejects.toBeInstanceOf(BundledCanonicalGenerationError);
      expect((await stat(paths.json)).isDirectory()).toBe(true);
    } finally { await rm(env.repository, { recursive: true, force: true }); }
  }, 30_000);

  test("Given changed production files in an owned fixture When planning Then canonical changes use those files rather than cached or frozen inputs", async () => {
    const env = await fixture();
    try {
      const original = await input();
      const before = generateThemeCanonical("light", original.palette, original.source);
      const paths = bundledCanonicalPaths(env.repository, "light");
      const brand = parseHexColor("#903c7a");
      const palette = {
        ...original.palette,
        anchors: original.palette.anchors.map(anchor => anchor.id === "anchor-primary-blue" ? { ...anchor, color: brand } : anchor),
        display: { ...original.palette.display, appearance: "dark" },
      };
      const source = original.source.replace(/--sp-4\s*:[^;]*;/, "--sp-4: 19px;")
        .replace(/--success\s*:[^;]*;/, "--success: #204e8a;")
        .replace("color-scheme: light;", "color-scheme: dark;");
      await writeFile(paths.palette, `${serializePalette(parsePaletteState(palette))}\n`);
      await writeFile(paths.source, source);
      const plan = await generateBundledCanonicalPlan(env.repository, env.committed);
      const updated = plan.themes.find(theme => theme.slug === "light");
      if (!updated) throw new BundledCanonicalGenerationError("test", "updated production theme");
      expect(updated.theme.default_mode).toBe("dark");
      expect(updated.theme.brand_anchors.find(anchor => anchor.id === "anchor-primary-blue")?.color).toEqual(brand);
      expect(updated.theme.sources.status.success).toEqual(parseHexColor("#204e8a"));
      for (const mode of SEMANTIC_THEME_MODES) {
        expect(updated.theme.modes[mode]["space-4"]).toEqual({ type: "length", value: 19, unit: "px" });
        expect(requiredValue(emittedVariables(updated.theme, updated.css, mode, false), "space-4")).toBe("19px");
      }
      expect(updated.digest).not.toBe(before.digest);
      expect(plan.changes.find(change => change.relative === `${paths.relative}/canonical/theme.json`)?.after).toBe(updated.json);
      expect(plan.changes.find(change => change.relative === `${paths.relative}/canonical/theme.css`)?.after).toBe(updated.css);
      expect(plan.history.additive?.light?.canonical).toEqual([updated.digest]);
      expect(await readFile(paths.source, "utf8")).toBe(source);
      await expect(readdir(paths.canonical)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(env.repository, { recursive: true, force: true }); }
  }, 30_000);

  test("Given unpublished history or removed committed values When planning Then neither empty subtree authority nor other workers hashes are adopted", async () => {
    const env = await fixture();
    try {
      const empty = themeAdditiveDigest(new Map(), "canonical");
      const invalid: readonly BundledThemeHistory[] = [
        { ...env.committed, additive: { ...env.committed.additive, light: {
          ...env.committed.additive?.light, canonical: [empty],
        } } },
        { ...env.committed, additive: { ...env.committed.additive, light: {
          ...env.committed.additive?.light, canonical: ["f".repeat(64)],
        } } },
        { ...env.committed, themes: { ...env.committed.themes, light: ["e".repeat(64)] } },
      ];
      for (const history of invalid) {
        const text = `${JSON.stringify(history, null, 2)}\n`;
        await writeFile(env.history, text);
        await expect(generateBundledCanonicalPlan(env.repository, env.committed))
          .rejects.toMatchObject({ code: "bundled_canonical_generation", slug: "history", field: "uncommitted authority changes" });
        expect(await readFile(env.history, "utf8")).toBe(text);
      }
      for (const text of [
        JSON.stringify({ ...env.committed, extra: true }),
        JSON.stringify({ ...env.committed, additive: { light: { unknown: ["f".repeat(64)] } } }),
        JSON.stringify({ ...env.committed, themes: { light: ["not-a-digest"] } }),
      ]) {
        await writeFile(env.history, text);
        await expect(generateBundledCanonicalPlan(env.repository, env.committed))
          .rejects.toMatchObject({ code: "bundled_canonical_generation", field: "closed history schema" });
        expect(await readFile(env.history, "utf8")).toBe(text);
      }
    } finally { await rm(env.repository, { recursive: true, force: true }); }
  }, 30_000);

  test("Given a recognized committed canonical generation When production inputs change Then complete replacements preserve prior history", async () => {
    const env = await fixture();
    try {
      const { source, palette } = await input();
      const old = generateThemeCanonical("light", palette, source.replace(/--sp-4\s*:[^;]*;/, "--sp-4: 17px;"));
      const baseline = extendBundledCanonicalHistory(env.committed, [old]);
      const paths = bundledCanonicalPaths(env.repository, "light");
      await mkdir(paths.canonical);
      for (const [file, text] of [[paths.json, old.json], [paths.css, old.css], [paths.skill, old.skill]] as const) {
        await writeFile(file, text);
      }
      await writeFile(env.history, `${JSON.stringify(baseline, null, 2)}\n`);
      const plan = await generateBundledCanonicalPlan(env.repository, baseline);
      const updated = plan.themes.find(theme => theme.slug === "light");
      if (!updated) throw new BundledCanonicalGenerationError("test", "updated light theme");
      expect(plan.history.additive?.light?.canonical).toEqual([...(baseline.additive?.light?.canonical ?? []), updated.digest]);
      expect(plan.history.themes).toEqual(baseline.themes);
      expect(plan.history.retired).toEqual(baseline.retired);
      expect(plan.history.additive?.light?.palette).toEqual(baseline.additive?.light?.palette);
      expect(plan.changes.find(change => change.relative === `${paths.relative}/canonical/theme.json`))
        .toEqual({ relative: `${paths.relative}/canonical/theme.json`, before: old.json, after: updated.json });
      expect(await readFile(paths.json, "utf8")).toBe(old.json);
    } finally { await rm(env.repository, { recursive: true, force: true }); }
  }, 30_000);

  test("Given Windows and POSIX roots When canonical paths and complete-file patches are formed Then native paths never enter hash or patch identities", () => {
    for (const [flavor, root] of [[path.win32, "C:\\work\\BurnGuard"], [path.posix, "/work/BurnGuard"]] as const) {
      const paths = bundledCanonicalPaths(root, "light", flavor);
      expect(paths.json).toBe(flavor.join(root, "design system themes", "light", "canonical", "theme.json"));
      expect(paths.css).toBe(flavor.join(root, "design system themes", "light", "canonical", "theme.css"));
      expect(paths.skill).toBe(flavor.join(root, "design system themes", "light", "canonical", "SKILL.md"));
      expect(paths.palette).toBe(flavor.join(root, "design system themes", "light", "palette", "state.json"));
      expect(paths.relative).toBe("design system themes/light");
    }
    for (const slug of ["..", "../light", "..\\light", "C:\\light", "/light", "unregistered"]) {
      expect(() => bundledCanonicalPaths("/work", slug)).toThrow(BundledCanonicalGenerationError);
    }
    const relative = "design system themes/light/canonical/theme.json";
    expect(emitBundledCanonicalPatch([{ relative, before: null, after: "{}\n" }])).toBe(
      `diff --git "a/${relative}" "b/${relative}"\nnew file mode 100644\n--- /dev/null\n+++ "b/${relative}"\n@@ -0,0 +1,1 @@\n+{}\n`,
    );
    const patch = emitBundledCanonicalPatch([{ relative, before: "old", after: "new\n" }]);
    expect(patch).toContain("@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n");
    expect(themeFileHash(Buffer.from("canonical\r\n"))).toBe(themeFileHash(Buffer.from("canonical\n")));
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
