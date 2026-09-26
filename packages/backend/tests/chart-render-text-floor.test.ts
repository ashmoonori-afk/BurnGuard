import { expect, test } from "bun:test";
import { chartSample, parseChart, renderChart } from "@bg/shared";
import { COMPACT_DECK_SKILL_MD } from "../src/harness/prompt-compact-skills";
import { DECK_SKILL_MD } from "../src/harness/skills/deck-skill";

const FLOOR_VARIABLE = "var(--bg-chart-min-text,0px)";
const FLOORED_SIZE = /^max\((\d+(?:\.\d+)?)px,var\(--bg-chart-min-text,0px\)\)$/u;

/** Every `font-size:` declaration in the rendered figure, in document order. */
function fontSizes(html: string): readonly string[] {
  return [...html.matchAll(/font-size:([^;"]+)/gu)].map((match) => match[1]!);
}

test("Given a two-series bar chart When rendered Then every fixed text size is floored by --bg-chart-min-text and keeps its base value without it", () => {
  // Given
  const chart = parseChart({
    ...chartSample("bar"),
    description: "Two series",
    source: "Sample figures",
    categories: ["Q1", "Q2", "Q3"],
    series: [{ name: "Revenue", values: [20, 35, 28] }, { name: "Cost", values: [10, 15, 12] }],
  });

  // When
  const sizes = fontSizes(renderChart(chart));

  // Then: title, description, svg labels, legend, source and data table all carry the floor.
  expect(sizes).toHaveLength(6);
  for (const size of sizes) expect(size).toMatch(FLOORED_SIZE);
  const base = sizes.map((size) => Number(FLOORED_SIZE.exec(size)![1]));
  expect(base).toEqual([20, 14, Math.max(12, chart.width / 65), 14, 12, 13]);
  expect(renderChart(chart)).not.toMatch(/font-size:\d+(?:\.\d+)?px/u);
});

test("Given every chart type When rendered Then no text size escapes the floor", () => {
  for (const type of ["area", "line", "composed", "radar", "pie", "radial", "sankey"] as const) {
    const sizes = fontSizes(renderChart(chartSample(type)));
    expect(sizes.length).toBeGreaterThanOrEqual(4);
    for (const size of sizes) expect(size).toContain(FLOOR_VARIABLE);
  }
});

test("Given both deck skill variants When read Then each declares the chart text floor at the projection caption size", () => {
  for (const skill of [DECK_SKILL_MD, COMPACT_DECK_SKILL_MD]) expect(skill).toContain("--bg-chart-min-text: 24px");
});
