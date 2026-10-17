import type { ProjectType } from "@bg/shared";

/** How much room the project header has: >= xl, >= 640px, or phone width. */
export type HeaderTier = "wide" | "medium" | "narrow";

export type HeaderActionId = "folder" | "figma" | "present" | "share" | "instructions" | "backup";

export interface HeaderActionSplit {
  /** Shown as buttons next to Export. */
  readonly inline: readonly HeaderActionId[];
  /** Collected in the More menu. */
  readonly overflow: readonly HeaderActionId[];
}

/**
 * Export is always the single primary button and is not part of this list. Every other action is a
 * button while the header is wide; below that only Present (slide decks) stays out of the menu until
 * phone width, so nothing is ever dropped.
 */
export function splitHeaderActions(tier: HeaderTier, projectType: ProjectType): HeaderActionSplit {
  const all: HeaderActionId[] = ["folder", "figma"];
  if (projectType === "slide_deck") all.push("present");
  all.push("share", "instructions", "backup");
  if (tier === "wide") return { inline: all, overflow: [] };
  if (tier === "medium") return { inline: all.filter((id) => id === "present"), overflow: all.filter((id) => id !== "present") };
  return { inline: [], overflow: all };
}
