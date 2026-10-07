import { describe, expect, test } from "bun:test";
import { LOCALES } from "@/i18n/locale";
import { PROMPT_LIBRARY_COPY, PROMPT_LIBRARY_MESSAGES } from "@/i18n/prompt-library-copy";
import {
  filterPromptLibrary,
  PROMPT_LIBRARY_ASPECTS,
  PROMPT_LIBRARY_CATEGORIES,
  PROMPT_SUGGESTION_LIMIT,
  promptMessageKey,
  suggestPrompts,
  type PromptLibrary,
  type PromptLibraryCopy,
} from "@/lib/prompt-library";
import { PROMPT_LIBRARY_ENTRIES } from "@/lib/prompt-library-entries";

const library: PromptLibrary = { entries: PROMPT_LIBRARY_ENTRIES, copy: PROMPT_LIBRARY_COPY };
const NON_LATIN_SCRIPT = /[\u3131-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/;
const EXTERNAL_DEPENDENCY = /https?:\/\/|\bcdn\b|three\.?js|babylon|\bgsap\b|unpkg|jsdelivr|google fonts/i;

function fixtureCopy(keywords: Partial<Record<(typeof LOCALES)[number], readonly string[]>>): PromptLibraryCopy {
  return {
    title: { ko: "t", en: "t", "zh-CN": "t" },
    summary: { ko: "s", en: "s", "zh-CN": "s" },
    keywords: { ko: keywords.ko ?? [], en: keywords.en ?? [], "zh-CN": keywords["zh-CN"] ?? [] },
  };
}

const fixture: PromptLibrary = {
  entries: [
    { id: "logo-reveal", category: "brand-reveal", aspect: "16:9", prompt: "Animate the logo reveal for [brand name]." },
    { id: "ad-spot", category: "product-promo", aspect: "9:16", prompt: "Cut a short ad spot for [product name]." },
    { id: "type-reel", category: "typography", aspect: "1:1", prompt: "Build a kinetic type reel." },
  ],
  copy: {
    "logo-reveal": fixtureCopy({ en: ["logo", "reveal"], ko: ["\uB85C\uACE0"] }),
    "ad-spot": fixtureCopy({ en: ["ad", "promo"] }),
    "type-reel": fixtureCopy({ en: ["kinetic type", "typography"] }),
  },
};

describe("built-in prompt library catalog", () => {
  test("Given the shipped catalog, then every entry id is unique and has localized copy, and no copy is orphaned", () => {
    const ids = PROMPT_LIBRARY_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
    expect(Object.keys(PROMPT_LIBRARY_COPY).sort()).toEqual([...ids].sort());
  });

  test("Given the shipped catalog, then every entry has a known category and aspect and an English prompt within the cap", () => {
    for (const entry of PROMPT_LIBRARY_ENTRIES) {
      expect(PROMPT_LIBRARY_CATEGORIES).toContain(entry.category);
      if (entry.category === "interface-style") expect(entry.aspect).toBeNull();
      else expect(PROMPT_LIBRARY_ASPECTS).toContain(entry.aspect);
      expect(entry.prompt.trim().length).toBeGreaterThan(40);
      expect(entry.prompt.length).toBeLessThanOrEqual(3000);
      expect(NON_LATIN_SCRIPT.test(entry.prompt)).toBe(false);
    }
  });

  test("Given the shipped catalog, then no prompt embeds a link or loads an external rendering library or CDN, so generated pages stay self-contained", () => {
    for (const entry of PROMPT_LIBRARY_ENTRIES) {
      expect({ id: entry.id, external: EXTERNAL_DEPENDENCY.test(entry.prompt) }).toEqual({ id: entry.id, external: false });
    }
  });

  test("Given the shipped catalog, then every category has at least one entry", () => {
    for (const category of PROMPT_LIBRARY_CATEGORIES) {
      expect(PROMPT_LIBRARY_ENTRIES.some((entry) => entry.category === category)).toBe(true);
    }
  });

  test("Given the lazily loaded message pack, then every entry has exactly a typed title and summary key, and the search copy reads the same definitions", () => {
    const expected = PROMPT_LIBRARY_ENTRIES.flatMap((entry) => [promptMessageKey(entry.id, "title"), promptMessageKey(entry.id, "summary")]);
    expect(Object.keys(PROMPT_LIBRARY_MESSAGES).sort()).toEqual([...expected].sort());
    for (const entry of PROMPT_LIBRARY_ENTRIES) {
      expect(PROMPT_LIBRARY_COPY[entry.id]!.title).toBe(PROMPT_LIBRARY_MESSAGES[promptMessageKey(entry.id, "title")]);
      expect(PROMPT_LIBRARY_COPY[entry.id]!.summary).toBe(PROMPT_LIBRARY_MESSAGES[promptMessageKey(entry.id, "summary")]);
    }
  });

  test("Given the localized copy, then every locale has a title, a summary, and search keywords", () => {
    for (const copy of Object.values(PROMPT_LIBRARY_COPY)) {
      for (const locale of LOCALES) {
        expect(copy.title[locale].trim().length).toBeGreaterThan(0);
        expect(copy.summary[locale].trim().length).toBeGreaterThan(0);
        expect(copy.keywords[locale].length).toBeGreaterThan(0);
      }
    }
  });

  test("Given a draft made of one entry's own keywords in any locale, when suggesting, then that entry is offered", () => {
    for (const entry of PROMPT_LIBRARY_ENTRIES) {
      for (const locale of LOCALES) {
        const draft = PROMPT_LIBRARY_COPY[entry.id]!.keywords[locale].join(" ");
        const offered = suggestPrompts(draft, library, PROMPT_LIBRARY_ENTRIES.length).map((suggestion) => suggestion.id);
        expect(offered).toContain(entry.id);
      }
    }
  });
});

describe("prompt suggestions", () => {
  test("Given a near-empty draft, then nothing is suggested", () => {
    expect(suggestPrompts("", fixture)).toEqual([]);
    expect(suggestPrompts("l", fixture)).toEqual([]);
  });

  test("Given a draft naming a keyword, then the matching entry is suggested first", () => {
    expect(suggestPrompts("make a logo reveal for my brand", fixture).map((entry) => entry.id)).toEqual(["logo-reveal"]);
  });

  test("Given a Hangul keyword followed by a particle, then the entry still matches", () => {
    expect(suggestPrompts("\uB85C\uACE0\uB97C \uB9CC\uB4E4\uC5B4 \uC918", fixture).map((entry) => entry.id)).toEqual(["logo-reveal"]);
  });

  test("Given a short Latin keyword inside a longer word, then it does not match", () => {
    expect(suggestPrompts("please add a footer", fixture)).toEqual([]);
    expect(suggestPrompts("an ad for launch day", fixture).map((entry) => entry.id)).toEqual(["ad-spot"]);
  });

  test("Given a draft that already holds a library prompt, then nothing more is suggested", () => {
    const draft = `logo promo typography\n\n${fixture.entries[0]!.prompt}`;
    expect(suggestPrompts(draft, fixture)).toEqual([]);
  });

  test("Given many matching entries, then at most the suggestion limit is returned", () => {
    const draft = "logo reveal promo ad kinetic type typography";
    expect(suggestPrompts(draft, fixture, 2)).toHaveLength(2);
    expect(suggestPrompts("motion video showreel product launch logo", library).length).toBeLessThanOrEqual(PROMPT_SUGGESTION_LIMIT);
  });
});

describe("prompt library browse filter", () => {
  test("Given a category, then only that category is listed", () => {
    expect(filterPromptLibrary(fixture, "typography", "").map((entry) => entry.id)).toEqual(["type-reel"]);
    expect(filterPromptLibrary(fixture, "all", "")).toHaveLength(3);
  });

  test("Given query words, then every word must match the entry's copy", () => {
    expect(filterPromptLibrary(fixture, "all", "LOGO reveal").map((entry) => entry.id)).toEqual(["logo-reveal"]);
    expect(filterPromptLibrary(fixture, "all", "logo promo")).toEqual([]);
  });
});
