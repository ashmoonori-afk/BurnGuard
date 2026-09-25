import { expect, test } from "bun:test";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { bundledFontFiles, bundledFontUrl, copyBundledFonts } from "../src/data/bundled-fonts";
import { createProjectRecord } from "../src/db/seed";
import { PROTOTYPE_TUTORIAL_NAME, seedTutorialsOnce } from "../src/db/seed-tutorials";
import { appRootDir, resolveRepoRoot } from "../src/lib/paths";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { getSqlite } from "../src/db/client";
import { DECK_STAGE_JS } from "../src/runtime/deck-stage";
import { isRuntimeSource } from "../../../scripts/package-runtime";
import { createApp } from "../src/server";
import { prepareBundledFontExport } from "../src/services/export-stage";
import { resolveStaticClosure } from "../src/services/export-closure";
import { isPublicAsset } from "../src/services/vercel-publish";

test("Given shared fonts When two projects load and one exports Then storage is shared, immutable public URLs are exact, and the export is self-contained", async () => {
  const roots = ["shared-font-one", "shared-font-two"].map(name => path.join(appRootDir, name));
  const bundle = await bundledFontFiles();
  const font = [...bundle.values()].find(file => file.name.endsWith(".woff2"))!;
  await Promise.all(roots.map(root => copyBundledFonts(root)));
  const app = createApp();
  const response = await app.request(bundledFontUrl(font));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(Buffer.from(await response.arrayBuffer()).equals(font.bytes)).toBe(true);
  for (const url of [bundledFontUrl(font).replace(font.sha256, "0".repeat(64)), `/runtime/fonts/${font.sha256}/fonts.css`, `/runtime/fonts/${font.sha256}/unknown.woff2`]) expect((await app.request(url)).status).toBe(404);
  for (const root of roots) expect((await readdir(path.join(root, "fonts"))).filter(name => name.endsWith(".woff2"))).toEqual([]);
  const exported = roots[0]!;
  // Exports ship only the families a document names, so the fixture names the probed face and Pretendard.
  const family = (JSON.parse(bundle.get("manifest.json")!.bytes.toString("utf8")) as { readonly families: readonly BundledFontEntry[] }).families.find(entry => entry.file === font.name)!.family;
  await writeFile(path.join(exported, "index.html"), `<!doctype html><html><head><link rel="stylesheet" href="fonts/fonts.css"></head><body style="font-family:'${family}',Pretendard">Font export</body></html>`);
  await prepareBundledFontExport(exported);
  expect(await readFile(path.join(exported, "fonts/fonts.css"), "utf8")).not.toContain("/runtime/fonts/");
  const closure = await resolveStaticClosure(exported, "index.html", await inspectCanonicalTree(exported));
  expect(closure.referenced_paths).toContain(`fonts/bundled/${font.sha256}-${font.name}`);
  expect((await readFile(path.join(exported, `fonts/bundled/${font.sha256}-${font.name}`))).equals(font.bytes)).toBe(true);
  expect(await readFile(path.join(exported, "fonts/bundled/Pretendard-OFL.txt"), "utf8")).toContain("SIL OPEN FONT LICENSE");
  expect(isPublicAsset("fonts/bundled/Pretendard-OFL.txt")).toBe(true);
  expect((await readdir(path.join(roots[1]!, "fonts"))).filter(name => name.endsWith(".woff2"))).toEqual([]);
});

