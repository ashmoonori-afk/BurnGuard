import type { FrameRect } from "@/components/canvas/frame-bridge";
import type { TweaksStyleKey, TweaksTarget } from "@/components/canvas/TweaksLayer";
import type { MessageKey } from "@/i18n/t";

export const MAX_ELEMENT_SIZE = 16384;
type Patch = Partial<Record<TweaksStyleKey, string | null>>;
const bounded = (value: number) => Math.round(Math.min(MAX_ELEMENT_SIZE, Math.max(1, value)) * 100) / 100;
const pixels = (value?: string) => value && /^\d+(?:\.\d+)?px$/.test(value) ? Number.parseFloat(value) : null;

export function targetDimensions(target: TweaksTarget) {
  const dimension = (key: "width" | "height") => bounded(
    (target.inline["box-sizing"] === "border-box" ? pixels(target.inline[key]) : null)
    ?? target.geometry?.[key] ?? pixels(target.computed[key]) ?? 1,
  );
  const raw = target.inline.rotate ?? target.computed.rotate ?? "0deg";
  const match = raw.match(/^(?:z\s+)?(-?\d+(?:\.\d+)?)(deg|rad|grad|turn)$/);
  const rotation = match ? Number(match[1]) * ({ deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 }[match[2]!] ?? 1) : 0;
  return { width: dimension("width"), height: dimension("height"), rotation: Math.round(rotation * 100) / 100 };
}

export function isAspectLocked(target: TweaksTarget): boolean {
  const ratio = target.inline["aspect-ratio"] ?? target.computed["aspect-ratio"] ?? "auto";
  return ratio !== "auto" && /^\s*(?:auto\s+)?\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?\s*$/.test(ratio);
}

/** The ratio presets the Style panel offers; the option value is the ratio as written by `String`. */
export const ASPECT_PRESETS: ReadonlyArray<{ readonly value: number; readonly label: string }> = [
  { value: 1, label: "1 : 1" },
  { value: 4 / 3, label: "4 : 3" },
  { value: 16 / 9, label: "16 : 9" },
  { value: 9 / 16, label: "9 : 16" },
];

