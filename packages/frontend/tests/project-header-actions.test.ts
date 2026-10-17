import { expect, test } from "bun:test";
import { splitHeaderActions } from "../src/lib/project-header-actions";

test("Given a wide header When the actions are split Then every action stays a button and the menu is empty", () => {
  const split = splitHeaderActions("wide", "slide_deck");
  expect(split.inline).toEqual(["folder", "figma", "present", "share", "instructions", "backup"]);
  expect(split.overflow).toEqual([]);
});

test("Given a medium header When the actions are split Then only Present stays a button and the rest move to the menu", () => {
  const split = splitHeaderActions("medium", "slide_deck");
  expect(split.inline).toEqual(["present"]);
  expect(split.overflow).toEqual(["folder", "figma", "share", "instructions", "backup"]);
});

test("Given a phone-width header When the actions are split Then every action moves to the menu", () => {
  const split = splitHeaderActions("narrow", "slide_deck");
  expect(split.inline).toEqual([]);
  expect(split.overflow).toEqual(["folder", "figma", "present", "share", "instructions", "backup"]);
});

test("Given a project that is not a slide deck When the actions are split at any width Then Present is never offered and no action is lost", () => {
  for (const tier of ["wide", "medium", "narrow"] as const) {
    const split = splitHeaderActions(tier, "prototype");
    const all = [...split.inline, ...split.overflow];
    expect(all).not.toContain("present");
    expect([...all].sort()).toEqual(["backup", "figma", "folder", "instructions", "share"]);
  }
});
