import {
  parseCssSource,
  type CssDeclarationEvidence,
} from "./extraction-css-parser";

export {
  MAX_CSS_DECLARATIONS,
  MAX_CSS_PARSE_BYTES,
  parseCssSource,
  type CssDeclarationEvidence,
  type CssParseIssue,
  type CssParseRequest,
  type CssParseResult,
} from "./extraction-css-parser";

export type CssStyleSignals = {
  readonly colors: string[];
  readonly fontSizes: string[];
  readonly fontWeights: string[];
  readonly spacingValues: string[];
  readonly radii: string[];
  readonly shadows: string[];
  readonly borders: string[];
};

export async function extractCssCustomProperties(content: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const declaration of (await parseCssSource({ content })).declarations) {
    if (declaration.property.startsWith("--")) out.set(declaration.property.slice(2), declaration.value);
  }
  return out;
}

/**
 * Cascade-aware custom-property selection: the last declaration in (file, declaration) order wins,
 * except that a dark-scheme override never replaces a base value. Keys are sorted for stable output.
 */
export function selectCssCustomProperties(declarations: readonly CssDeclarationEvidence[]): Map<string, string> {
  const winners = new Map<string, { value: string; dark: boolean }>();
  for (const declaration of [...declarations].sort((left, right) => left.fileOrder - right.fileOrder || left.declarationOrder - right.declarationOrder)) {
    if (!declaration.property.startsWith("--")) continue;
    const key = declaration.property.slice(2);
    const dark = /prefers-color-scheme\s*:\s*dark/i.test(declaration.context);
    const current = winners.get(key);
    if (dark && current !== undefined && !current.dark) continue;
    winners.set(key, { value: declaration.value, dark });
  }
  return new Map([...winners].sort(([left], [right]) => left.localeCompare(right)).map(([key, winner]) => [key, winner.value]));
}

export async function extractCssStyleSignals(content: string): Promise<CssStyleSignals> {
  return styleSignalsFromDeclarations((await parseCssSource({ content })).declarations);
}

export function styleSignalsFromDeclarations(declarations: readonly CssDeclarationEvidence[]): CssStyleSignals {
  const values = (matches: (property: string) => boolean, limit: number): string[] => {
    const found = new Set<string>();
    for (const declaration of declarations) {
      if (matches(declaration.property) && found.size < limit) found.add(declaration.value);
    }
    return [...found];
  };
  return {
    colors: values((property) => property === "color" || property === "background" || property === "background-color" || (property.startsWith("border") && property.endsWith("color")), 24),
    fontSizes: values((property) => property === "font-size", 16),
    fontWeights: values((property) => property === "font-weight", 12),
    spacingValues: values((property) => ["margin", "padding", "gap", "column-gap", "row-gap"].includes(property), 24),
    radii: values((property) => property === "border-radius" || property.startsWith("border-") && property.endsWith("-radius"), 12),
    shadows: values((property) => property === "box-shadow", 12),
    borders: values((property) => property === "border" || property === "border-width" || property === "border-style" || property === "border-color" || /^border-(top|right|bottom|left)(?:-(width|style|color))?$/.test(property), 24),
  };
}

export async function extractFontFamilies(content: string): Promise<string[]> {
  return fontFamiliesFromDeclarations((await parseCssSource({ content })).declarations);
}

export function fontFamiliesFromDeclarations(declarations: readonly CssDeclarationEvidence[]): string[] {
  const families = new Set<string>();
  for (const declaration of declarations) {
    if (declaration.property !== "font-family") continue;
    const first = declaration.value.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "");
    if (first) families.add(first);
  }
  return [...families];
}

export function isColorTokenValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !isSafeExtractedCssValue(trimmed) || /[;]/.test(trimmed)) return false;
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) return true;
  if (/^(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color|color-mix)\(/i.test(trimmed)) return true;
  if (/^var\(--[a-zA-Z0-9_-]+\)$/.test(trimmed)) return true;
  return /^[a-zA-Z]+$/.test(trimmed);
}

export function upsertCssCustomProperty(css: string, tokenName: string, value: string): string {
  const declaration = `  --${tokenName}: ${value};`;
  const existing = new RegExp(`(^\\s*--${escapeRegExp(tokenName)}\\s*:\\s*)[^;]+(;\\s*$)`, "m");
  if (existing.test(css)) return css.replace(existing, `$1${value}$2`);
  const rootMatch = /:root\s*\{[\s\S]*?\n\}/.exec(css);
  if (rootMatch) {
    const closeIndex = rootMatch.index + rootMatch[0].lastIndexOf("\n}");
    return `${css.slice(0, closeIndex)}\n${declaration}${css.slice(closeIndex)}`;
  }
  const prefix = css.endsWith("\n") || css.length === 0 ? css : `${css}\n`;
  return `${prefix}:root {\n${declaration}\n}\n`;
}

export function ensureTokensCssImportsFonts(css: string): string {
  if (/fonts\/fonts\.css/i.test(css)) return css;
  const importLine = "@import url('./fonts/fonts.css');";
  const charsetMatch = /^@charset\s+["'][^"']+["'];\s*\n?/i.exec(css);
  if (charsetMatch) return `${charsetMatch[0]}${importLine}\n${css.slice(charsetMatch[0].length)}`;
  return `${importLine}\n${css}`;
}

function isSafeExtractedCssValue(value: string): boolean {
  return value.length <= 140 && !/[{}<>\n\r]/.test(value) && !/(?:url\s*\(|@import|expression\s*\(|javascript:|data:)/i.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
