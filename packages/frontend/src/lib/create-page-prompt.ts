import { t } from "@/i18n/t";

/** The "Create this page" request, worded in the active locale so the user's own bubble reads naturally. */
export function createPagePrompt(page: string, from: string): string {
  return t("workspace.project.createPagePrompt", { page, from });
}

/** A prefill never clobbers typed text: an empty draft takes it, a non-empty draft gets it appended after a blank line. */
export function mergeComposerPrefill(current: string, prefill: string): string {
  if (prefill.length === 0) return current;
  if (current.trim().length === 0) return prefill;
  return `${current.trimEnd()}\n\n${prefill}`;
}
