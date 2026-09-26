type ComposerTextarea = Pick<HTMLTextAreaElement, "disabled" | "focus"> & {
  readonly closest: (selector: string) => Pick<Element, "scrollIntoView"> | null;
};

/**
 * Focus on a disabled form control is a no-op, so while the composer is disabled the recovery
 * action brings the composer into view instead of doing nothing visible.
 */
export function focusComposerOrReveal(element: ComposerTextarea | null): void {
  if (element === null) return;
  if (element.disabled) element.closest('[data-qa="composer"]')?.scrollIntoView({ block: "nearest" });
  else element.focus();
}