/** Echoes the stored ratio back as its preset option, or as locked/free when it is a custom value or auto. */
export function aspectPresetValue(target: TweaksTarget): string {
  const raw = target.inline["aspect-ratio"] ?? target.computed["aspect-ratio"] ?? "auto";
  const match = raw.match(/^\s*(?:auto\s+)?(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*$/);
  if (!match) return "free";
  const ratio = Number(match[1]) / (match[2] === undefined ? 1 : Number(match[2]));
  const preset = ASPECT_PRESETS.find((candidate) => Math.abs(candidate.value - ratio) < 1e-3);
  return preset === undefined ? "locked" : String(preset.value);
}

/** Numeric inputs and drag handles share the same border-box size contract. */
export function dimensionPatch(target: TweaksTarget, width: number, height: number, locked: boolean): Patch {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return {};
  const before = targetDimensions(target);
  if (locked) {
    const ratio = before.width / before.height;
    const changedWidth = Math.abs(width / before.width - 1) >= Math.abs(height / before.height - 1);
    width = changedWidth ? width : height * ratio;
    width = Math.min(Math.min(MAX_ELEMENT_SIZE, MAX_ELEMENT_SIZE * ratio), Math.max(Math.max(1, ratio), width));
    height = width / ratio;
  }
  width = bounded(width); height = bounded(height);
  return { width: `${width}px`, height: `${height}px`, "box-sizing": "border-box", "aspect-ratio": locked ? `${width} / ${height}` : "auto", ...(target.computed.display === "inline" ? { display: "inline-block" } : {}) };
}

export function rotationPatch(degrees: number): Patch {
  if (!Number.isFinite(degrees)) return {};
  const rotation = Math.round((((degrees % 360) + 540) % 360 - 180) * 100) / 100;
  return { rotate: `${rotation}deg` };
}

/** Still plain text in its line: a resize gives it a box of its own (`display: inline-block`), and then it can move. */
const staysInLine = (target: TweaksTarget) => target.inLine === true && (target.inline.display ?? target.computed.display) === "inline";

export type MoveRefusal = "line" | "unit";
/** The sentence that says why, shown on the Move surface and in the panel's Position section. */
export const MOVE_REFUSAL_MESSAGES = {
  line: "modes.tweaks.positionInLine",
  unit: "modes.tweaks.positionUnsupported",
} as const satisfies Record<MoveRefusal, MessageKey>;

/** Why the move tools leave this element where it is, or null when they can move it. */
export function moveRefusal(target: TweaksTarget): MoveRefusal | null {
  if (staysInLine(target)) return "line";
  return targetOffset(target) === null ? "unit" : null;
}

/**
 * The element's saved offset from where the page lays it out, read from the CSS `translate` property. Null when the
 * move tools leave the element untouched: its authored value is not plain pixels (a percentage or `calc()`), or it
 * is plain text inside a line, which the browser does not move for a `translate`.
 */
export function targetOffset(target: TweaksTarget): { x: number; y: number } | null {
  if (staysInLine(target)) return null;
  const raw = (target.inline.translate ?? target.computed.translate ?? "none").trim();
  if (raw === "" || raw === "none") return { x: 0, y: 0 };
  const match = raw.match(/^(-?\d+(?:\.\d+)?)px(?:\s+(-?\d+(?:\.\d+)?)px)?(?:\s+0(?:px)?)?$/);
  return match ? { x: Number(match[1]), y: match[2] === undefined ? 0 : Number(match[2]) } : null;
}

/** Moving writes only `translate`, so the element shifts and its neighbours never reflow. */
export function translatePatch(x: number, y: number): Patch {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return {};
  const rounded = (value: number) => String(Math.round(value * 100) / 100 || 0);
  return { translate: `${rounded(x)}px ${rounded(y)}px` };
}

export type OffsetBasis = FrameRect["basis"];

/**
 * A distance on screen, in iframe client pixels, as the element's own `translate` pixels. It undoes the transforms
 * above the element and leaves out its own, because CSS applies `translate` outside them. No basis means none above.
 */
export function offsetDelta(basis: OffsetBasis, dx: number, dy: number): { x: number; y: number } {
  const [a = 1, b = 0, c = 0, d = 1]: readonly number[] = Array.isArray(basis) ? basis : [];
  const determinant = a * d - b * c;
  // A flattened or unreadable basis moves nothing, instead of saving a wild number. So does one whose numbers are
  // finite but too large to calculate with: the division then gives no number at all.
  if (!(Math.abs(determinant) > 1e-9)) return { x: 0, y: 0 };
  const x = (d * dx - c * dy) / determinant, y = (a * dy - b * dx) / determinant;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { x: 0, y: 0 };
}

/** One arrow-key step of `translate` pixels as the distance it covers on screen, along the screen's own axes. */
export function nudgeTravel(basis: OffsetBasis, step: { x: number; y: number }): { x: number; y: number } {
  const along = (x: number, y: number) => {
    const own = offsetDelta(basis, x, y);
    return 1 / (Math.hypot(own.x, own.y) || 1);
  };
  return { x: step.x * along(1, 0), y: step.y * along(0, 1) };
}

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";
export const ALIGN_MODES: readonly AlignMode[] = ["left", "center", "right", "top", "middle", "bottom"];
interface Box { left: number; top: number; width: number; height: number }

/**
 * The offset that lines one side or the centre of the element up with its parent's content box. `rect` and `content`
 * are in iframe client pixels; the element keeps its place along the other screen axis.
 */
export function alignOffset(input: { mode: AlignMode; rect: Box; content: Box; offset: { x: number; y: number }; basis: OffsetBasis }): { x: number; y: number } {
  const { mode, rect, content, offset } = input;
  const horizontal = mode === "left" || mode === "center" || mode === "right";
  const share = mode === "left" || mode === "top" ? 0 : mode === "center" || mode === "middle" ? 0.5 : 1;
  const travel = horizontal
    ? (content.left + content.width * share) - (rect.left + rect.width * share)
    : (content.top + content.height * share) - (rect.top + rect.height * share);
  const moved = horizontal ? offsetDelta(input.basis, travel, 0) : offsetDelta(input.basis, 0, travel);
  // An axis the travel does not touch keeps its saved value digit for digit.
  const shifted = (saved: number, by: number) => by === 0 ? saved : Math.round((saved + by) * 100) / 100 || 0;
  return { x: shifted(offset.x, moved.x), y: shifted(offset.y, moved.y) };
}
