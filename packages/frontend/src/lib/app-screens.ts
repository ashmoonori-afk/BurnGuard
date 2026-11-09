import type { AppScreenFrame, AppScreensManifest, AppScreenSection } from "@bg/shared";
import { resolveCanvasNavigation } from "./canvas-source";

export function appScreenPosition(manifest: AppScreensManifest, file: string): {
  readonly section: AppScreenSection; readonly index: number;
} | null {
  for (const section of manifest.sections) {
    const index = section.screens.findIndex((screen) => screen.file === file);
    if (index >= 0) return { section, index };
  }
  return null;
}

/** Previous/Next follows the current section; links may cross section boundaries. */
export function stepAppScreen(manifest: AppScreensManifest, file: string, delta: number): string | null {
  const position = appScreenPosition(manifest, file);
  return position?.section.screens[position.index + delta]?.file ?? null;
}

export function appScreenScale(frame: AppScreenFrame, bounds: AppScreenFrame): number {
  return Math.max(0, Math.min(1, bounds.width / frame.width, bounds.height / frame.height));
}

/** Only manifest-owned local HTML targets are navigable. */
export function appScreenTarget(href: unknown, documentUrl: string, manifest: AppScreensManifest): string | null {
  return resolveCanvasNavigation(href, documentUrl, manifest.sections.flatMap((section) => section.screens.map((screen) => screen.file)))?.relPath ?? null;
}

/** The DOM supplies decoded anchor attributes; scripts and comments are never link sources. */
export function appScreenLinks(hrefs: readonly string[], documentUrl: string, manifest: AppScreensManifest): readonly string[] {
  const current = appScreenTarget("", documentUrl, manifest);
  return [...new Set(hrefs.flatMap((href) => {
    const file = appScreenTarget(href, documentUrl, manifest);
    return file === null || file === current ? [] : [file];
  }))];
}
