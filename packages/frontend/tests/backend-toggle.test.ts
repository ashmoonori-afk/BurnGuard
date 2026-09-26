import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BACKEND_IDS } from "@bg/shared";
import { BackendToggle, backendToggleOptions } from "../src/components/chat/ChatPane";
import { BACKEND_LABELS } from "../src/lib/backend-display";

test("Given a session on a backend outside the switchable pair When the toggle options are derived Then the current backend is listed once alongside the switchable ones", () => {
  expect(backendToggleOptions("gemini")).toEqual(["claude-code", "codex", "gemini"]);
  expect(backendToggleOptions("codex")).toEqual(["claude-code", "codex"]);
  for (const id of BACKEND_IDS) expect(backendToggleOptions(id)).toContain(id);
});

test("Given a session whose backend is gemini When the toggle renders Then exactly one button is pressed and it carries the Gemini display name", () => {
  const html = renderToStaticMarkup(createElement(BackendToggle, { current: "gemini", disabled: false, onSwitch: () => {} }));

  const pressed = html.match(/<button[^>]*aria-pressed="true"[^>]*>[^<]*<\/button>/g) ?? [];
  expect(pressed).toHaveLength(1);
  expect(pressed[0]).toContain(BACKEND_LABELS.gemini);
  expect(html).toContain(BACKEND_LABELS.codex);
  expect(html).toContain(BACKEND_LABELS["claude-code"]);
});
