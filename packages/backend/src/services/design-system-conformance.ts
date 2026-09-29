import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { MEASURED_VIEWPORTS, parseDesignSystemMeasuredLayout, type MeasuredPageLayout, type MeasuredViewportLayout, type MeasuredViewportName } from "@bg/shared";
import { resolveWithin } from "../security/path-boundary";
import { collectLayout, REFERENCE_MEDIA_CSS, REFERENCE_VIEWPORT_HEIGHTS } from "./extraction-rendered-layout";
import { readManagedFile } from "./artifact-tree-storage";
import { layoutReferenceFromPinnedContext, stagedReferencePath } from "./design-system-layout-reference";
import { compareVisualViewport, cropSectionJpeg, VISUAL_CROP_DIR, visualRepairTargets, type VisualSectionScore, type VisualViewportReport } from "./design-system-visual-diff";
import { launchChromium, openRenderSession } from "./export-render-session";
import { registerExportBrowser } from "./export-browser-registry";

/** How a generated website page departs from the measured layout it was asked to follow. Values are px or counts. */
export type ConformanceFinding = {
  readonly code: "type_size" | "block_alignment" | "block_position" | "container" | "section_count" | "page_height" | "literal_value";
  readonly viewport: MeasuredViewportName | null;
  readonly target: string;
  readonly measured: string;
  readonly expected: string;
};
/** visual and repair_targets are report-only: per-section similarity with the reference screenshots, lowest sections first in repair_targets. */
export type ConformanceResult = { readonly page: string; readonly findings: readonly ConformanceFinding[]; readonly visual?: readonly VisualViewportReport[]; readonly repair_targets?: readonly VisualSectionScore[] };
const REPAIR_TARGET_COUNT = 3;
const VISUAL_CAPTURE_TIMEOUT_MS = 8_000;

/** Declared by generated pages so the review compares them with the measured entry they followed. */
export const MEASURED_PAGE_META = "bg-measured-page";
/** Reads the declared measured page path from a page's HTML. */
export const MEASURED_PAGE_DECLARATION = new RegExp(`<meta\\s+name=["']${MEASURED_PAGE_META}["']\\s+content=["']([^"']{1,300})["']`, "iu");
const MAX_FINDINGS = 40;
const OPEN_TAG = "<selected_design_system_measured_layout>";

/** The measured pages frozen in a project's pinned design-system context, or null when it carries none. */
export function measuredPagesFromPinnedContext(context: string): readonly MeasuredPageLayout[] | null {
  const start = context.indexOf(`${OPEN_TAG}\n`);
  if (start === -1) return null;
  const line = context.slice(start + OPEN_TAG.length + 1).split("\n", 1)[0] ?? "";
  try {
    return parseDesignSystemMeasuredLayout({ schema_version: 1, method: "rendered-offline", pages: JSON.parse(line) }).pages;
  } catch {
    return null;
  }
}

export function selectMeasuredPage(pages: readonly MeasuredPageLayout[], declaredPath: string | null): MeasuredPageLayout | null {
  return pages.find(page => page.path === declaredPath) ?? pages.find(page => page.page_type === "home") ?? pages[0] ?? null;
}

/** Pure comparison of one rendered viewport with its measured counterpart, using the tolerances the prompt states. */
export function compareMeasuredViewport(expected: MeasuredViewportLayout, actual: MeasuredViewportLayout, viewport: MeasuredViewportName): ConformanceFinding[] {
  const { width: vw, height: vh } = MEASURED_VIEWPORTS[viewport];
  const findings: ConformanceFinding[] = [];
  const push = (code: ConformanceFinding["code"], target: string, measured: string | number, wanted: string | number) => { findings.push({ code, viewport, target, measured: String(measured), expected: String(wanted) }); };
  for (const [role, size] of Object.entries(expected.type_scale)) {
    const got = actual.type_scale[role as keyof typeof actual.type_scale];
    if (got === undefined) push("type_size", role, "missing", `${size}px`);
    else if (Math.abs(got - size) > 2) push("type_size", role, `${got}px`, `${size}px +/-2px`);
  }
  for (const [name, box] of Object.entries(expected.blocks)) {
    const got = actual.blocks[name as keyof typeof actual.blocks];
    if (got === undefined) { push("block_position", name, "missing", `x ${box.x}px, y ${box.y}px, width ${box.width}px`); continue; }
    if (got.align !== box.align) push("block_alignment", name, got.align, box.align);
    const off = [["x", got.x, box.x, vw], ["y", got.y, box.y, vh], ["width", got.width, box.width, vw]] as const;
    for (const [axis, value, wanted, span] of off) if (Math.abs(value - wanted) > span * 0.05) push("block_position", `${name}.${axis}`, `${value}px`, `${wanted}px +/-${Math.round(span * 0.05)}px`);
  }
  if (expected.container !== null) {
    const got = actual.container;
    if (got === null) push("container", "container", "missing", `left ${expected.container.left}px, width ${expected.container.width}px`);
    else if (Math.abs(got.width - expected.container.width) > vw * 0.05 || Math.abs(got.left - expected.container.left) > vw * 0.05) push("container", "container", `left ${got.left}px, width ${got.width}px`, `left ${expected.container.left}px, width ${expected.container.width}px +/-${Math.round(vw * 0.05)}px`);
  }
  if (Math.abs(actual.sections.length - expected.sections.length) > 1) push("section_count", "sections", actual.sections.length, `${expected.sections.length} +/-1`);
  const ratio = actual.page_height / Math.max(1, expected.page_height);
  if (ratio < 0.8 || ratio > 1.25) push("page_height", "page", `${actual.page_height}px`, `${expected.page_height}px (80-125%)`);
  return findings;
}

