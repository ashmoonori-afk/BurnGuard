import { describe, expect, test } from "bun:test";
import type { DesignSystemSummary, ProjectSummary } from "@bg/shared";
import type { CardViewModel } from "../src/components/home/mappers";
import { filterHomeCards, projectSearchTab, projectToCard, systemToCard } from "../src/components/home/mappers";

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

test("Given format previews When selecting a system Then only the requested format is shown", () => {
  const system: DesignSystemSummary = {
    id: "system", name: "System", status: "published", is_template: true, updated_at: 0,
    thumbnail_path: "/brand.png", thumbnail_paths: { prototype: "/web.png", slide_deck: "/deck.png" },
  };
  expect(systemToCard(system, 0, "prototype").thumbnail).toBe("/web.png");
  expect(systemToCard(system, 0, "slide_deck").thumbnail).toBe("/deck.png");
  expect(systemToCard(system, 0, "graphic").thumbnail).toBeNull();
  expect(systemToCard({ ...system, thumbnail_paths: undefined }, 0, "slide_deck").thumbnail).toBeNull();
  expect(systemToCard(system).thumbnail).toBe("/brand.png");
});

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

describe("search source on the recent tab (UX-31)", () => {
  const projects = Array.from({ length: 13 }, (_, index) => projectToCard(projectSummary({ id: `p${index}`, name: `프로젝트 ${index}`, updated_at: 13 - index })));
  const glance = projects.slice(0, 12);

  test("Given 13 projects and a query matching only the oldest When the recent tab is searched Then the full list is the source and the match is found", () => {
    const tab = projectSearchTab("recent", "프로젝트 12");
    expect(tab).toBe("mine");
    const source = tab === "mine" ? projects : glance;
    expect(filterHomeCards(source, "프로젝트 12").map((card) => card.id)).toEqual(["p12"]);
  });

  test("Given no query When the recent tab renders Then the 12-row glance stays the source", () => {
    expect(projectSearchTab("recent", "")).toBe("recent");
    expect(projectSearchTab("recent", " \t")).toBe("recent");
  });

  test("Given the other tabs When searched Then they search their own list", () => {
    expect(projectSearchTab("mine", "덱")).toBe("mine");
    expect(projectSearchTab("examples", "덱")).toBe("examples");
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
    ["logo", "로고 디자인"],
    ["other", "기타"],
  ] as const)(
    "Given a %s project When mapped Then its subtitle shows the real type label",
    (type, label) => {
      const card = projectToCard(projectSummary({ type }));
      expect(card.subtitle.startsWith(label)).toBe(true);
    },
  );

  test("Given a logo project When mapped Then it carries its own tint instead of the generic fallback", () => {
    const card = projectToCard(projectSummary({ type: "logo" }));
    expect(card.tintClass).toBe("bg-tint-fuchsia");
    expect(card.kind).toBe("logo");
  });

  test("Given a project created from a template When mapped Then its subtitle falls back to 기타 instead of 템플릿", () => {
    const card = projectToCard(projectSummary({ type: "from_template" }));
    expect(card.subtitle.startsWith("기타")).toBe(true);
    expect(card.subtitle).not.toContain("템플릿");
  });
});
