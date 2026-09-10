import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FileInfo } from "@bg/shared/harness";
import { buildSiteMap } from "../services/site-map";
import { summarizePrototypeHtml } from "./structure-extractor";

type PrototypeSiteContext = {
  readonly projectDir: string;
  readonly entrypoint: string;
  readonly files: readonly FileInfo[];
  readonly activeRelPath?: string;
};

export async function appendPrototypeSiteContext(lines: string[], context: PrototypeSiteContext): Promise<void> {
  const indexedHtml = new Set(context.files.filter((file) => file.category === "html").map((file) => file.rel_path));
  const activeRelPath = context.activeRelPath !== undefined && indexedHtml.has(context.activeRelPath)
    ? context.activeRelPath
    : undefined;
  const entrypointSummary = await summarizePrototypeHtml(path.join(context.projectDir, context.entrypoint));
  if (entrypointSummary !== null) {
    lines.push("## Prototype structure (use this map; only Read sections you must change)", entrypointSummary, "");
  }
  if (activeRelPath !== undefined) {
    lines.push(`## Active page: ${activeRelPath}`);
    if (activeRelPath !== context.entrypoint) {
      const activeSummary = await summarizePrototypeHtml(path.join(context.projectDir, activeRelPath));
      if (activeSummary !== null) lines.push(activeSummary);
    }
    lines.push("");
  }
  if (indexedHtml.size === 0) return;

  const siteMap = await buildSiteMap(context.files, context.entrypoint, async (relPath) => {
    try { return await readFile(path.join(context.projectDir, relPath), "utf8"); }
    catch (error) {
      if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") return "";
      throw error;
    }
  });
  lines.push("## Site map");
  for (const page of siteMap.pages) lines.push(`- ${page.nav_order + 1}. ${page.rel_path}${page.is_home ? " (home)" : ""} — ${page.title}`);
  for (const missing of siteMap.dangling) lines.push(`- MISSING: ${missing.from} -> ${missing.href}`);
  if (siteMap.overflow) lines.push(`- OVERFLOW: ${siteMap.omitted_count} additional HTML page(s) omitted from this bounded summary.`);
  lines.push("");
}
