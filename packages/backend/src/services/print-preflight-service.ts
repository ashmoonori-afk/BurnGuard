import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "node-html-parser";
import type { Page } from "playwright-core";
import type { PrintBrowserReadiness, PrintPreflightV1 } from "@bg/shared/print-preflight";
import { getProjectDetail } from "../db/project-read-repository";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { resolveWithin } from "../security/path-boundary";
import { chromiumLaunchCapability } from "./chromium-capability";
import { runRenderPhase } from "./export-render-phase";
import { openRenderSession } from "./export-render-session";
import { extractFontFaceRefs, resolveFonts, summarizeImages, summarizePages, type FontFaceRef, type ImageMeasurement, type PageMeasurement } from "./print-preflight";

export class PrintPreflightError extends Error {
  readonly name = "PrintPreflightError";
  constructor(readonly code: "project_not_found") { super(code); }
}

export type PageMeasurements = { readonly pages: readonly PageMeasurement[]; readonly images: readonly ImageMeasurement[] };
export type PrintPreflightSeams = {
  readonly measure?: (stagedDir: string, entrypoint: string, signal: AbortSignal) => Promise<PageMeasurements>;
  readonly readiness?: (signal: AbortSignal) => Promise<PrintBrowserReadiness>;
};

const isFile = async (absolute: string): Promise<boolean> => { try { return (await stat(absolute)).isFile(); } catch { return false; } };
const listDir = async (absolute: string): Promise<readonly string[]> => { try { return await readdir(absolute); } catch { return []; } };

/** Local stylesheets and inline style blocks of the entrypoint, each with the project-relative directory its urls resolve from. */
export async function fontFaceRefs(projectRoot: string, entrypoint: string): Promise<readonly FontFaceRef[]> {
  const html = await readFile(resolveWithin(projectRoot, entrypoint), "utf8");
  const root = parse(html);
  const entryDir = path.posix.dirname(entrypoint.replaceAll("\\", "/"));
  const refs: FontFaceRef[] = [];
  for (const style of root.querySelectorAll("style")) refs.push(...extractFontFaceRefs(style.text, entryDir === "." ? "" : entryDir));
  for (const link of root.querySelectorAll("link[rel~=stylesheet]")) {
    const href = link.getAttribute("href");
    if (href === undefined || /^[a-z][a-z0-9+.-]*:/iu.test(href) || href.startsWith("//")) continue;
    const relative = path.posix.normalize(`${entryDir}/${href.split("#")[0]?.split("?")[0] ?? ""}`);
    if (relative.startsWith("../")) continue;
    try {
      const css = await readFile(resolveWithin(projectRoot, relative), "utf8");
      const dir = path.posix.dirname(relative);
      refs.push(...extractFontFaceRefs(css, dir === "." ? "" : dir));
    } catch { /* a missing stylesheet is reported by the design audit; fonts it would declare cannot be listed */ }
  }
  return refs;
}

/** Lays the page out in the browser and reads every artboard and its raster placements. */
export function measurePrintPage(page: Page, signal: AbortSignal): Promise<PageMeasurements> {
  return runRenderPhase("layout", () => page.evaluate(() => {
      const artboards = [...document.querySelectorAll<HTMLElement>("[data-graphic-artboard]")];
      const pageElements = artboards.length > 0 ? artboards : [...document.querySelectorAll<HTMLElement>("[data-slide]")];
      const pages: { name: string; width: number; height: number }[] = [];
      const images: { pageIndex: number; locator: string; naturalWidth: number; naturalHeight: number; displayWidth: number; displayHeight: number; visibleWidthFraction: number; visibleHeightFraction: number }[] = [];
      pageElements.forEach((element, pageIndex) => {
        const bounds = element.getBoundingClientRect();
        pages.push({ name: element.getAttribute("data-name") ?? element.getAttribute("aria-label") ?? `Page ${pageIndex + 1}`, width: bounds.width, height: bounds.height });
        [...element.querySelectorAll<HTMLImageElement>("img")].forEach((image, imageIndex) => {
          if (!image.complete || image.naturalWidth === 0) return;
          const box = image.getBoundingClientRect();
          let visibleWidth = 1; let visibleHeight = 1;
          if (getComputedStyle(image).objectFit === "cover" && box.width > 0 && box.height > 0) {
            const scale = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight);
            visibleWidth = Math.min(1, box.width / (image.naturalWidth * scale));
            visibleHeight = Math.min(1, box.height / (image.naturalHeight * scale));
          }
          const source = (image.getAttribute("src") ?? "").split(/[?#]/u)[0]?.split(/[\\/]/u).pop() ?? "";
          images.push({ pageIndex, locator: image.id !== "" ? `img#${image.id}` : `img[${imageIndex + 1}] ${source}`.trim(), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, displayWidth: box.width, displayHeight: box.height, visibleWidthFraction: visibleWidth, visibleHeightFraction: visibleHeight });
        });
      });
      return { pages, images };
    }), { signal });
}

async function measureInBrowser(stagedDir: string, entrypoint: string, signal: AbortSignal): Promise<PageMeasurements> {
  const session = await openRenderSession({ stagedDir, entrypoint, viewport: { width: 1280, height: 720, dpr: 1 }, deck: false, signal, strict: false });
  try { return await measurePrintPage(session.page, signal); } finally { await session.close(); }
}

/** Joins a browser measurement with the fonts the project references on disk. */
export async function assemblePrintPreflight(projectRoot: string, entrypoint: string, measured: PageMeasurements, browser: PrintBrowserReadiness): Promise<PrintPreflightV1> {
  const fonts = await resolveFonts({ projectRoot, refs: await fontFaceRefs(projectRoot, entrypoint), flavor: path, exists: isFile, listDir });
  return { schema_version: 1, pages: summarizePages(measured.pages), fonts, images: summarizeImages(measured.pages, measured.images), browser };
}

/** Print readiness of a live project: page geometry, referenced fonts, effective image resolution and browser readiness. */
export async function buildPrintPreflight(projectId: string, signal: AbortSignal, seams: PrintPreflightSeams = {}): Promise<PrintPreflightV1> {
  const project = await getProjectDetail(projectId);
  if (project === null) throw new PrintPreflightError("project_not_found");
  const projectRoot = resolveManagedPath(projectsDir, project.dir_path);
  const readiness = await (seams.readiness ?? ((s) => chromiumLaunchCapability(undefined, { signal: s })))(signal);
  // Measuring needs the browser; without a usable one the page and image sections stay empty rather than guessed.
  const measured = readiness === "unusable" ? { pages: [], images: [] } : await (seams.measure ?? measureInBrowser)(projectRoot, project.entrypoint, signal);
  return assemblePrintPreflight(projectRoot, project.entrypoint, measured, readiness);
}
