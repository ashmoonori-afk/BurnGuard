import { expect, test } from "bun:test";
import { splitToolbarItems, type ToolbarOverflowItem } from "../src/lib/toolbar-overflow";

const ITEMS: readonly ToolbarOverflowItem[] = [
  { id: "device", width: 120, priority: 3 },
  { id: "palette", width: 100, priority: 2 },
  { id: "history", width: 80, priority: 1 },
];
const GAP = 4;
const MORE = 32;

test("Given enough width When the items are split Then every item stays visible and nothing overflows", () => {
  const split = splitToolbarItems(ITEMS, 120 + 100 + 80 + 2 * GAP, GAP, MORE);
  expect(split.visible).toEqual(["device", "palette", "history"]);
  expect(split.overflow).toEqual([]);
});

test("Given one pixel too little When the items are split Then the lowest-priority item moves to More and the order is kept", () => {
  const split = splitToolbarItems(ITEMS, 120 + 100 + 80 + 2 * GAP - 1, GAP, MORE);
  expect(split.overflow).toEqual(["device"]);
  expect(split.visible).toEqual(["palette", "history"]);
});

test("Given a width that fits only the highest-priority item plus More When split Then the others overflow", () => {
  const split = splitToolbarItems(ITEMS, 80 + GAP + MORE, GAP, MORE);
  expect(split.visible).toEqual(["history"]);
  expect(split.overflow).toEqual(["device", "palette"]);
});

test("Given no room at all When split Then every item overflows into More", () => {
  const split = splitToolbarItems(ITEMS, 10, GAP, MORE);
  expect(split.visible).toEqual([]);
  expect(split.overflow).toEqual(["device", "palette", "history"]);
});

test("Given no optional items When split Then both lists are empty", () => {
  expect(splitToolbarItems([], 0, GAP, MORE)).toEqual({ visible: [], overflow: [] });
});
