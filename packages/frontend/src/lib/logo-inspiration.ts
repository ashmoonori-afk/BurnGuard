/**
 * Brief-to-Pinterest inspiration helpers (doc/23). Pure string derivation: the brief is
 * already a parsed `LogoSetV1`, and the result is a search URL that the caller opens
 * externally. Nothing here fetches, scrapes, or touches the Pinterest API or the DOM.
 */
import type { LogoType, LogoSetV1 } from "@bg/shared";

export const LOGO_INSPIRATION_MAX_KEYWORDS = 12;
export const LOGO_INSPIRATION_MAX_KEYWORD_LENGTH = 60;
export const PINTEREST_SEARCH_BASE_URL = "https://www.pinterest.com/search/pins/";
export const PINTEREST_MAX_QUERY_LENGTH = 200;

/**
 * Collapse whitespace, drop the ends, and cut to `max` code points (never UTF-16 units),
 * so a bound cannot split a surrogate pair in the middle of an emoji or a rare glyph.
 */
function boundedText(value: string, max: number): string {
  const collapsed = value.replace(/\s+/gu, " ").trim();
  return collapsed.length <= max ? collapsed : Array.from(collapsed).slice(0, max).join("");
}

function typeKeywords(type: LogoType): readonly string[] {
  return type === "auto" ? [] : [`${type} logo`];
}

/**
 * Search phrases for an external inspiration board, drawn from the brief's substance:
 * the niche, the character words, the optional symbol keywords, and the concrete logo
 * type. The brand name is deliberately excluded - a query built from it surfaces the
 * brand's own artefacts, not inspiration. Trimmed, deduped case-insensitively (first
 * spelling wins), and bounded in count and length.
 */
export function logoInspirationKeywords(brief: LogoSetV1): readonly string[] {
  const sources: readonly string[] = [
    brief.niche,
    ...brief.character,
    ...(brief.symbol_keywords ?? []),
    ...typeKeywords(brief.logo_type),
  ];
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const source of sources) {
    const keyword = boundedText(source, LOGO_INSPIRATION_MAX_KEYWORD_LENGTH);
    if (keyword === "") continue;
    const dedupeKey = keyword.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    keywords.push(keyword);
    if (keywords.length === LOGO_INSPIRATION_MAX_KEYWORDS) break;
  }
  return keywords;
}

/**
 * The external Pinterest search URL for one keyword, or null when the query carries no
 * substance once trimmed. The query is bounded and then encoded through `URLSearchParams`
 * onto a fixed https origin, so arbitrary text - including something shaped like a
 * protocol - stays in the `q` parameter and can never choose the scheme or the host.
 */
export function pinterestSearchUrl(query: string): string | null {
  const bounded = boundedText(query, PINTEREST_MAX_QUERY_LENGTH);
  if (bounded === "") return null;
  const params = new URLSearchParams({ q: bounded });
  return `${PINTEREST_SEARCH_BASE_URL}?${params.toString()}`;
}
