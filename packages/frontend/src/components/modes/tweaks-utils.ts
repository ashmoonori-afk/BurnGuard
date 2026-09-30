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

const CSS_WIDE_KEYWORDS = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

/**
 * Split a shorthand at top-level whitespace, keeping functions such as
 * `calc(1px + 2px)` whole. Returns null for a top-level `/` (elliptical
 * border-radius) or unbalanced parentheses.
 */
function splitSideTokens(value: string): string[] | null {
  const tokens: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (depth < 0) return null;
    if (depth === 0 && char === "/") return null;
    if (depth === 0 && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (depth !== 0) return null;
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Parse a CSS box-model shorthand (padding / margin / border-radius) into
 * explicit 4-side values using CSS's standard collapsing rules:
 *   1 token:  all four sides
 *   2 tokens: top+bottom | right+left
 *   3 tokens: top | right+left | bottom
 *   4 tokens: top | right | bottom | left
 * Each side keeps its authored token ("auto", "50%", "2rem") untouched.
 * Returns null when the value cannot be edited one side at a time: an
 * elliptical radius, more than four tokens, a CSS-wide keyword, or a
 * `var()` reference that may expand to several sides.
 */
export function parseSides(value: string): Sides | null {
  if (!value) return { top: "", right: "", bottom: "", left: "" };
  const tokens = splitSideTokens(value);
  if (!tokens || tokens.length > 4) return null;
  if (tokens.some((token) => CSS_WIDE_KEYWORDS.has(token.toLowerCase()) || /var\(/i.test(token))) return null;
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
 * What a side input shows for an authored token: the bare number for a
 * px length (the editor's only unit), otherwise the token as written.
 */
export function sideDisplay(token: string): string {
  const match = token.match(/^(-?\d*\.?\d+)px$/i);
  return match ? (match[1] ?? "") : token;
}

/**
 * Apply one edited side to the authored side tokens. Returns null when
 * the draft is unchanged or rejected, so nothing is written. Otherwise
 * returns the next tokens and the shorthand to write ("" drops the
 * override); sides the user did not edit keep their authored token.
 */
export function applySideDraft(
  style: SideStyle,
  sides: Sides,
  side: keyof Sides,
  draft: string,
): { sides: Sides; shorthand: string } | null {
  if (draft.trim() === sideDisplay(sides[side])) return null;
  const normalized = normalizeSideDraft(style, draft);
  if (normalized === null) return null;
  const next: Sides = { ...sides, [side]: normalized === "" ? "" : `${normalized}px` };
  if (!next.top && !next.right && !next.bottom && !next.left) return { sides: next, shorthand: "" };
  return {
    sides: next,
    shorthand: composeSides({
      top: next.top || "0px",
      right: next.right || "0px",
      bottom: next.bottom || "0px",
      left: next.left || "0px",
    }),
  };
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
