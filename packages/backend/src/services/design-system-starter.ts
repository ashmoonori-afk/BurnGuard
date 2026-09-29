import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { MeasuredBox, MeasuredPageLayout, MeasuredViewportLayout, MeasuredViewportName } from "@bg/shared";
import { resolveWithin } from "../security/path-boundary";
import { readableRole } from "./design-system-contrast";
import { measuredPagesFromPinnedContext, selectMeasuredPage } from "./design-system-conformance";
import { heroAssetsFromPinnedContext, layoutReferenceFromPinnedContext, STAGED_REFERENCE_DIR, stagedReferencePath } from "./design-system-layout-reference";

/** First line of every generated starter stylesheet; a file without it was written by someone else and is never replaced. */
export const STARTER_MARKER = "/* burnguard-design-system-starter v1 */";
export const STARTER_CSS_PATH = "design-system/system.css";
export const STARTER_SKELETON_DIR = ".burnguard-inputs/design-system-starter";
/** Paths that are safe inside a CSS attribute selector and a file name; other measured pages keep the home values. */
const SAFE_PATH = /^\/[A-Za-z0-9._~\/-]{0,120}$/u;

export type HeroArrangement = "centered" | "split" | "media-behind" | "text-only";

const overlaps = (a: MeasuredBox, b: MeasuredBox): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export function heroArrangement(desktop: MeasuredViewportLayout): HeroArrangement {
  const { hero_heading: heading, media } = desktop.blocks;
  if (heading === undefined) return "text-only";
  if (media !== undefined && overlaps(media, heading)) return "media-behind";
  if (heading.align === "center") return "centered";
  if (media !== undefined && Math.abs(media.y - heading.y) < desktop.viewport.height * 0.5) return "split";
  return "text-only";
}

const px = (value: number | null | undefined, fallback: string): string => value === null || value === undefined ? fallback : `${value}px`;

function measuredProperties(layout: MeasuredViewportLayout): string[] {
  const type = layout.type_scale;
  const heading = layout.blocks.hero_heading;
  return [
    `--m-container: ${px(layout.container?.width, "var(--layout-max, 1200px)")};`,
    `--m-gutter: ${px(layout.gutter, "var(--layout-gutter, 24px)")};`,
    // Very large measured gaps usually include decorative bands; the rhythm is capped so empty space never dominates.
    `--m-section-gap: ${px(layout.section_gap === null ? null : Math.min(layout.section_gap, 200), "var(--layout-section-y, 96px)")};`,
    `--m-hero-width: ${px(heading?.width, "var(--layout-measure, 60ch)")};`,
    `--m-type-hero: ${px(type.hero, "var(--fs-64, 64px)")};`,
    `--m-type-subheading: ${px(type.subheading, "var(--fs-24, 24px)")};`,
    `--m-type-cta: ${px(type.cta, "var(--fs-16, 16px)")};`,
    `--m-type-h2: ${px(type.h2, "var(--fs-40, 40px)")};`,
    `--m-type-h3: ${px(type.h3, "var(--fs-24, 24px)")};`,
    `--m-type-body: ${px(type.body, "var(--fs-16, 16px)")};`,
    `--m-type-nav: ${px(type.nav, "var(--fs-16, 16px)")};`,
  ];
}

const HERO_RULES = [
  ".bg-hero { display: grid; gap: var(--m-gutter); }",
  ".bg-hero--centered { justify-items: center; text-align: center; }",
  ".bg-hero--split { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: center; }",
  ".bg-hero--media-behind { position: relative; justify-items: center; text-align: center; isolation: isolate; }",
  ".bg-hero--media-behind .bg-hero__media { position: absolute; inset: 0; z-index: -1; display: grid; place-items: center; overflow: hidden; }",
  ".bg-hero__media img { max-width: 100%; height: auto; }",
].join("\n");

/** The md breakpoint the tokens declare, else 810px. */
export function starterBreakpoint(tokensCss: string): number {
  const value = /--layout-bp-md\s*:\s*(\d{3,4})px/u.exec(tokensCss)?.[1];
  return value === undefined ? 810 : Number(value);
}

function measuredBlock(selector: string, page: MeasuredPageLayout, breakpointPx: number): string[] {
  const { desktop, mobile } = page.viewports;
  return [
    `${selector} {\n  ${measuredProperties(desktop).join("\n  ")}\n}`,
    `@media (max-width: ${breakpointPx - 0.02}px) {\n  ${selector} {\n    ${measuredProperties(mobile).join("\n    ")}\n  }\n}`,
  ];
}

/** Text roles the class API uses, each resolved to a token that reads at 4.5:1 on the system's own background or brand colour. */
function readableRoleProperties(tokensCss: string): string {
  const subtitle = readableRole(tokensCss, ["--fg-2", "--fg-1"], ["--bg"]);
  const footer = readableRole(tokensCss, ["--fg-3", "--fg-2", "--fg-1"], ["--bg"]);
  const onBrand = readableRole(tokensCss, ["--fg-on-brand", "--fg-1", "--bg"], ["--brand-primary", "--primary-blue"]);
  return `:root {\n  --m-fg-subtitle: var(${subtitle});\n  --m-fg-footer: var(${footer});\n  --m-fg-on-brand: var(${onBrand});\n}`;
}

