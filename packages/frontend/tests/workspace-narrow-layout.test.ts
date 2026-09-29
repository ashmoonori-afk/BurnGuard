import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CanvasTopBar from "../src/components/canvas/CanvasTopBar";
import { PROJECT_ACTIONS_CLASS } from "../src/components/project/ProjectTopBar";
import { canvasMessages } from "../src/i18n/messages/canvas";

const classesOf = (html: string, attribute: string): readonly string[] =>
  html.match(new RegExp(`<div (?:${attribute} class="([^"]*)"|class="([^"]*)" ${attribute})`))?.slice(1).find(Boolean)?.split(" ") ?? [];

test("Given a phone-width workspace When the canvas toolbar renders Then the mode tools claim a full row instead of being squeezed beside the history group", () => {
  const html = renderToStaticMarkup(createElement(CanvasTopBar, { mode: null, onModeChange: () => {}, onRefresh: () => {} }));
  // Server rendering reads the locale store's initial state, so the shipped Korean label names the group.
  expect(classesOf(html, `aria-label="${canvasMessages["canvas.toolbar.tools"].ko}"`)).toContain("max-[900px]:basis-full");
});

test("Given a phone-width workspace When the project header lays out its actions Then they wrap instead of pushing Export off screen", () => {
  const actions = PROJECT_ACTIONS_CLASS.split(" ");
  expect(actions).toContain("max-[600px]:flex-wrap");
  expect(actions).toContain("max-[600px]:shrink");
});
