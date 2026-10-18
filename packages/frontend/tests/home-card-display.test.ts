import { describe, expect, test } from "bun:test";
import { LOCALES, localeTag } from "../src/i18n/locale";
import { formatAbsoluteDate, formatUpdatedAt } from "../src/lib/date-format";
import { isBuiltInSystem, systemDisplayName, systemMonogram } from "../src/lib/system-display";
import { systemToCard } from "../src/components/home/mappers";
import { topBarRoute } from "../src/components/layout/TopBar";

// Local noon keeps every case on the same calendar day in any host time zone.
const NOW = new Date(2026, 9, 17, 12, 0, 0).getTime();
const daysBefore = (days: number) => new Date(2026, 9, 17 - days, 12, 0, 0).getTime();
const relative = (locale: (typeof LOCALES)[number], value: number) =>
  new Intl.RelativeTimeFormat(localeTag(locale), { numeric: "auto" }).format(value, "day");

describe("locale-aware card dates", () => {
  describe.each(LOCALES)("%s", (locale) => {
    test("Given a change made today When formatted Then the locale's own word for today is used", () => {
      const label = formatUpdatedAt(daysBefore(0), locale, NOW);
      expect(label.toLocaleLowerCase(localeTag(locale))).toBe(relative(locale, 0).toLocaleLowerCase(localeTag(locale)));
    });

    test("Given a change made yesterday When formatted Then the locale's own word for yesterday is used", () => {
      expect(formatUpdatedAt(daysBefore(1), locale, NOW).toLocaleLowerCase(localeTag(locale))).toBe(relative(locale, -1).toLocaleLowerCase(localeTag(locale)));
    });

    test("Given a change three days ago When formatted Then the locale's relative phrase is used", () => {
      expect(formatUpdatedAt(daysBefore(3), locale, NOW).toLocaleLowerCase(localeTag(locale))).toBe(relative(locale, -3).toLocaleLowerCase(localeTag(locale)));
    });

    test("Given a change more than a week ago When formatted Then the locale's absolute date is used", () => {
      const label = formatUpdatedAt(daysBefore(30), locale, NOW);
      expect(label).toBe(formatAbsoluteDate(daysBefore(30), locale));
      expect(label).toBe(new Intl.DateTimeFormat(localeTag(locale), { year: "numeric", month: "short", day: "numeric" }).format(daysBefore(30)));
    });

    test("Given a timestamp in the future When formatted Then it reads as today", () => {
      expect(formatUpdatedAt(daysBefore(-2), locale, NOW)).toBe(formatUpdatedAt(daysBefore(0), locale, NOW));
    });
  });

  test("Given the same old date When formatted in each locale Then the outputs differ so no locale falls back to another", () => {
    const labels = LOCALES.map((locale) => formatUpdatedAt(daysBefore(30), locale, NOW));
    expect(new Set(labels).size).toBe(LOCALES.length);
  });
});

describe("design system card display", () => {
  test.each([
    ["Taskly liquid glass Design system", "Taskly liquid glass"],
    ["Northvale Capital design system", "Northvale Capital"],
    ["Sonnel - Design System", "Sonnel"],
    ["Design system", "Design system"],
    ["Wide gutter review", "Wide gutter review"],
    ["오로라 디자인 시스템", "오로라"],
    ["极光设计系统", "极光"],
  ])("Given the name %p When displayed Then it reads %p", (name, expected) => {
    expect(systemDisplayName(name)).toBe(expected);
  });

  test("Given a stripped name When the monogram is read Then it is the first letter of the display name", () => {
    expect(systemMonogram("taskly Design system")).toBe("T");
    expect(systemMonogram("오로라 디자인 시스템")).toBe("오");
  });

  test("Given bundled ids and a user id When grouped Then only the shipped systems are built in", () => {
    const base = { is_template: false };
    expect(isBuiltInSystem({ ...base, id: "builtin-theme-wide-gutter-review" })).toBe(true);
    expect(isBuiltInSystem({ ...base, id: "sample-system-original-sonnel" })).toBe(true);
    expect(isBuiltInSystem({ is_template: true, id: "template-1" })).toBe(true);
    expect(isBuiltInSystem({ ...base, id: "northvale-capital" })).toBe(true);
    expect(isBuiltInSystem({ ...base, id: "01M53XVPYF8DR9A183F08WWBEN" })).toBe(false);
  });

  test("Given a system When mapped to a card Then the stored name is kept for search and the placeholder is neutral", () => {
    const card = systemToCard({ id: "s1", name: "Aurora Design system", status: "published", is_template: false, thumbnail_path: null, updated_at: NOW });
    expect(card.name).toBe("Aurora");
    expect(card.fullName).toBe("Aurora Design system");
    expect(card.monogram).toBe("A");
    expect(card.builtIn).toBe(false);
    expect(card.tintClass).toBe("bg-muted");
  });
});

describe("top bar route labels", () => {
  test.each([
    ["/systems/abc", "system"],
    ["/systems/abc/", "system"],
    ["/settings", "settings"],
    ["/settings/", "settings"],
  ] as const)("Given the known route %p When labelled Then it is %p", (path, expected) => {
    expect(topBarRoute(path)).toBe(expected);
  });

  test.each(["/no/such/route", "/systems", "/systems/a/b", "/settings/extra", "/projects"])("Given the unknown route %p When labelled Then no label is claimed", (path) => {
    expect(topBarRoute(path)).toBeNull();
  });
});
