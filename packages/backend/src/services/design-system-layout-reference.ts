import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDesignSystemLayoutReference, type DesignSystemLayoutReference, type LayoutReferenceShot } from "@bg/shared";
import { resolveWithin } from "../security/path-boundary";
import { readManagedFile } from "./artifact-tree-storage";
import { readDesignSystemSourceFile } from "./design-system-layout";

/** Where a turn finds the reference screenshots of its pinned system; outside the canonical tree, never published. */
export const STAGED_REFERENCE_DIR = ".burnguard-inputs/design-system-starter/reference";
const OPEN_TAG = "<selected_design_system_layout_reference>";
const CLOSE_TAG = "</selected_design_system_layout_reference>";

/** The system's layout-reference.json, or null when it has none (older, unmeasured or non-website systems). */
export async function readDesignSystemLayoutReference(system: { readonly dir_path: string }): Promise<DesignSystemLayoutReference | null> {
  const text = await readDesignSystemSourceFile(system.dir_path, "layout-reference.json");
  return text ? parseDesignSystemLayoutReference(JSON.parse(text)) : null;
}

/**
 * The prompt block naming the screenshots of the given measured pages with their size and digest, so the pinned
 * context freezes exactly which bytes a turn may stage. Empty when no listed page has a screenshot.
 */
export function layoutReferencePromptLines(reference: DesignSystemLayoutReference, pagePaths: readonly string[]): string[] {
  const shots = reference.shots.filter(shot => pagePaths.includes(shot.path));
  if (shots.length === 0) return [];
  return [OPEN_TAG, JSON.stringify(shots).replace(/</g, "\\u003c"), CLOSE_TAG];
}

/** The screenshots frozen in a pinned context; none when it carries no block or the block does not parse. */
export function layoutReferenceFromPinnedContext(context: string): readonly LayoutReferenceShot[] {
  const start = context.indexOf(`${OPEN_TAG}\n`);
  if (start === -1) return [];
  const line = context.slice(start + OPEN_TAG.length + 1).split("\n", 1)[0] ?? "";
  try {
    return parseDesignSystemLayoutReference({ schema_version: 1, shots: JSON.parse(line) }).shots;
  } catch {
    return [];
  }
}

export const stagedReferencePath = (shot: LayoutReferenceShot): string => `${STAGED_REFERENCE_DIR}/${path.posix.basename(shot.file)}`;

/**
 * Copies the pinned screenshots from the system directory into the stage. A file is staged only when its size and
 * SHA-256 still match the pin, so a re-extracted or edited system can never hand a turn images the pin did not
 * freeze. Returns the staged paths; a screenshot that no longer matches is left out.
 */
export async function provisionDesignSystemLayoutReference(stageDir: string, pinnedContext: string, systemDir: string | null): Promise<readonly string[]> {
  const shots = layoutReferenceFromPinnedContext(pinnedContext);
  if (shots.length === 0 || systemDir === null) return [];
  const staged: string[] = [];
  for (const shot of shots) {
    const bytes = await readManagedFile(systemDir, { path: shot.file, size: shot.size, sha256: shot.sha256 }).catch(() => null);
    if (bytes === null) continue;
    const target = stagedReferencePath(shot);
    await mkdir(resolveWithin(stageDir, ...STAGED_REFERENCE_DIR.split("/")), { recursive: true });
    await writeFile(resolveWithin(stageDir, ...target.split("/")), bytes);
    staged.push(target);
  }
  return staged;
}
