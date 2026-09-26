import type { DesignSystemColorToken } from "@bg/shared";

const VAR_REFERENCE = /^var\(\s*--([A-Za-z0-9_-]+)\s*(?:,\s*(.+?)\s*)?\)$/;

/**
 * Follows `var(--name)` chains through the system's own tokens so a swatch shows the
 * system's colour, not whatever the app stylesheet happens to define under that name.
 * Returns null when the chain ends in a missing token, a cycle, or exceeds the depth.
 */
export function resolveTokenColor(value: string, tokens: readonly DesignSystemColorToken[], depth = 8): string | null {
  const trimmed = value.trim();
  const reference = VAR_REFERENCE.exec(trimmed);
  if (reference === null) return trimmed === "" ? null : trimmed;
  if (depth <= 0) return null;
  const target = tokens.find((token) => token.name === reference[1]);
  if (target !== undefined) return resolveTokenColor(target.value, tokens, depth - 1);
  return reference[2] === undefined ? null : resolveTokenColor(reference[2], tokens, depth - 1);
}
