/**
 * Pure helpers for the Tweaks inspector. Kept separate from the React
 * panel so they can be unit-tested and reused by later features without
 * dragging in component imports.
 */

export interface Sides {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

export type SideStyle = "padding" | "margin" | "border-radius";

export function normalizeSideDraft(style: SideStyle, input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return "";
  if (!/^-?\d*\.?\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return String(style === "margin" ? value : Math.max(0, value));
}

/**
 * Parse a CSS box-model shorthand (padding / margin / border-radius) into
 * explicit 4-side values using CSS's standard collapsing rules:
 *   1 token:  all four sides
 *   2 tokens: top+bottom | right+left
 *   3 tokens: top | right+left | bottom
 *   4 tokens: top | right | bottom | left
 * Non-numeric tokens ("auto", "inherit") pass through untouched so the
 * caller can decide how to surface them.
 */
export function parseSides(value: string): Sides {
  if (!value) return { top: "", right: "", bottom: "", left: "" };
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    const v = tokens[0] ?? "";
    return { top: v, right: v, bottom: v, left: v };
  }
  if (tokens.length === 2) {
    return {
      top: tokens[0] ?? "",
      right: tokens[1] ?? "",
      bottom: tokens[0] ?? "",
      left: tokens[1] ?? "",
    };
  }
  if (tokens.length === 3) {
    return {
      top: tokens[0] ?? "",
      right: tokens[1] ?? "",
      bottom: tokens[2] ?? "",
      left: tokens[1] ?? "",
    };
  }
  return {
    top: tokens[0] ?? "",
    right: tokens[1] ?? "",
    bottom: tokens[2] ?? "",
    left: tokens[3] ?? "",
  };
}

/**
 * Compose 4-side values back into the shortest equivalent CSS shorthand.
 * Assumes every input already carries a unit (e.g. "0px" not "0") so
 * string equality is reliable for collapse checks. Returns "" when
 * every side is empty (signal to drop the override).
 */
export function composeSides(sides: Sides): string {
  const { top, right, bottom, left } = sides;
  if (!top && !right && !bottom && !left) return "";
  if (top === right && top === bottom && top === left) return top;
  if (top === bottom && right === left) return `${top} ${right}`;
  if (right === left) return `${top} ${right} ${bottom}`;
  return `${top} ${right} ${bottom} ${left}`;
}

/**
 * Extract the leading signed-decimal number from a CSS length token.
 *   "24px"  -> "24"
 *   "-0.5"  -> "-0.5"
 *   "normal"-> ""    (unparseable — caller shows the placeholder)
 * The caller appends the unit on commit; keeping the numeric portion
 * separate lets the numeric input fields render cleanly.
 */
export function numericFromLength(value: string): string {
  if (!value) return "";
  const match = value.trim().match(/^(-?\d*\.?\d+)/);
  return match ? match[1] : "";
}

/**
 * Canonicalise a user-entered hex colour. Accepts 3-, 6-, or 8-digit hex
 * with or without a leading `#`; returns the lowercase `#rrggbb[aa]`
 * form, or null when unparseable so the caller can reject the input.
 */
export function normalizeHex(input: string): string | null {
  const trimmed = input.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(trimmed)) {
    return null;
  }
  if (trimmed.length === 3) {
    const r = trimmed[0] ?? "";
    const g = trimmed[1] ?? "";
    const b = trimmed[2] ?? "";
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return `#${trimmed}`.toLowerCase();
}
