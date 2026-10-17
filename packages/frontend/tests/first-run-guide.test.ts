import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { BackendDetectionResult, ProjectSummary } from "@bg/shared";
import HomeView from "../src/views/HomeView";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalError = console.error;
beforeAll(() => { console.error = (...args: unknown[]) => { if (!String(args[0]).includes("useLayoutEffect")) originalError(...args); }; });
afterAll(() => { console.error = originalError; });
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

const detection: BackendDetectionResult = { backends: [
  { id: "claude-code", found: true, authenticated: true },
  { id: "codex", found: true, authenticated: false },
  { id: "gemini", found: true },
  { id: "copilot", found: false },
] };
const project = (name: string, type: ProjectSummary["type"] = "prototype"): ProjectSummary => ({
  id: name, name, type, design_system_id: null, design_system_name: null,
  thumbnail_path: null, updated_at: 1, archived_at: null,
  is_bundled: name.startsWith("[burnguard:"),
});

function renderHome(options: {
  dismissed?: boolean;
  mine?: ProjectSummary[];
  examples?: ProjectSummary[];
  pending?: boolean;
  path?: string;
} = {}): string {
  const storage = new Map<string, string>();
  if (options.dismissed) storage.set("burnguard.first-run-dismissed", "1");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["backends", "detect"], detection);
  client.setQueryData(["settings"], { default_backend: "codex" });
  client.setQueryData(["design-systems", "all"], []);
  client.setQueryData(["projects", "recent"], []);
  if (!options.pending) {
    client.setQueryData(["projects", "mine"], options.mine ?? []);
    client.setQueryData(["projects", "examples"], options.examples ?? []);
  }
  return renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(MemoryRouter, { initialEntries: [options.path ?? "/"] }, createElement(HomeView))));
}

describe("first-run guide", () => {
  test("Given only bundled examples When home opens Then a nonmodal guide offers the single-action form", () => {
    const html = renderHome({
      mine: [{ ...project("Legacy bundled fixture"), is_bundled: true }],
      examples: [project("[burnguard:original-sample] SONNEL · Web")],
    });
    expect(html).toContain('data-qa="first-run-guide"');
    expect(html).toContain('data-qa="first-run-dismiss"');
    expect(html).toContain('id="brief-objective"');
    expect(html).toContain('data-qa="creation-submit"');
    expect(html).not.toContain('role="dialog"');
    expect(html.match(/<details[^>]*data-qa="creation-advanced"[^>]*>/)?.[0]).not.toContain("open");
  });

  test("Given detected tools When the guide renders Then login states remain distinct and a signed-in tool is selected", () => {
    const html = renderHome();
    for (const state of ["signed-in", "sign-in-required", "unknown", "missing"]) {
      expect(html).toContain(`data-connection-state="${state}"`);
    }
    const select = html.match(/<select id="creation-backend"[^>]*>[\s\S]*?<\/select>/)?.[0] ?? "";
    expect(select).toContain('value="claude-code" selected=""');
    expect(select).toContain('value="copilot" disabled=""');
  });

  test.each([
    { dismissed: true },
    { mine: [project("My website")] },
    { examples: [project("My template project", "from_template")] },
    { pending: true },
    { path: "/?view=systems" },
    { path: "/?create=prototype" },
  ])("Given a returning user, unknown project state, or another creation surface When home renders Then the guide does not interfere: %j", (options) => {
    expect(renderHome(options)).not.toContain('data-qa="first-run-guide"');
  });
});
