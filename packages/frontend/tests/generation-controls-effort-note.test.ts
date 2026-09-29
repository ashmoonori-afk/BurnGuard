import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GENERATION_EFFORTS, type BackendId, type GenerationOptions } from "@bg/shared";
import GenerationControls, { EFFORT_LABELS } from "../src/components/settings/GenerationControls";
import { settingsMessages } from "../src/i18n/messages/settings";

function render(backendId: BackendId, value: GenerationOptions): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(GenerationControls, { backendId, value, onChange: () => {} })));
}

const note = (html: string): string | null => html.match(/data-bg-effort-note="(below|met)"/)?.[1] ?? null;

test("Given Opus or Sonnet When the picker renders Then the medium-effort recommendation shows, highlighted only below medium", () => {
  // Server rendering reads the locale store's initial state, so the shipped Korean copy is what renders here.
  const low = render("claude-code", { model: "opus", effort: "low", provider: "native", vanilla: false });
  expect(low).toContain(settingsMessages["settings.capableModelEffortNote"].ko);
  expect(note(low)).toBe("below");
  expect(note(render("claude-code", { model: "sonnet", effort: "medium", provider: "native", vanilla: false }))).toBe("met");
  expect(note(render("claude-code", { model: "claude-opus-4-6", effort: "high", provider: "commandcode", vanilla: false }))).toBe("met");
});

test("Given every generation effort When labels are resolved Then each maps to a translated message and the picker never shows raw enum values", () => {
  for (const effort of GENERATION_EFFORTS) expect(settingsMessages[EFFORT_LABELS[effort]], effort).toBeDefined();
  const html = render("claude-code", { model: "opus", effort: "low", provider: "native", vanilla: false });
  const options = [...html.matchAll(new RegExp(`<option value="(${GENERATION_EFFORTS.join("|")})"[^>]*>([^<]*)</option>`, "g"))];
  expect(options.length).toBeGreaterThan(0);
  for (const [, effort, label] of options) expect(label).toBe(settingsMessages[EFFORT_LABELS[effort as typeof GENERATION_EFFORTS[number]]].ko);
});

test("Given models outside the capable profile When the picker renders Then no effort note is shown", () => {
  for (const [backendId, model] of [["codex", "gpt-5.6-luna"], ["claude-code", "haiku"], ["gemini", "gemini-2.5-pro"]] as const) {
    expect(note(render(backendId, { model, effort: "low", provider: "native", vanilla: false })), model).toBeNull();
  }
});
