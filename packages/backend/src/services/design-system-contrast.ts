const MIN_TEXT_CONTRAST = 4.5;
const MAX_VAR_HOPS = 8;

function normaliseHex(value: string): string | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/iu.exec(value.trim())?.[1]?.toLowerCase();
  if (hex === undefined) return null;
  return `#${hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex}`;
}

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(foreground: string, background: string): number | null {
  const fg = normaliseHex(foreground);
  const bg = normaliseHex(background);
  if (fg === null || bg === null) return null;
  const [lighter, darker] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

/** The colour a custom property resolves to through var() chains and fallbacks, as #rrggbb, or null when it is not a plain opaque hex colour. */
export function resolveTokenColor(tokensCss: string, name: string): string | null {
  const css = tokensCss.replace(/\/\*[\s\S]*?\*\//gu, "");
  const definition = (token: string): string | null => new RegExp(`(?:^|[{;\\s])${token}\\s*:\\s*([^;}]+)`, "u").exec(css)?.[1]?.trim() ?? null;
  let value = definition(name);
  for (let hop = 0; hop < MAX_VAR_HOPS && value !== null; hop += 1) {
    const reference = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/u.exec(value);
    if (reference === null) return normaliseHex(value);
    value = definition(reference[1]!) ?? reference[2]?.trim() ?? null;
  }
  return null;
}

/**
 * The first foreground token that reads at 4.5:1 or better on the first background token that resolves; when none
 * does, the most readable one; when the tokens cannot be resolved to colours, the first candidate unchanged.
 */
export function readableRole(tokensCss: string, foregrounds: readonly string[], backgrounds: readonly string[]): string {
  const background = backgrounds.map((token) => resolveTokenColor(tokensCss, token)).find((colour) => colour !== null) ?? null;
  if (background === null) return foregrounds[0]!;
  let best: { token: string; ratio: number } | null = null;
  for (const token of foregrounds) {
    const colour = resolveTokenColor(tokensCss, token);
    const ratio = colour === null ? null : contrastRatio(colour, background);
    if (ratio === null) {
      if (token === foregrounds[0]) return token;
      continue;
    }
    if (ratio >= MIN_TEXT_CONTRAST) return token;
    if (best === null || ratio > best.ratio) best = { token, ratio };
  }
  return best?.token ?? foregrounds[0]!;
}
