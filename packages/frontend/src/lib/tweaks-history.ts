import type { TweaksStyleKey } from "@/components/canvas/TweaksLayer";
import type { CanvasMode } from "@/components/modes/types";

/**
 * One inline-style tweak the server accepted. `inverse` restores the prior
 * inline values (null clears a property); `forward` is the same change so
 * Cmd/Ctrl+Shift+Z can replay it after an undo.
 */
export interface TweaksUndoFrame {
  bg_id: string;
  relPath: string;
  forward: Partial<Record<TweaksStyleKey, string | null>>;
  inverse: Partial<Record<TweaksStyleKey, string | null>>;
}

export type UndoAction =
  | { readonly kind: "tweak"; readonly frame: TweaksUndoFrame; readonly styles: Partial<Record<TweaksStyleKey, string | null>> }
  | { readonly kind: "project"; readonly operationId: string }
  | { readonly kind: "none" };

/** Style mode steps through its own tweak history for the active file before the durable project-wide history. */
export function resolveUndoAction(input: {
  readonly mode: CanvasMode | null;
  readonly direction: "undo" | "redo";
  readonly frame: TweaksUndoFrame | undefined;
  readonly activeRelPath: string | null;
  readonly projectOperationId: string | undefined;
}): UndoAction {
  const { mode, direction, frame, activeRelPath, projectOperationId } = input;
  if (mode === "tweaks" && frame !== undefined && frame.relPath === activeRelPath) {
    return { kind: "tweak", frame, styles: direction === "undo" ? frame.inverse : frame.forward };
  }
  return projectOperationId === undefined ? { kind: "none" } : { kind: "project", operationId: projectOperationId };
}
