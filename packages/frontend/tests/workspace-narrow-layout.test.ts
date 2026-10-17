import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CanvasTopBar from "../src/components/canvas/CanvasTopBar";
import { PROJECT_ACTIONS_CLASS } from "../src/components/project/ProjectTopBar";
import { canvasMessages } from "../src/i18n/messages/canvas";

const classesOf = (html: string, attribute: string): readonly string[] =>
  html.match(new RegExp(`<div (?:${attribute} class="([^"]*)"|class="([^"]*)" ${attribute})`))?.slice(1).find(Boolean)?.split(" ") ?? [];

test("Given any workspace width When the canvas toolbar renders Then the tools stay in one non-wrapping row", () => {
  const html = renderToStaticMarkup(createElement(CanvasTopBar, { mode: null, onModeChange: () => {}, onRefresh: () => {} }));
  // Server rendering reads the locale store's initial state, so the shipped Korean label names the group.
  const tools = classesOf(html, `aria-label="${canvasMessages["canvas.toolbar.tools"].ko}"`);
  expect(tools).toContain("shrink-0");
  expect(tools).not.toContain("flex-wrap");
});

test("Given a phone-width workspace When the project header lays out its actions Then they wrap instead of pushing Export off screen", () => {
  const actions = PROJECT_ACTIONS_CLASS.split(" ");
  expect(actions).toContain("max-[600px]:flex-wrap");
  expect(actions).toContain("max-[600px]:shrink");
});
