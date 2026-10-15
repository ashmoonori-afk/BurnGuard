import path from "node:path";
import {
  PRINT_PPI_STRONG_WARN,
  PRINT_PPI_WARN,
  type PrintImageSeverity,
  type PrintPreflightFont,
  type PrintPreflightImage,
  type PrintPreflightPage,
} from "@bg/shared/print-preflight";

/** CSS pixels are 1/96 inch. */
const CSS_PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;
const LICENSE_FILE = /^(?:licen[cs]e|ofl|copying)/iu;

export type PathFlavor = typeof path.posix;
export type PageMeasurement = { readonly name: string; readonly width: number; readonly height: number };
/** One raster placement as laid out in the browser: displayed box, and the share of the source that stays visible after crop. */
export type ImageMeasurement = {
  readonly pageIndex: number;
  readonly locator: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly visibleWidthFraction: number;
  readonly visibleHeightFraction: number;
};
export type FontFaceRef = { readonly family: string; readonly urls: readonly string[]; readonly baseDir: string };

const round = (value: number, digits: number): number => { const scale = 10 ** digits; return Math.round(value * scale) / scale; };

export function summarizePages(pages: readonly PageMeasurement[]): readonly PrintPreflightPage[] {
  return pages.map((page, index) => ({
    index: index + 1,
    name: page.name,
    width_px: round(page.width, 2),
    height_px: round(page.height, 2),
    width_mm: round((page.width / CSS_PX_PER_INCH) * MM_PER_INCH, 1),
    height_mm: round((page.height / CSS_PX_PER_INCH) * MM_PER_INCH, 1),
  }));
}

/** Visible source pixels per printed inch on the weaker axis. Intrinsic pixels only: upscaling is not detected. */
export function effectivePpi(image: ImageMeasurement): number {
  const horizontal = (image.naturalWidth * image.visibleWidthFraction) / (image.displayWidth / CSS_PX_PER_INCH);
  const vertical = (image.naturalHeight * image.visibleHeightFraction) / (image.displayHeight / CSS_PX_PER_INCH);
  return Math.min(horizontal, vertical);
}

export function classifyPpi(ppi: number): PrintImageSeverity {
  if (ppi < PRINT_PPI_STRONG_WARN) return "strong_warn";
  return ppi < PRINT_PPI_WARN ? "warn" : "ok";
}

export function summarizeImages(pages: readonly PageMeasurement[], images: readonly ImageMeasurement[]): readonly PrintPreflightImage[] {
  const result: PrintPreflightImage[] = [];
  for (const image of images) {
    if (!(image.displayWidth > 0 && image.displayHeight > 0 && image.naturalWidth > 0 && image.naturalHeight > 0)) continue;
    const ppi = effectivePpi(image);
    result.push({
      page: image.pageIndex + 1,
      page_name: pages[image.pageIndex]?.name ?? `Page ${image.pageIndex + 1}`,
      locator: image.locator,
      intrinsic_width_px: image.naturalWidth,
      intrinsic_height_px: image.naturalHeight,
      effective_ppi: round(ppi, 1),
      severity: classifyPpi(ppi),
    });
  }
  return result;
}

/**
 * Reads the font-family and every url() of each @font-face rule with forward scans only, so a stylesheet
 * that repeats an opener without closing it cannot make the scan quadratic.
 */
export function extractFontFaceRefs(css: string, baseDir: string): readonly FontFaceRef[] {
  const refs: FontFaceRef[] = [];
  let cursor = 0;
  for (;;) {
    const start = css.indexOf("@font-face", cursor);
    if (start < 0) break;
    const open = css.indexOf("{", start);
    if (open < 0) break;
    const close = css.indexOf("}", open);
    const end = close < 0 ? css.length : close;
    cursor = end;
    const block = css.slice(open + 1, end);
    const family = declarationValue(block, "font-family");
    if (family === null) continue;
    const urls: string[] = [];
    let at = 0;
    for (;;) {
      const urlStart = block.indexOf("url(", at);
      if (urlStart < 0) break;
      const urlEnd = block.indexOf(")", urlStart);
      if (urlEnd < 0) break;
      at = urlEnd;
      const value = unquote(block.slice(urlStart + 4, urlEnd));
      if (value !== "") urls.push(value);
    }
    refs.push({ family: unquote(family), urls, baseDir });
  }
  return refs;
}