test("Given a staged project whose CSS names four bundled families, one only through a custom property, When prepareBundledFontExport runs Then only those faces and their licenses ship and the static closure still passes", async () => {
  // Given
  const root = path.join(appRootDir, `font-prune-${process.pid}`);
  await copyBundledFonts(root);
  await mkdir(path.join(root, "styles"), { recursive: true });
  await writeFile(path.join(root, "index.html"), '<!doctype html><html><head><link rel="stylesheet" href="fonts/fonts.css"><link rel="stylesheet" href="styles/site.css"></head><body><h1>Launch</h1><code>npm i</code></body></html>');
  await writeFile(path.join(root, "styles/site.css"), ":root{--display:'Space Grotesk',sans-serif}body{font-family:\"DM Sans\",'Pretendard',sans-serif}h1{font-family:var(--display)}code{font-family:'IBM Plex Mono',monospace}");
  try {
    // When
    await prepareBundledFontExport(root);
    // Then
    const shipped = await readdir(path.join(root, "fonts/bundled"));
    expect(shipped.filter(name => name.endsWith(".woff2")).map(name => name.replace(/^[a-f0-9]{64}-/, "")).sort()).toEqual(["DMSans.woff2", "IBMPlexMono.woff2", "PretendardVariable.woff2", "SpaceGrotesk.woff2"]);
    expect(shipped.filter(name => name.endsWith("-OFL.txt")).sort()).toEqual(["DMSans-OFL.txt", "IBMPlexMono-OFL.txt", "Pretendard-OFL.txt", "SpaceGrotesk-OFL.txt"]);
    const css = await readFile(path.join(root, "fonts/fonts.css"), "utf8");
    expect(css.match(/@font-face/g)?.length).toBe(4);
    expect(css).not.toContain("/runtime/fonts/");
    const closure = await resolveStaticClosure(root, "index.html", await inspectCanonicalTree(root));
    expect(closure.referenced_paths.filter(name => name.startsWith("fonts/bundled/"))).toHaveLength(4);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given bundled local fonts, when initializing projects and copying over brand assets, then font bytes are durable and supplied files survive", async () => {
  const bundle = await bundledFontFiles();
  expect(await bundledFontFiles()).toBe(bundle);
  for (const type of ["prototype", "graphic", "slide_deck"] as const) {
    const project = await createProjectRecord({ name: "Font starter", type, designSystemId: null, backendId: "codex", optionsJson: type === "graphic" ? JSON.stringify({ graphic_canvas: { schema_version: 1, width: 1080, height: 1350 } }) : null, entrypoint: type === "slide_deck" ? "deck.html" : "index.html", thumbnailPath: null });
    const css = await readFile(path.join(project.dir_path, "fonts/fonts.css"), "utf8");
    for (const file of bundle.values()) if (file.name.endsWith(".woff2")) expect(css).toContain(bundledFontUrl(file));
    expect((await readdir(path.join(project.dir_path, "fonts"))).some(name => name.endsWith(".woff2"))).toBe(false);
    expect(await readFile(path.join(project.dir_path, "liquid-glass/liquid-glass.js"), "utf8"))
      .toBe(await readFile(path.join(resolveRepoRoot(), "assets/liquid-glass/liquid-glass.js"), "utf8"));
    expect(await readFile(path.join(project.dir_path, project.entrypoint), "utf8")).toContain('href="fonts/fonts.css"');
    if (type === "slide_deck") {
      expect(await readFile(path.join(project.dir_path, "runtime/deck-stage.js"), "utf8")).toBe(DECK_STAGE_JS);
      expect(await readFile(path.join(project.dir_path, project.entrypoint), "utf8")).toContain('src="runtime/deck-stage.js" defer');
    }
    const row = getSqlite().prepare("SELECT current_digest FROM projects WHERE id=?").get(project.id) as { current_digest: string };
    expect((await inspectCanonicalTree(project.dir_path)).tree_digest).toBe(row.current_digest);
  }
  const branded = path.join(appRootDir, "brand-copy-test");
  await mkdir(path.join(branded, "fonts"), { recursive: true });
  await writeFile(path.join(branded, "fonts/fonts.css"), "existing brand CSS");
  await copyBundledFonts(branded);
  expect(await readFile(path.join(branded, "fonts/fonts.css"), "utf8")).toBe("existing brand CSS");
  expect(bundle.get("Pretendard-OFL.txt")!.bytes.toString("utf8")).toContain("SIL OPEN FONT LICENSE");
  expect(isRuntimeSource("assets/fonts/fonts.css")).toBe(true);
  expect(isRuntimeSource("assets/fonts/../../secret")).toBe(false);
});

interface BundledFontEntry {
  readonly family: string;
  readonly file: string;
  readonly weight: string;
  readonly category: string;
  readonly source: string;
  readonly licenseFile: string;
  readonly bytes: number;
  readonly glyphCount: number;
  readonly hangulSyllables: number;
}

const MIN_BUNDLED_FAMILIES = 72;
// Font binaries live once in the shared store; keep the installed WOFF2 payload deliberate.
const MAX_BUNDLE_BYTES = 22 * 1024 * 1024;
const LICENSE_MARKERS = /SIL OPEN FONT LICENSE|Apache License|UBUNTU FONT LICENCE/;
const TRUSTED_SOURCE = /^https:\/\/(raw\.githubusercontent\.com|github\.com|seed\.line\.me|hangeul\.naver\.com|corp\.gmarket\.com|img\.cafe24\.com)\//;

test("Given the bundled font catalog, when manifest, fonts.css, files, licenses and fonts.md are cross-checked, then every family is consistent, licensed and documented", async () => {
  const root = path.join(resolveRepoRoot(), "assets/fonts");
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as { readonly families: readonly BundledFontEntry[] };
  const css = await readFile(path.join(root, "fonts.css"), "utf8");
  const catalog = await readFile(path.join(root, "fonts.md"), "utf8");
  const families = manifest.families;
  expect(families.length).toBeGreaterThanOrEqual(MIN_BUNDLED_FAMILIES);
  expect(css.match(/@font-face/g)?.length ?? 0).toBe(families.length);
  expect(new Set(families.map((entry) => entry.family)).size).toBe(families.length);
  expect(new Set(families.map((entry) => entry.file)).size).toBe(families.length);
  let bundleBytes = 0;
  for (const entry of families) {
    expect(css).toContain(`font-family: '${entry.family}'`);
    expect(css).toContain(`url('./${entry.file}')`);
    expect(css).toContain(`font-weight: ${entry.weight};`);
    expect(entry.file.endsWith(".woff2")).toBe(true);
    const fontBytes = (await stat(path.join(root, entry.file))).size;
    expect(fontBytes).toBe(entry.bytes);
    expect(entry.glyphCount).toBeGreaterThan(0);
    expect(entry.hangulSyllables).toBeGreaterThanOrEqual(0);
    expect(entry.hangulSyllables).toBeLessThanOrEqual(11_172);
    bundleBytes += fontBytes;
    expect(LICENSE_MARKERS.test(await readFile(path.join(root, entry.licenseFile), "utf8"))).toBe(true);
    expect(TRUSTED_SOURCE.test(entry.source)).toBe(true);
    expect(catalog).toContain(`### ${entry.family}`);
  }
  expect(bundleBytes).toBeLessThanOrEqual(MAX_BUNDLE_BYTES);
});

test("Given an existing tutorial project When startup seeding runs again Then its live files are not mutated", async () => {
  await seedTutorialsOnce();
  const project = getSqlite().query<{ readonly dirPath: string }, [string]>("SELECT dir_path dirPath FROM projects WHERE name=?").get(PROTOTYPE_TUTORIAL_NAME);
  if (project === null) throw new Error("tutorial fixture was not seeded");
  const missingFont = path.join(project.dirPath, "fonts", "fonts.md");
  await rm(missingFont);

  await seedTutorialsOnce();

  await expect(readFile(missingFont)).rejects.toThrow();
});
