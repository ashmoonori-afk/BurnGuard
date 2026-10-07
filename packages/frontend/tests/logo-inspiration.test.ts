import { describe, expect, test } from "bun:test";
import type { LogoSetV1 } from "@bg/shared";
import {
  LOGO_INSPIRATION_MAX_KEYWORD_LENGTH,
  LOGO_INSPIRATION_MAX_KEYWORDS,
  PINTEREST_MAX_QUERY_LENGTH,
  PINTEREST_SEARCH_BASE_URL,
  logoInspirationKeywords,
  pinterestSearchUrl,
} from "../src/lib/logo-inspiration";

function brief(overrides: Partial<LogoSetV1> = {}): LogoSetV1 {
  return {
    schema_version: 1,
    brand_name: "Northvale",
    niche: "boutique asset management",
    character: ["calm", "precise"],
    logo_type: "combination",
    symbol_keywords: ["mountain", "shield"],
    ...overrides,
  };
}

describe("logoInspirationKeywords", () => {
  test("Given a brief with unicode and an ampersand When keywords are derived Then they survive intact without the brand name", () => {
    const keywords = logoInspirationKeywords(brief({ niche: "\uCE74\uD398 & \uBCA0\uC774\uCEE4\uB9AC", character: ["\uB530\uB73B\uD568"] }));

    expect(keywords).toContain("\uCE74\uD398 & \uBCA0\uC774\uCEE4\uB9AC");
    expect(keywords).toContain("\uB530\uB73B\uD568");
    expect(keywords).not.toContain("Northvale");
  });

  test("Given a brief with no symbol keywords When keywords are derived Then niche, character, and a concrete logo type still contribute", () => {
    const keywords = logoInspirationKeywords(brief({ symbol_keywords: undefined, logo_type: "emblem" }));

    expect(keywords).toEqual(["boutique asset management", "calm", "precise", "emblem logo"]);
  });

  test("Given repeated keywords in different cases When keywords are derived Then only the first spelling is kept", () => {
    const keywords = logoInspirationKeywords(brief({
      niche: "Coffee",
      character: ["coffee", "COFFEE"],
      symbol_keywords: ["  coffee  ", "coffee"],
    }));

    expect(keywords).toEqual(["Coffee", "combination logo"]);
  });

  test("Given an undecided logo type When keywords are derived Then no type term is invented", () => {
    expect(logoInspirationKeywords(brief({ logo_type: "auto" }))).not.toContain("auto logo");
  });

  test("Given oversized and numerous sources When keywords are derived Then count and each length stay bounded", () => {
    const keywords = logoInspirationKeywords(brief({
      niche: "x".repeat(LOGO_INSPIRATION_MAX_KEYWORD_LENGTH + 40),
      character: Array.from({ length: 20 }, (_, index) => `character-${index}`),
      symbol_keywords: Array.from({ length: 20 }, (_, index) => `symbol-${index}`),
    }));

    expect(keywords).toHaveLength(LOGO_INSPIRATION_MAX_KEYWORDS);
    for (const keyword of keywords) expect(keyword.length).toBeLessThanOrEqual(LOGO_INSPIRATION_MAX_KEYWORD_LENGTH);
    expect(keywords[0]).toBe("x".repeat(LOGO_INSPIRATION_MAX_KEYWORD_LENGTH));
  });
});

describe("pinterestSearchUrl", () => {
  test("Given a blank or whitespace query When the URL is built Then it is null", () => {
    expect(pinterestSearchUrl("")).toBeNull();
    expect(pinterestSearchUrl("   \n\t ")).toBeNull();
  });

  test("Given a unicode ampersand query When the URL is built Then the encoded fields round-trip on the pinterest https origin", () => {
    const url = pinterestSearchUrl("\uCE74\uD398 & \uBCA0\uC774\uCEE4\uB9AC");

    expect(url).not.toBeNull();
    const parsed = new URL(url ?? "");
    expect(parsed.protocol).toBe("https:");
    expect(parsed.host).toBe("www.pinterest.com");
    expect(parsed.pathname).toBe("/search/pins/");
    expect(parsed.searchParams.get("q")).toBe("\uCE74\uD398 & \uBCA0\uC774\uCEE4\uB9AC");
  });

  test("Given an oversized query When the URL is built Then the query parameter is truncated to the bound", () => {
    const url = pinterestSearchUrl("a".repeat(PINTEREST_MAX_QUERY_LENGTH + 50));

    expect(url).not.toBeNull();
    const parsed = new URL(url ?? "");
    expect(parsed.searchParams.get("q")).toBe("a".repeat(PINTEREST_MAX_QUERY_LENGTH));
  });

  test("Given an emoji query past the bound When the URL is built Then the cut lands on a code-point boundary, never a lone surrogate", () => {
    const url = pinterestSearchUrl("\u{1F3A8}".repeat(PINTEREST_MAX_QUERY_LENGTH + 10));

    const query = new URL(url ?? "").searchParams.get("q") ?? "";
    expect(Array.from(query)).toHaveLength(PINTEREST_MAX_QUERY_LENGTH);
    expect(Array.from(query).every((codePoint) => codePoint === "\u{1F3A8}")).toBe(true);
  });

  test("Given a protocol-shaped query When the URL is built Then it stays a query value and never becomes the scheme", () => {
    const url = pinterestSearchUrl("javascript:alert(1)");

    expect(url).not.toBeNull();
    expect(url?.startsWith(PINTEREST_SEARCH_BASE_URL)).toBe(true);
    const parsed = new URL(url ?? "");
    expect(parsed.protocol).toBe("https:");
    expect(parsed.searchParams.get("q")).toBe("javascript:alert(1)");
  });
});
