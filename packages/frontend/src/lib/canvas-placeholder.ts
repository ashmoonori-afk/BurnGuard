import type { MessageKey } from "@/i18n/t";

export type CanvasPlaceholderInput = {
  readonly src: string | null | undefined;
  readonly loading: boolean;
  readonly working: boolean;
};

/**
 * Copy for the canvas placeholder frame. A file that is fetching and a pending query both read as
 * loading; a turn that is running with nothing renderable yet says so, and only an idle empty
 * project asks the user to describe what they want.
 */
export function canvasPlaceholderKeys({ src, loading, working }: CanvasPlaceholderInput): { readonly title: MessageKey; readonly subtitle: MessageKey } {
  if (src || loading) return { title: "workspace.canvas.loadingTitle", subtitle: "workspace.canvas.loadingSubtitle" };
  if (working) return { title: "workspace.canvas.workingTitle", subtitle: "workspace.canvas.workingSubtitle" };
  return { title: "workspace.canvas.placeholderTitle", subtitle: "workspace.canvas.placeholderSubtitle" };
}

/**
 * The fetched document is in the frame but has not painted yet. A heavy srcdoc otherwise shows a
 * blank white frame after the "preparing" placeholder, so a rendering state covers it until the
 * frame reports document-loaded (after load and one animation frame).
 */
export function canvasRenderingVisible({ hasDocument, painted, failed }: { readonly hasDocument: boolean; readonly painted: boolean; readonly failed: boolean }): boolean {
  return hasDocument && !painted && !failed;
}