/**
 * The starter stylesheet for a website built with an extracted system: the pinned tokens, the measured values
 * as --m-* properties (home at :root, other measured pages selected by the page's bg-measured-page meta, mobile
 * values below the md breakpoint) and a small class API whose every colour, font and size is a variable.
 * Deterministic: the same inputs always produce the same bytes.
 */
export function buildStarterCss(tokensCss: string, pages: readonly MeasuredPageLayout[]): string {
  const home = selectMeasuredPage(pages, null);
  if (home === null) return "";
  const breakpointPx = starterBreakpoint(tokensCss);
  const others = pages.filter(page => page !== home && SAFE_PATH.test(page.path));
  return [
    STARTER_MARKER,
    "/* Generated from the pinned design system and its measured pages. Link it before page CSS and do not edit it. */",
    tokensCss.trim(),
    readableRoleProperties(tokensCss),
    ...measuredBlock(":root", home, breakpointPx),
    ...others.flatMap(page => measuredBlock(`:root:has(meta[name="bg-measured-page"][content="${page.path}"])`, page, breakpointPx)),
    "*, *::before, *::after { box-sizing: border-box; }",
    ".bg-page { margin: 0; background: var(--bg); color: var(--fg-1); font-family: var(--font-sans); font-size: var(--m-type-body); line-height: var(--lh-normal, 1.5); }",
    ".bg-container { width: min(100% - 2 * var(--m-gutter), var(--m-container)); margin-inline: auto; }",
    ".bg-nav { display: flex; align-items: center; justify-content: space-between; gap: var(--m-gutter); }",
    ".bg-nav a { font-size: var(--m-type-nav); color: inherit; text-decoration: none; }",
    HERO_RULES,
    ".bg-hero__title { font-family: var(--font-display, var(--font-sans)); font-size: var(--m-type-hero); line-height: var(--lh-tight, 1.1); max-width: var(--m-hero-width); margin: 0; }",
    ".bg-hero__subtitle { font-size: var(--m-type-subheading); color: var(--m-fg-subtitle); max-width: var(--m-hero-width); margin: 0; }",
    ".bg-button { display: inline-flex; align-items: center; justify-content: center; font-size: var(--m-type-cta); padding: 0.6em 1.2em; border-radius: var(--r-pill, 999px); border: 1px solid transparent; background: var(--brand-primary, var(--primary-blue)); color: var(--m-fg-on-brand); text-decoration: none; }",
    ".bg-button--secondary { background: transparent; border-color: var(--border-strong); color: var(--fg-1); }",
    ".bg-section { padding-block: calc(var(--m-section-gap) / 2); }",
    ".bg-section__title { font-family: var(--font-display, var(--font-sans)); font-size: var(--m-type-h2); line-height: var(--lh-tight, 1.15); margin: 0 0 var(--m-gutter); }",
    ".bg-grid { display: grid; gap: var(--m-gutter); grid-template-columns: repeat(var(--bg-columns, 3), minmax(0, 1fr)); }",
    ".bg-card { background: var(--surface); color: var(--fg-1); border: 1px solid var(--border); border-radius: var(--r-8, 8px); padding: var(--m-gutter); }",
    ".bg-card__title { font-size: var(--m-type-h3); margin: 0 0 0.5em; }",
    ".bg-footer { border-top: 1px solid var(--border); padding-block: var(--m-gutter); color: var(--m-fg-footer); }",
    `@media (max-width: ${breakpointPx - 0.02}px) {\n  .bg-hero { grid-template-columns: minmax(0, 1fr); }\n  .bg-grid { grid-template-columns: minmax(0, 1fr); }\n}`,
    "",
  ].join("\n\n");
}

