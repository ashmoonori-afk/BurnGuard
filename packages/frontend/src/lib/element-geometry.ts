import type { TweaksStyleKey, TweaksTarget } from "@/components/canvas/TweaksLayer";

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
