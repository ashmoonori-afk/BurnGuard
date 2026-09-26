import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BackendDetectionResult, ProjectType } from "@bg/shared";
import NewProjectPanel from "../src/components/home/NewProjectPanel";
import { ApiError } from "../src/api/client";
import { CREATION_DRAFT_KEY, serializeCreationDraft } from "../src/lib/creation-draft";
import { INITIAL_BRIEF_FORM } from "../src/lib/project-creation";
import { apiErrorCopy } from "../src/lib/error-copy";
import { t } from "../src/i18n/t";

const detection: BackendDetectionResult = { backends: [{ id: "claude-code", found: true }, { id: "codex", found: false }] };
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

function renderPanel(type: ProjectType, seed: BackendDetectionResult | ApiError | null): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  if (seed instanceof ApiError) client.getQueryCache().build(client, { queryKey: ["backends", "detect"] }).setState({ status: "error", error: seed, fetchStatus: "idle" });
  else if (seed !== null) client.setQueryData(["backends", "detect"], seed);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(NewProjectPanel, {
    type, designSystems: [], defaultBackend: "claude-code", systemsLoading: false, systemsError: null, onRetrySystems() {}, onCreated() {},
  })));
}

function storeDraft(type: ProjectType, draft: Partial<typeof INITIAL_BRIEF_FORM>): void {
  const stored = new Map([[CREATION_DRAFT_KEY(type), serializeCreationDraft({ ...INITIAL_BRIEF_FORM, ...draft })]]);
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem() {}, removeItem() {} } } });
}

const submit = (html: string) => html.match(/<button[^>]*data-qa="creation-submit"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
const backendSelect = (html: string) => html.match(/<select id="creation-backend"[^>]*>[\s\S]*?<\/select>/)?.[0] ?? "";

const originalError = console.error;
beforeAll(() => { console.error = (...args: unknown[]) => { if (!String(args[0]).includes("useLayoutEffect")) originalError(...args); }; });
afterAll(() => { console.error = originalError; });
afterEach(() => {
  if (originalWindow === undefined) Reflect.deleteProperty(globalThis, "window");
  else Object.defineProperty(globalThis, "window", originalWindow);
});

describe("creation panel smoke (UX-33)", () => {
  test("Given an empty draft When the panel renders Then the submit control is disabled and the readiness line names the missing name", () => {
    const html = renderPanel("slide_deck", detection);
    expect(submit(html)).toContain('disabled=""');
    expect(html).toContain(t("home.problem.name"));
    expect(html).toContain('id="project-name"');
  });

  test("Given a complete draft When the panel renders Then submit is enabled and leads to the system choice", () => {
    storeDraft("slide_deck", { name: "분기 리뷰 덱", audience: "투자 심사역", objective: "투자 유치 승인" });
    const html = renderPanel("slide_deck", detection);
    expect(submit(html)).not.toContain('disabled=""');
    expect(submit(html)).toContain(t("home.picker.next"));
    expect(html).toContain(t("home.creation.ready"));
  });

  test("Given a slide deck When the brief renders Then the output sizes exclude responsive and the sources exclude template", () => {
    const html = renderPanel("slide_deck", detection);
    const size = html.match(/<select id="brief-output-size"[^>]*>[\s\S]*?<\/select>/)?.[0] ?? "";
    const source = html.match(/<select id="brief-content-source"[^>]*>[\s\S]*?<\/select>/)?.[0] ?? "";
    expect(size).not.toContain('value="responsive"');
    expect(size).toContain('value="a4"');
    expect(source).not.toContain('value="template"');
    expect(source).not.toContain('value="existing_files"');
  });
});

describe("creation panel backend state (UX-05)", () => {
  test("Given detection data When the panel renders Then exactly the reported backends are listed and the missing one is disabled", () => {
    const select = backendSelect(renderPanel("slide_deck", detection));
    expect(select.match(/<option/g)).toHaveLength(2);
    expect(select).toContain('value="codex" disabled=""');
    expect(select).not.toContain('disabled=""><option');
  });

  test("Given detection pending When the panel renders Then the select is disabled with the checking placeholder", () => {
    const select = backendSelect(renderPanel("slide_deck", null));
    expect(select).toContain('disabled=""');
    expect(select).toContain(t("home.creation.detecting"));
    expect(select).not.toContain('value="claude-code"');
  });

  test("Given detection failed When the panel renders Then no backend is invented and the failure copy offers a retry", () => {
    const error = new ApiError("codex_authentication_probe_failed", "private", 503);
    const html = renderPanel("slide_deck", error);
    const select = backendSelect(html);
    expect(select).toContain('disabled=""');
    expect(select).toContain(t("home.creation.detectionFailed"));
    expect(select).not.toContain('value="codex"');
    const alert = html.match(/<p[^>]*role="alert"[^>]*>[\s\S]*?<\/p>/)?.[0] ?? "";
    expect(alert).toContain(apiErrorCopy(error));
    expect(alert).toContain(`>${t("home.retry")}</button>`);
  });
});
