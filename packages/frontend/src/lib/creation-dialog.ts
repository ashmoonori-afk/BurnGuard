export type CreationEscape = "dismiss" | "stay" | "back";

/**
 * Escape inside the creation dialog: a create in flight keeps the dialog,
 * the design-system picker steps back to the brief, anything else closes.
 */
export function creationEscapeAction(state: { readonly creating: boolean; readonly picking: boolean }): CreationEscape {
  if (state.creating) return "stay";
  if (state.picking) return "back";
  return "dismiss";
}
