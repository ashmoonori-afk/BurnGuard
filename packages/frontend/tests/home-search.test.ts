import { describe, expect, test } from "bun:test";
import type { ProjectSummary } from "@bg/shared";
import type { CardViewModel } from "../src/components/home/mappers";
import { filterHomeCards, projectToCard } from "../src/components/home/mappers";

const cards: readonly CardViewModel[] = [
  {
    id: "quarterly-report",
    name: "분기 보고서",
    subtitle: "슬라이드 덱 · 오늘",
    href: "/projects/quarterly-report",
    tintClass: "bg-slate-100",
  },
  {
    id: "launch-poster",
    name: "Launch Poster",
    subtitle: "웹디자인 · 어제",
    href: "/projects/launch-poster",
    tintClass: "bg-rose-100",
  },
];

describe("filterHomeCards", () => {
  test("Given a normalized title query When filtering Then only matching titles remain", () => {
    expect(filterHomeCards(cards, "  분기   보고서  ")).toEqual([
      cards[0],
    ]);
  });

  test("Given a case-insensitive title query When filtering Then subtitle text does not create a match", () => {
    expect(filterHomeCards(cards, "launch")).toEqual([cards[1]]);
    expect(filterHomeCards(cards, "슬라이드")).toEqual([]);
  });

  test("Given an empty query When filtering Then every card remains available", () => {
    expect(filterHomeCards(cards, " \n\t ")).toEqual(cards);
  });
});

function projectSummary(overrides: Partial<ProjectSummary>): ProjectSummary {
  return {
    id: "p1",
    name: "Untitled",
    type: "prototype",
    design_system_id: null,
    design_system_name: null,
    thumbnail_path: null,
    updated_at: 0,
    archived_at: null,
    ...overrides,
  };
}

describe("projectToCard", () => {
  test("Given a regular project When mapped Then it never carries the template badge", () => {
    const card = projectToCard(projectSummary({ type: "slide_deck" }));
    expect(card.isTemplate).toBeUndefined();
  });

  test("Given a project created from a template When mapped Then it does not carry the template badge either", () => {
    const card = projectToCard(projectSummary({ type: "from_template" }));
    expect(card.isTemplate).toBeUndefined();
  });

  test.each([
    ["prototype", "웹디자인"],
    ["slide_deck", "슬라이드 덱"],
    ["graphic", "그래픽"],
    ["other", "기타"],
  ] as const)(
    "Given a %s project When mapped Then its subtitle shows the real type label",
    (type, label) => {
      const card = projectToCard(projectSummary({ type }));
      expect(card.subtitle.startsWith(label)).toBe(true);
    },
  );

  test("Given a project created from a template When mapped Then its subtitle falls back to 기타 instead of 템플릿", () => {
    const card = projectToCard(projectSummary({ type: "from_template" }));
    expect(card.subtitle.startsWith("기타")).toBe(true);
    expect(card.subtitle).not.toContain("템플릿");
  });
});
