import { parseDesignSystemMeasuredLayout, type DesignSystemMeasuredLayout } from "@bg/shared";
import { readDesignSystemSourceFile, type LayoutSystem } from "./design-system-layout";

/** The system's layout-measured.json, or null when it has none (non-website, older, or unmeasured systems). */
export async function readDesignSystemMeasuredLayout(system: LayoutSystem): Promise<DesignSystemMeasuredLayout | null> {
  const text = await readDesignSystemSourceFile(system.dir_path, "layout-measured.json");
  return text ? parseDesignSystemMeasuredLayout(JSON.parse(text)) : null;
}

/**
 * The measured pages bounded for the prompt: later pages are dropped first, then each viewport keeps fewer
 * sections, so the escaped block stays under maxChars whatever the stored values are.
 */
export function measuredLayoutPromptSummary(layout: DesignSystemMeasuredLayout, maxChars: number): DesignSystemMeasuredLayout["pages"] {
  const size = (pages: DesignSystemMeasuredLayout["pages"]) => measuredLayoutPromptJson(pages).length;
  let pages = layout.pages;
  while (pages.length > 1 && size(pages) > maxChars) pages = pages.slice(0, -1);
  for (let keep = 16; keep >= 0 && size(pages) > maxChars; keep = keep === 0 ? -1 : Math.floor(keep / 2)) {
    pages = pages.map((page) => ({ ...page, viewports: { desktop: { ...page.viewports.desktop, sections: page.viewports.desktop.sections.slice(0, keep) }, mobile: { ...page.viewports.mobile, sections: page.viewports.mobile.sections.slice(0, keep) } } }));
  }
  return size(pages) > maxChars ? [] : pages;
}

/** The prompt form of the measured pages: JSON with "<" escaped so stored strings cannot open or close a prompt tag. */
export function measuredLayoutPromptJson(pages: DesignSystemMeasuredLayout["pages"]): string {
  return JSON.stringify(pages).replace(/</g, "\\u003c");
}