function declarationValue(block: string, property: string): string | null {
  const start = block.indexOf(`${property}:`);
  if (start < 0) return null;
  const from = start + property.length + 1;
  const semicolon = block.indexOf(";", from);
  return block.slice(from, semicolon < 0 ? block.length : semicolon).trim();
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  return (first === "\"" || first === "'") && trimmed.endsWith(first) && trimmed.length >= 2 ? trimmed.slice(1, -1).trim() : trimmed;
}

type Reference = { readonly kind: "remote" } | { readonly kind: "data" } | { readonly kind: "outside"; readonly name: string } | { readonly kind: "local"; readonly segments: readonly string[] };

/** Either separator flavor of a relative reference is understood, so a stylesheet authored on Windows resolves on POSIX. */
function classifyReference(url: string, baseDir: string): Reference {
  const stripped = url.split("#")[0]?.split("?")[0] ?? "";
  const unified = stripped.replaceAll("\\", "/");
  const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(unified);
  const driveLetter = /^[a-z]:\//iu.test(unified);
  if (scheme !== null && !driveLetter) return scheme[1]?.toLowerCase() === "data" ? { kind: "data" } : { kind: "remote" };
  const name = unified.slice(unified.lastIndexOf("/") + 1);
  if (driveLetter || unified.startsWith("/")) return { kind: "outside", name };
  const joined = path.posix.normalize(`${baseDir.replaceAll("\\", "/")}/${unified}`);
  if (joined === ".." || joined.startsWith("../")) return { kind: "outside", name };
  return { kind: "local", segments: joined.split("/").filter((segment) => segment !== "" && segment !== ".") };
}

/**
 * Resolves each referenced face against the project. A face counts as resolved when any of its listed files
 * exists, because the remaining entries are format fallbacks; otherwise the first file is named relative to the project.
 */
export async function resolveFonts(input: {
  readonly projectRoot: string;
  readonly refs: readonly FontFaceRef[];
  readonly flavor: PathFlavor;
  readonly exists: (absolute: string) => Promise<boolean>;
  readonly listDir: (absolute: string) => Promise<readonly string[]>;
}): Promise<readonly PrintPreflightFont[]> {
  const fonts = new Map<string, PrintPreflightFont>();
  for (const ref of input.refs) {
    let first: PrintPreflightFont | null = null;
    let resolved: PrintPreflightFont | null = null;
    for (const url of ref.urls) {
      const target = classifyReference(url, ref.baseDir);
      if (target.kind === "data") { resolved = { family: ref.family, status: "resolved", path: null, license_present: false }; break; }
      if (target.kind === "remote") { first ??= { family: ref.family, status: "remote", path: null, license_present: false }; continue; }
      if (target.kind === "outside") { first ??= { family: ref.family, status: "missing", path: target.name, license_present: false }; continue; }
      const relative = target.segments.join("/");
      const absolute = input.flavor.join(input.projectRoot, ...target.segments);
      if (await input.exists(absolute)) {
        const siblings = await input.listDir(input.flavor.dirname(absolute));
        resolved = { family: ref.family, status: "resolved", path: relative, license_present: siblings.some((entry) => LICENSE_FILE.test(entry)) };
        break;
      }
      first ??= { family: ref.family, status: "missing", path: relative, license_present: false };
    }
    const font = resolved ?? first;
    if (font !== null) fonts.set(`${font.family}\u0000${font.path ?? ""}\u0000${font.status}`, font);
  }
  return [...fonts.values()];
}