const LITERAL_PROPERTIES = /^(?:color|background|background-color|border(?:-(?:top|right|bottom|left))?-color|fill|stroke|font-size|font-family)$/iu;
const ALLOWED_VALUE = /^(?:inherit|initial|unset|revert|none|transparent|currentcolor|0|auto|normal)$/iu;

/**
 * Colour, font-size and font-family declarations in authored CSS whose value is a literal instead of a
 * design-system variable. Custom property definitions are the place literals belong, so they are skipped.
 * One finding per property, counting occurrences and naming up to three examples.
 */
export function literalValueFindings(cssTexts: readonly string[]): ConformanceFinding[] {
  const hits = new Map<string, { count: number; examples: string[] }>();
  for (const css of cssTexts) {
    const body = css.replace(/\/\*[\s\S]*?\*\//gu, "");
    for (const match of body.matchAll(/(?:^|[{;\s])([a-z-]+)\s*:\s*([^;{}]+)/giu)) {
      const property = match[1]!.toLowerCase();
      const value = match[2]!.trim().replace(/\s*!important$/iu, "");
      if (property.startsWith("--") || !LITERAL_PROPERTIES.test(property) || value === "" || ALLOWED_VALUE.test(value) || /\bvar\(/iu.test(value)) continue;
      // A background shorthand is only a colour literal when it carries a colour value.
      if (property === "background" && !/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch|oklab|lab|lch|color)a?\(/iu.test(value)) continue;
      const entry = hits.get(property) ?? { count: 0, examples: [] };
      entry.count += 1;
      if (entry.examples.length < 3 && !entry.examples.includes(value.slice(0, 60))) entry.examples.push(value.slice(0, 60));
      hits.set(property, entry);
    }
  }
  return [...hits].sort((a, b) => b[1].count - a[1].count).map(([property, hit]) => ({ code: "literal_value", viewport: null, target: property, measured: `${hit.count} literal value(s), e.g. ${hit.examples.join(" | ")}`, expected: "var(--...) from the design-system tokens" }));
}

/** Authored CSS in the files this turn changed: stylesheets plus inline style blocks of HTML pages, bounded. */
async function changedCss(projectDir: string, changedPaths: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  let budget = 2_000_000;
  for (const relPath of changedPaths.filter(file => /\.(?:css|html?)$/iu.test(file)).slice(0, 200)) {
    if (budget <= 0) break;
    const info = await lstat(resolveWithin(projectDir, relPath)).catch(() => null);
    if (info === null || !info.isFile()) continue;
    const text = (await readFile(resolveWithin(projectDir, relPath), "utf8")).slice(0, budget);
    budget -= text.length;
    if (/\.css$/iu.test(relPath)) out.push(text);
    else for (const block of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/giu)) out.push(block[1]!);
  }
  return out;
}

/** The pinned reference screenshot staged in the project for a page and viewport, only while it still matches its pin. */
async function stagedReference(projectDir: string, pinnedContext: string, pagePath: string, viewport: MeasuredViewportName): Promise<Uint8Array | null> {
  const shot = layoutReferenceFromPinnedContext(pinnedContext).find(item => item.path === pagePath && item.viewport === viewport);
  if (shot === undefined) return null;
  return readManagedFile(projectDir, { path: stagedReferencePath(shot), size: shot.size, sha256: shot.sha256 }).catch(() => null);
}

/** Crops each repair target from the source screenshot and the current render into the project's unpublished inputs; a target whose crops cannot be written is returned without them. */
async function withSectionCrops(projectDir: string, targets: readonly VisualSectionScore[], images: ReadonlyMap<MeasuredViewportName, { readonly reference: Uint8Array; readonly generated: Uint8Array; readonly expected: MeasuredViewportLayout }>, signal: AbortSignal): Promise<VisualSectionScore[]> {
  const out: VisualSectionScore[] = [];
  for (const target of targets) {
    const view = images.get(target.viewport);
    const section = view?.expected.sections[target.section];
    if (view === undefined || section === undefined) { out.push(target); continue; }
    const [reference, generated] = await Promise.all([cropSectionJpeg(view.reference, section.top, section.height), cropSectionJpeg(view.generated, section.top, section.height)]);
    if (reference === null) { out.push(target); continue; }
    const base = `${VISUAL_CROP_DIR}/${target.viewport}-s${target.section}`;
    try {
      await mkdir(resolveWithin(projectDir, ...VISUAL_CROP_DIR.split("/")), { recursive: true });
      await writeFile(resolveWithin(projectDir, ...`${base}-reference.jpg`.split("/")), reference);
      if (generated !== null) await writeFile(resolveWithin(projectDir, ...`${base}-generated.jpg`.split("/")), generated);
    } catch {
      signal.throwIfAborted();
      out.push(target);
      continue;
    }
    out.push({ ...target, crop: { reference: `${base}-reference.jpg`, ...(generated === null ? {} : { generated: `${base}-generated.jpg` }) } });
  }
  return out;
}

/**
 * Renders the entrypoint at the measured viewports and compares it with the measured entry it followed, plus
 * the literal-value check over authored CSS. Returns null when there is nothing measured to compare with.
 */
export async function reviewDesignSystemConformance(input: { readonly projectDir: string; readonly entrypoint: string; readonly pinnedContext: string; readonly changedPaths: readonly string[]; readonly signal: AbortSignal }): Promise<ConformanceResult | null> {
  // Only the entrypoint is rendered, so a turn that did not change it has nothing new to compare.
  if (!input.changedPaths.includes(input.entrypoint)) return null;
  const pages = measuredPagesFromPinnedContext(input.pinnedContext);
  if (pages === null || pages.length === 0) return null;
  const html = await readFile(resolveWithin(input.projectDir, input.entrypoint), "utf8");
  const declared = MEASURED_PAGE_DECLARATION.exec(html)?.[1] ?? null;
  const expected = selectMeasuredPage(pages, declared);
  if (expected === null) return null;
  const findings: ConformanceFinding[] = [];
  const visual: VisualViewportReport[] = [];
  const images = new Map<MeasuredViewportName, { reference: Uint8Array; generated: Uint8Array; expected: MeasuredViewportLayout }>();
  const browser = await launchChromium(input.signal);
  const owner = registerExportBrowser(() => browser.close());
  try {
    for (const name of Object.keys(MEASURED_VIEWPORTS) as MeasuredViewportName[]) {
      const size = MEASURED_VIEWPORTS[name];
      const session = await openRenderSession({ stagedDir: input.projectDir, entrypoint: input.entrypoint, viewport: { width: size.width, height: size.height, dpr: 1 }, deck: false, strict: false, signal: input.signal, browser });
      try {
        const actual = await session.page.evaluate(collectLayout, { width: size.width, height: size.height, maxSections: 16 });
        findings.push(...compareMeasuredViewport(expected.viewports[name], actual, name));
        const reference = await stagedReference(input.projectDir, input.pinnedContext, expected.path, name);
        if (reference !== null) {
          try {
            await session.page.addStyleTag({ content: REFERENCE_MEDIA_CSS });
            const height = Math.max(size.height, Math.min(actual.page_height, size.height * REFERENCE_VIEWPORT_HEIGHTS));
            const generated = await session.page.screenshot({ type: "png", fullPage: true, animations: "disabled", timeout: VISUAL_CAPTURE_TIMEOUT_MS, clip: { x: 0, y: 0, width: size.width, height } });
            const generatedBytes = new Uint8Array(generated);
            visual.push(await compareVisualViewport({ viewport: name, reference, generated: generatedBytes, expected: expected.viewports[name], actual }));
            images.set(name, { reference, generated: generatedBytes, expected: expected.viewports[name] });
          } catch (error) {
            input.signal.throwIfAborted();
            visual.push({ viewport: name, unavailable: true, sections: [] });
          }
        }
      } finally { await session.close(); }
    }
  } finally { await owner.close(); }
  findings.push(...literalValueFindings(await changedCss(input.projectDir, input.changedPaths)));
  return { page: expected.path, findings: findings.slice(0, MAX_FINDINGS), ...(visual.length > 0 ? { visual, repair_targets: await withSectionCrops(input.projectDir, visualRepairTargets(visual, REPAIR_TARGET_COUNT), images, input.signal) } : {}) };
}
