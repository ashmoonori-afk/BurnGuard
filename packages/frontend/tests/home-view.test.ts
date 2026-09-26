import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { BackendDetectionResult } from "@bg/shared";
import HomeView from "../src/views/HomeView";
import ProjectCardSection from "../src/components/home/ProjectCardSection";
import { ApiError } from "../src/api/client";
import { creationEscapeAction } from "../src/lib/creation-dialog";
import { t } from "../src/i18n/t";

const codexSignedOut: BackendDetectionResult = { backends: [{ id: "claude-code", found: true }, { id: "codex", found: true, authenticated: false, image_generation: true }] };

function renderHome(path: string, detection: BackendDetectionResult | ApiError): string {
  // retryOnMount off keeps a seeded error state visible to the first render instead of resetting it to pending.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  if (detection instanceof ApiError) {
    client.getQueryCache().build(client, { queryKey: ["backends", "detect"] }).setState({ status: "error", error: detection, fetchStatus: "idle" });
  } else {
    client.setQueryData(["backends", "detect"], detection);
  }
  for (const tab of ["recent", "mine", "examples"]) client.setQueryData(["projects", tab], []);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: [path] }, createElement(HomeView))));
}

const tile = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>(?:(?!</button>)[\\s\\S])*?${label}(?:(?!</button>)[\\s\\S])*?</button>`))?.[0] ?? "";
const section = (props: Partial<Parameters<typeof ProjectCardSection>[0]>) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ProjectCardSection, { cards: [], sourceCount: 0, query: "", isLoading: false, error: null, emptyText: "e", emptyHint: "h", onRetry() {}, onClearQuery() {}, onStartProject() {}, ...props })));

// react-dom/server reports every useLayoutEffect in Radix and the router; the markup is what matters here.
const originalError = console.error;
beforeAll(() => { console.error = (...args: unknown[]) => { if (!String(args[0]).includes("useLayoutEffect")) originalError(...args); }; });
afterAll(() => { console.error = originalError; });

describe("detection failure on Home (UX-05)", () => {
  test("Given backend detection failed When Home renders Then an alert names the failure and offers a retry", () => {
    const html = renderHome("/", new ApiError("codex_authentication_probe_failed", "private", 503));
    const alert = html.match(/<div[^>]*role="alert"[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(alert).toContain(t("home.detectionFailed"));
    expect(alert).toContain(`>${t("home.retry")}</button>`);
  });

  test("Given backend detection failed When the graphic tile renders Then its reason is the detection failure, not the Codex sign-in", () => {
    const graphic = tile(renderHome("/", new ApiError("codex_authentication_probe_failed", "private", 503)), t("home.type.graphic"));
    expect(graphic).toContain(`title="${t("home.detectionFailed")}"`);
    expect(graphic).not.toContain(t("home.codexRequired"));
  });

  test("Given detection succeeded When Home renders Then no detection alert is shown", () => {
    expect(renderHome("/", codexSignedOut)).not.toContain(t("home.detectionFailed"));
  });
});

describe("gated quick-start tiles (UX-24)", () => {
  test("Given Codex signed out When the tiles render Then the graphic tile stays focusable, is marked aria-disabled and points at the visible reason", () => {
    const html = renderHome("/", codexSignedOut);
    const graphic = tile(html, t("home.type.graphic"));
    expect(graphic).toContain('aria-disabled="true"');
    expect(graphic).toContain('aria-describedby="home-graphic-gate"');
    expect(graphic).not.toContain('disabled=""');
    expect(html).toContain(`id="home-graphic-gate"`);
    expect(html).toContain(t("home.graphicAvailability"));
  });

  test("Given Codex signed out When the slide tile renders Then it is not gated", () => {
    const slides = tile(renderHome("/", codexSignedOut), t("home.type.slide_deck"));
    expect(slides).not.toContain('aria-disabled="true"');
    expect(slides).not.toContain("aria-describedby");
  });

  test("Given the Home source When scanned Then the creation dialog returns focus to the element that opened it", async () => {
    const source = await Bun.file(new URL("../src/views/HomeView.tsx", import.meta.url)).text();
    expect(source).toContain("openerRef.current = document.activeElement instanceof HTMLElement");
    expect(source).toMatch(/onCloseAutoFocus=\{[^}]*openerRef\.current\?\.isConnected/);
  });
});

describe("empty examples action (UX-25)", () => {
  test("Given no example projects When the examples tab renders Then the empty state offers the restore action rather than creating a project", () => {
    const html = renderHome("/?view=examples", codexSignedOut);
    const action = html.match(/<button[^>]*data-qa="empty-action"[^>]*>[^<]*<\/button>/)?.[0] ?? "";
    expect(action).toContain(t("home.restoreExamples"));
    expect(action).not.toContain(t("home.createTitle"));
  });

  test("Given no projects When the section renders without a custom action Then the create action stays the default", () => {
    expect(section({}).match(/<button[^>]*data-qa="empty-action"[^>]*>[^<]*<\/button>/)?.[0]).toContain(t("home.createTitle"));
  });
});

describe("search count (UX-31)", () => {
  const card = (id: string) => ({ id, name: id, subtitle: "s", href: `/projects/${id}`, tintClass: "bg-tint-slate" });

  test("Given a non-empty query with matches When the section renders Then a status line reports the match count", () => {
    const html = section({ cards: [card("a"), card("b")], sourceCount: 13, query: "a" });
    expect(html).toContain(`role="status"`);
    expect(html).toContain(t("home.searchCount", { count: 2 }));
  });

  test("Given no query When the section renders Then no count line appears", () => {
    expect(section({ cards: [card("a")], sourceCount: 1, query: "" })).not.toContain(t("home.searchCount", { count: 1 }));
  });

  test("Given the Home source When scanned Then a search on the recent tab enables and reads the full project list", async () => {
    const source = await Bun.file(new URL("../src/views/HomeView.tsx", import.meta.url)).text();
    expect(source).toContain('projectSearchTab(activeTab, projectQuery) === "mine"');
  });
});

describe("creation dialog escape (UX-36)", () => {
  test("Given the system picker is open When Escape is pressed Then the dialog stays and steps back to the brief", () => {
    expect(creationEscapeAction({ creating: false, picking: true })).toBe("back");
  });

  test("Given a create in flight When Escape is pressed Then the dialog stays put", () => {
    expect(creationEscapeAction({ creating: true, picking: true })).toBe("stay");
    expect(creationEscapeAction({ creating: true, picking: false })).toBe("stay");
  });

  test("Given the brief form When Escape is pressed Then the dialog dismisses", () => {
    expect(creationEscapeAction({ creating: false, picking: false })).toBe("dismiss");
  });
});

describe("history and duplicate reporting (UX-09, UX-23)", () => {
  test("Given the Home source When scanned Then closing the creation dialog replaces the history entry instead of pushing one", async () => {
    const source = await Bun.file(new URL("../src/views/HomeView.tsx", import.meta.url)).text();
    const close = source.match(/const closeCreation = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
    expect(close).toContain("{ replace: true }");
  });

  test("Given the Home source When scanned Then a design-system import failure is reported inline only, never also as a toast", async () => {
    const source = await Bun.file(new URL("../src/views/HomeView.tsx", import.meta.url)).text();
    const mutation = source.match(/const importSystemMutation = useMutation\(\{[\s\S]*?\n  \}\);/)?.[0] ?? "";
    const onError = mutation.slice(mutation.indexOf("onError"));
    expect(onError).toContain("setSystemImportError(err)");
    expect(onError).not.toContain("pushToast");
  });
});
