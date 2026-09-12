import { canvasPoint } from "./canvas-coordinates";

export interface CommentPoint { x: number; y: number }
export interface CommentPinInput {
  x_pct: number;
  y_pct: number;
  node_selector: string;
  slide_index: number | null;
}

// Also embedded in the opaque-origin frame bridge; keep these functions self-contained.
export function isCommentEditable(target: { closest?: (selector: string) => unknown; isContentEditable?: boolean } | null): boolean {
  return Boolean(target?.isContentEditable || target?.closest?.("input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox]"));
}

export function isQuickCommentShortcut(event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat" | "isComposing" | "defaultPrevented">, editable: boolean): boolean {
  return event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
    (event.code === "Space" || event.key === " ") && !event.repeat && !event.isComposing && !event.defaultPrevented && !editable;
}

export function commentPointInFrame(frame: HTMLIFrameElement, point: CommentPoint): CommentPoint | null {
  const rect = frame.getBoundingClientRect();
  if (![point.x, point.y].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 ||
    point.x < rect.left || point.y < rect.top || point.x >= rect.right || point.y >= rect.bottom) return null;
  const [x, y] = canvasPoint(frame, point.x, point.y);
  return { x, y };
}

export function frameCommentPointer(payload: unknown, documentKey: string, frame: HTMLIFrameElement): CommentPoint | null {
  if (!payload || typeof payload !== "object" || !("documentKey" in payload) || payload.documentKey !== documentKey ||
    !("x" in payload) || !("y" in payload) || typeof payload.x !== "number" || typeof payload.y !== "number" ||
    ![payload.x, payload.y].every(Number.isFinite) || payload.x < 0 || payload.y < 0 || payload.x >= frame.clientWidth || payload.y >= frame.clientHeight) return null;
  const rect = frame.getBoundingClientRect();
  return { x: rect.left + payload.x * rect.width / frame.clientWidth, y: rect.top + payload.y * rect.height / frame.clientHeight };
}

export function quickCommentPosition(point: CommentPoint, size: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number } {
  const gap = 12;
  return {
    left: Math.max(gap, Math.min(point.x + gap, viewport.width - size.width - gap)),
    top: Math.max(gap, Math.min(point.y + gap, viewport.height - size.height - gap)),
  };
}
