import type { Locale } from "@/i18n/locale";

/** Built-in prompt library: ready-made motion prompts the composer suggests while the user types and inserts on request. */
export const PROMPT_LIBRARY_CATEGORIES = [
  "showreel",
  "product-promo",
  "explainer",
  "ui-motion",
  "typography",
  "story",
  "brand-reveal",
  "interactive-3d",
  "interface-style",
] as const;
export type PromptLibraryCategory = (typeof PROMPT_LIBRARY_CATEGORIES)[number];

export const PROMPT_LIBRARY_ASPECTS = ["16:9", "9:16", "1:1", "4:5", "4:3"] as const;
export type PromptLibraryAspect = (typeof PROMPT_LIBRARY_ASPECTS)[number];

export type PromptLibraryEntry = {
  readonly id: string;
  readonly category: PromptLibraryCategory;
  /** Frame of a motion piece; null for interface styles, which apply to the page being built. */
  readonly aspect: PromptLibraryAspect | null;
  readonly prompt: string;
};

export type PromptLibraryCopy = {
  readonly title: Readonly<Record<Locale, string>>;
  readonly summary: Readonly<Record<Locale, string>>;
  readonly keywords: Readonly<Record<Locale, readonly string[]>>;
};

export type PromptLibrary = {
  readonly entries: readonly PromptLibraryEntry[];
  readonly copy: Readonly<Record<string, PromptLibraryCopy>>;
};

/** Typed keys of the lazily loaded catalog message pack; components resolve them through `useCatalogT`, like registry keys through `useT`. */
export type PromptLibraryMessageKey = `promptLibrary.${string}.${"title" | "summary"}`;
export type PromptLibraryMessages = Readonly<Record<PromptLibraryMessageKey, Readonly<Record<Locale, string>>>>;
export type LoadedPromptLibrary = PromptLibrary & { readonly messages: PromptLibraryMessages };

export function promptMessageKey(id: string, field: "title" | "summary"): PromptLibraryMessageKey {
  return `promptLibrary.${id}.${field}`;
}

export const PROMPT_SUGGESTION_LIMIT = 3;
export const PROMPT_SUGGESTION_MIN_CHARS = 2;

const LATIN_TERM = /^[a-z0-9][a-z0-9 '&.+-]*$/;

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFC").replace(/\s+/g, " ").trim();
}

type IndexedTerm = { readonly needle: string; readonly latin: boolean };
type IndexedEntry = {
  readonly entry: PromptLibraryEntry;
  readonly prompt: string;
  readonly keywords: readonly IndexedTerm[];
  readonly titleWords: readonly IndexedTerm[];
};

// Normalizing every prompt and term on each keystroke costs O(entries x terms); index each library object once instead.
const indexCache = new WeakMap<PromptLibrary, readonly IndexedEntry[]>();

function indexTerm(needle: string): IndexedTerm {
  return { needle, latin: LATIN_TERM.test(needle) };
}

function indexEntry(entry: PromptLibraryEntry, copy: PromptLibraryCopy | undefined): IndexedEntry {
  const keywords: IndexedTerm[] = [];
  const titleWords: IndexedTerm[] = [];
  if (copy !== undefined) {
    const seen = new Set<string>();
    for (const locale of Object.keys(copy.keywords) as Locale[]) {
      for (const keyword of copy.keywords[locale]) {
        const key = normalize(keyword);
        if (seen.has(key)) continue;
        seen.add(key);
        if (key.length > 0) keywords.push(indexTerm(key));
      }
    }
    for (const locale of Object.keys(copy.title) as Locale[]) {
      for (const word of normalize(copy.title[locale]).split(" ")) {
        if (word.length < 3 || seen.has(word)) continue;
        seen.add(word);
        titleWords.push(indexTerm(word));
      }
    }
  }
  return { entry, prompt: normalize(entry.prompt), keywords, titleWords };
}

function indexLibrary(library: PromptLibrary): readonly IndexedEntry[] {
  let index = indexCache.get(library);
  if (index === undefined) {
    index = library.entries.map((entry) => indexEntry(entry, library.copy[entry.id]));
    indexCache.set(library, index);
  }
  return index;
}

// Latin terms match whole words so "ad" never fires inside "add"; Hangul/CJK terms match as substrings so a term followed by a particle still hits.
function termMatches(haystack: string, paddedHaystack: string, term: IndexedTerm): boolean {
  return term.latin ? paddedHaystack.includes(` ${term.needle} `) : haystack.includes(term.needle);
}

function draftWords(draft: string): string {
  return ` ${draft.replace(/[^\p{L}\p{N}'&.+-]+/gu, " ").replace(/[.]+(?=\s|$)/g, "")} `;
}

function scoreEntry(draft: string, padded: string, indexed: IndexedEntry): number {
  let score = 0;
  for (const term of indexed.keywords) if (termMatches(draft, padded, term)) score += 3;
  for (const term of indexed.titleWords) if (termMatches(draft, padded, term)) score += 1;
  return score;
}

/** Entries to suggest for the draft, best first; empty once the draft already holds a library prompt. */
export function suggestPrompts(draft: string, library: PromptLibrary, limit = PROMPT_SUGGESTION_LIMIT): readonly PromptLibraryEntry[] {
  const text = normalize(draft);
  if (text.length < PROMPT_SUGGESTION_MIN_CHARS) return [];
  const index = indexLibrary(library);
  if (index.some((indexed) => text.includes(indexed.prompt))) return [];
  const padded = draftWords(text);
  return index
    .map((indexed) => ({ entry: indexed.entry, score: scoreEntry(text, padded, indexed) }))
    .filter((scored) => scored.score >= 3)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, limit)
    .map((scored) => scored.entry);
}

/** Browse filter: every query word must hit the title, summary, or keywords in any locale. */
export function filterPromptLibrary(library: PromptLibrary, category: PromptLibraryCategory | "all", query: string): readonly PromptLibraryEntry[] {
  const words = normalize(query).split(" ").filter((word) => word.length > 0);
  return library.entries.filter((entry) => {
    if (category !== "all" && entry.category !== category) return false;
    if (words.length === 0) return true;
    const copy = library.copy[entry.id];
    if (copy === undefined) return false;
    const haystack = normalize([
      ...Object.values(copy.title),
      ...Object.values(copy.summary),
      ...Object.values(copy.keywords).flat(),
    ].join(" "));
    return words.every((word) => haystack.includes(word));
  });
}