/** A skeleton page in the measured section order using the class API; a reference for the model, never published. */
export function buildStarterHtml(page: MeasuredPageLayout, heroMedia?: string): string {
  const { desktop } = page.viewports;
  const hero = heroArrangement(desktop);
  const sections = desktop.sections.slice(1).map((section, index) => `  <section class="bg-section" data-measured-section="${index + 1}" data-bg-placeholder>\n    <div class="bg-container">\n      <h2 class="bg-section__title">SECTION TITLE</h2>\n      <div class="bg-grid" style="--bg-columns: ${Math.max(1, Math.min(section.columns, 6))}">\n        <article class="bg-card"><h3 class="bg-card__title">ITEM</h3><p>ITEM TEXT</p></article>\n      </div>\n    </div>\n  </section>`);
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <meta name="bg-measured-page" content="${page.path}">`,
    `  <link rel="stylesheet" href="${STARTER_CSS_PATH}">`,
    "</head>",
    '<body class="bg-page">',
    '  <header class="bg-container bg-nav" data-bg-placeholder><a href="index.html">LOGO</a><nav><a href="index.html">LINK</a></nav></header>',
    `  <section class="bg-hero bg-hero--${hero} bg-container" data-bg-placeholder>`,
    heroMedia === undefined ? '    <div class="bg-hero__media">HERO MEDIA (reuse assets/hero files when the system lists them)</div>' : `    <div class="bg-hero__media"><img src="${heroMedia}" alt=""></div>`,
    '    <h1 class="bg-hero__title">HEADLINE</h1>',
    '    <p class="bg-hero__subtitle">SUBHEADING</p>',
    '    <a class="bg-button" href="#">CALL TO ACTION</a>',
    "  </section>",
    ...sections,
    '  <footer class="bg-footer" data-bg-placeholder><div class="bg-container">FOOTER</div></footer>',
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** reference lists the staged screenshots of the source page by viewport, when the pin carries any. */
export type StarterPlanPage = { readonly path: string; readonly hero: HeroArrangement; readonly skeleton: string; readonly hero_media?: string; readonly reference?: Readonly<Partial<Record<MeasuredViewportName, string>>>; readonly wireframe?: Readonly<Partial<Record<MeasuredViewportName, string>>> };
export type StarterPlan = { readonly stylesheet: string; readonly pages: readonly StarterPlanPage[] };

const skeletonName = (pagePath: string): string => pagePath === "/" ? "home.html" : `${pagePath.slice(1).replace(/[^A-Za-z0-9._-]+/gu, "_").slice(0, 80)}.html`;

/** What the starter provides for a pinned context, or null when the pin carries no measured pages. */
export function starterPlan(pinnedContext: string): StarterPlan | null {
  const pages = (measuredPagesFromPinnedContext(pinnedContext) ?? []).filter(page => SAFE_PATH.test(page.path));
  if (pages.length === 0) return null;
  const shots = layoutReferenceFromPinnedContext(pinnedContext);
  const heroImage = heroAssetsFromPinnedContext(pinnedContext)[0]?.file;
  return { stylesheet: STARTER_CSS_PATH, pages: pages.map(page => {
    const reference = Object.fromEntries(shots.filter(shot => shot.path === page.path).map(shot => [shot.viewport, stagedReferencePath(shot)]));
    const wireframe = Object.fromEntries(shots.filter(shot => shot.path === page.path && shot.wireframe).map(shot => [shot.viewport, `${STAGED_REFERENCE_DIR}/${path.posix.basename(shot.wireframe!.file)}`]));
    const hero = heroArrangement(page.viewports.desktop);
    return { path: page.path, hero, ...(heroImage !== undefined && (hero === "media-behind" || hero === "split") ? { hero_media: heroImage } : {}), skeleton: `${STARTER_SKELETON_DIR}/${skeletonName(page.path)}`, ...(Object.keys(reference).length > 0 ? { reference } : {}), ...(Object.keys(wireframe).length > 0 ? { wireframe } : {}) };
  }) };
}

/**
 * Makes the home skeleton the entrypoint of a fresh project (no file, or an empty one) so the model edits the class-based
 * page instead of writing one from scratch. Every skeleton block carries data-bg-placeholder, so a page the turn left
 * untouched never counts as generated content. Returns whether it seeded; a root-level entrypoint only.
 */
export async function seedStarterEntrypoint(stageDir: string, pinnedContext: string, entrypoint: string): Promise<boolean> {
  if (entrypoint.includes("/")) return false;
  const plan = starterPlan(pinnedContext);
  const pages = (measuredPagesFromPinnedContext(pinnedContext) ?? []).filter(page => SAFE_PATH.test(page.path));
  const home = selectMeasuredPage(pages, null);
  if (plan === null || home === null) return false;
  const file = resolveWithin(stageDir, entrypoint);
  const existing = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (existing !== null && existing.trim() !== "") return false;
  await writeFile(file, buildStarterHtml(home, plan.pages[pages.indexOf(home)]?.hero_media), "utf8");
  return true;
}

/**
 * Writes the starter into a prepared stage: the stylesheet into the published tree unless a file there was not
 * written by the starter, and one skeleton per measured page into the unpublished inputs directory.
 */
export async function provisionDesignSystemStarter(stageDir: string, pin: { readonly context: string; readonly tokens: string }): Promise<StarterPlan | null> {
  const plan = starterPlan(pin.context);
  if (plan === null) return null;
  const pages = (measuredPagesFromPinnedContext(pin.context) ?? []).filter(page => SAFE_PATH.test(page.path));
  const cssPath = resolveWithin(stageDir, ...STARTER_CSS_PATH.split("/"));
  const existing = await readFile(cssPath, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (existing === null || existing.startsWith(STARTER_MARKER)) {
    await mkdir(resolveWithin(stageDir, STARTER_CSS_PATH.split("/")[0]!), { recursive: true });
    await writeFile(cssPath, buildStarterCss(pin.tokens, pages), "utf8");
  }
  await mkdir(resolveWithin(stageDir, ...STARTER_SKELETON_DIR.split("/")), { recursive: true });
  for (const [index, page] of pages.entries()) await writeFile(resolveWithin(stageDir, ...plan.pages[index]!.skeleton.split("/")), buildStarterHtml(page, plan.pages[index]!.hero_media), "utf8");
  return plan;
}
