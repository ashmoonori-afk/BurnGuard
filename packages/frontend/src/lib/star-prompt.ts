import type { ExportJob } from "@bg/shared";

export const STAR_PROMPT_STORAGE_KEY = "burnguard.starPrompt";
export const STAR_PROMPT_REPO_URL = "https://github.com/ashmoonori-afk/BurnGuard";

export type StarPromptStorage = Pick<Storage, "getItem" | "setItem">;

/** Open Radix menus and dialogs are modal; the star prompt waits until none is open. */
export const OPEN_MODAL_SELECTOR = '[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

export function hasOpenModal(root: Pick<ParentNode, "querySelector">): boolean {
  return root.querySelector(OPEN_MODAL_SELECTOR) !== null;
}

/** The share dialog's preparatory HTML export is not a user export; its publish success counts instead. */
export function countsAsStarExport(job: Pick<ExportJob, "options">): boolean {
  return job.options?.skip_quality_check !== true;
}

/**
 * Claims the one-time GitHub star request. The marker is written before the
 * prompt is shown, so quitting without dismissing still counts as shown and the
 * request never repeats. Nothing leaves the device. Blocked storage
 * (`DOMException`) never shows the prompt, because it could not be remembered.
 */
export function claimStarPrompt(storage: () => StarPromptStorage): boolean {
  try {
    const store = storage();
    if (store.getItem(STAR_PROMPT_STORAGE_KEY) !== null) return false;
    store.setItem(STAR_PROMPT_STORAGE_KEY, "shown");
    return true;
  } catch (error) {
    if (error instanceof DOMException) return false;
    throw error;
  }
}
