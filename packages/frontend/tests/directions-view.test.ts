import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DesignDirectionSlot, DesignDirectionState } from "@bg/shared";
import { DirectionsView } from "../src/components/directions/DirectionsView";
import { regenerateActivation } from "../src/lib/design-direction-state";
import { t } from "../src/i18n/t";

function slot(id: string, order: number): DesignDirectionSlot {
  return { id, order, layout_key: "editorial", title: id, summary: id, style_facts: [id], status: "ready", preview_url: `/preview/${id}`, error: null };
}

function state(overrides: Partial<DesignDirectionState> = {}): DesignDirectionState {
  return {
    schema_version: 1, project_id: "p1", session_id: "s1", generation_id: "g1", status: "ready", updated_at: 100,
    content_outline: ["outline"], directions: [slot("editorial", 0), slot("modular", 1), slot("narrative", 2)],
    selected_id: null, selection_revision: 0, selection_history: [], error: null, ...overrides,
  };
}

function render(current: DesignDirectionState, props: Partial<Parameters<typeof DirectionsView>[0]> = {}): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(DirectionsView, {
    designSystemId: null, state: current, recovering: false, actionPending: false, cancelPending: false, error: null, preferencesSaving: false,
    onGenerate() {}, onSavePreferences() {}, onCancel() {}, onRetry() {}, onSelect() {}, onUndo() {}, ...props,
  })));
}

const originalError = console.error;
beforeAll(() => { console.error = (...args: unknown[]) => { if (!String(args[0]).includes("useLayoutEffect")) originalError(...args); }; });
afterAll(() => { console.error = originalError; });

describe("continue after selecting a direction (UXM-16)", () => {
  test("Given a selected direction and a continue handler When rendered Then a continue action sits beside the selection", () => {
    const html = render(state({ selected_id: "editorial", selection_revision: 1 }), { onContinue() {} });
    const action = html.match(/<button[^>]*data-direction-action="continue"[^>]*>[^<]*<\/button>/)?.[0] ?? "";
    expect(action).toContain(t("directions.continue"));
    expect(action).not.toContain('disabled=""');
  });

  test("Given no selection When rendered Then there is no continue action", () => {
    expect(render(state(), { onContinue() {} })).not.toContain('data-direction-action="continue"');
  });

  test("Given a selection but no continue handler When rendered Then the selection row stays as it was", () => {
    expect(render(state({ selected_id: "editorial", selection_revision: 1 }))).not.toContain('data-direction-action="continue"');
  });
});

describe("regenerate with a selection (DP-13)", () => {
  const layout = { schema_version: 1 as const, supplemented: false, tokens: {}, sections: [] };

  test("Given a selected direction When regenerate is activated once Then it asks first, and generates once confirmed", () => {
    expect(regenerateActivation("editorial", false)).toBe("confirm");
    expect(regenerateActivation("editorial", true)).toBe("generate");
  });

  test("Given no selection When regenerate is activated Then it generates directly", () => {
    expect(regenerateActivation(null, false)).toBe("generate");
  });

  test("Given a changed system and a selected direction When rendered Then the regenerate control is offered and the confirmation is not yet shown", () => {
    const html = render(state({ selected_id: "editorial", selection_revision: 1, design_system: { id: "system", name: "System", layout } }));
    expect(html).toContain('data-direction-action="regenerate"');
    expect(html).not.toContain('data-direction-action="regenerate-confirm"');
    expect(html).not.toContain(t("directions.regenerateConfirm", { name: "editorial" }));
  });
});
