import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "../src/api/client";
import { busyDialogProps } from "../src/components/ui/dialog";
import { ProjectImportForm, projectImportErrorCopy } from "../src/components/home/ProjectImportDialog";
import { PINTEREST_PIN_LIMIT, PinterestImportForm, pinterestErrorCopy, pinterestSubmitState } from "../src/components/home/PinterestImportDialog";
import { t } from "../src/i18n/t";

const importForm = (props: Partial<Parameters<typeof ProjectImportForm>[0]> = {}) => renderToStaticMarkup(createElement(ProjectImportForm, {
  name: "", source: "zip", files: [], pending: false, error: null, onNameChange() {}, onSourceChange() {}, onFilesChange() {}, onSubmit() {}, ...props,
}));
const pinterestForm = (props: Partial<Parameters<typeof PinterestImportForm>[0]> = {}) => renderToStaticMarkup(createElement(PinterestImportForm, {
  name: "", urls: "", pending: false, error: null, onNameChange() {}, onUrlsChange() {}, onSubmit() {}, onCancel() {}, ...props,
}));
const submit = (html: string) => html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? "";
const alert = (html: string) => html.match(/<p[^>]*role="alert"[^>]*>([^<]*)<\/p>/)?.[1] ?? null;

describe("project import error copy (UX-11)", () => {
  test("Given a raw fetch failure When mapped Then the connection copy is shown, not the ZIP advice", () => {
    expect(projectImportErrorCopy(new TypeError("fetch failed"))).toBe(t("errors.network_error"));
  });

  test("Given an expired capability When mapped Then the forbidden copy is shown", () => {
    expect(projectImportErrorCopy(new ApiError("forbidden", "private", 403))).toBe(t("errors.forbidden"));
  });

  test("Given an unusable project file When mapped Then the ZIP advice is kept", () => {
    expect(projectImportErrorCopy(new ApiError("invalid_project_import", "private", 400))).toBe(t("home.projectImport.error"));
  });

  test("Given the import-specific codes When mapped Then their own copy is kept", () => {
    expect(projectImportErrorCopy(new ApiError("project_import_limit", "private", 413))).toBe(t("home.projectImport.limitError"));
    expect(projectImportErrorCopy(new ApiError("payload_too_large", "private", 413))).toBe(t("home.projectImport.limitError"));
    expect(projectImportErrorCopy(new ApiError("project_import_entrypoint", "private", 400))).toBe(t("home.projectImport.entryError"));
  });

  test("Given a failed import When the form renders Then the alert carries the mapped copy", () => {
    expect(alert(importForm({ files: [new File(["x"], "site.zip")], name: "n", error: new ApiError("forbidden", "private", 403) }))).toBe(t("errors.forbidden"));
  });
});

describe("Pinterest import limits and copy (UX-12)", () => {
  const urls = (count: number) => Array.from({ length: count }, (_, index) => `https://www.pinterest.com/pin/${index + 1}/`).join("\n");

  test("Given more pins than the limit When eligibility is derived Then submit is refused with the too-many reason", () => {
    const state = pinterestSubmitState(urls(PINTEREST_PIN_LIMIT + 1));
    expect(state.count).toBe(PINTEREST_PIN_LIMIT + 1);
    expect(state.canSubmit).toBe(false);
    expect(state.reason).toBe("home.pinterest.tooMany");
  });

  test("Given the limit exactly, blank lines included When eligibility is derived Then submit is allowed", () => {
    const state = pinterestSubmitState(`\n${urls(PINTEREST_PIN_LIMIT)}\n\n`);
    expect(state.count).toBe(PINTEREST_PIN_LIMIT);
    expect(state.canSubmit).toBe(true);
    expect(state.reason).toBeNull();
  });

  test("Given no pins When eligibility is derived Then submit is disabled without a reason", () => {
    expect(pinterestSubmitState("  \n ")).toEqual({ count: 0, canSubmit: false, reason: null });
  });

  test("Given a timeout When mapped Then the timeout copy is shown instead of the pin advice", () => {
    expect(pinterestErrorCopy(new ApiError("acquisition_timeout", "private", 408))).toBe(t("errors.acquisition_timeout"));
    expect(pinterestErrorCopy(new TypeError("fetch failed"))).toBe(t("errors.network_error"));
  });

  test("Given a pin problem When mapped Then the pin advice stays", () => {
    expect(pinterestErrorCopy(new ApiError("invalid_pinterest_request", "private", 400))).toBe(t("home.pinterest.error"));
    expect(pinterestErrorCopy(new ApiError("pinterest_unavailable", "private", 400))).toBe(t("home.pinterest.error"));
  });

  test("Given too many pins When the form renders Then the create button is disabled and the status names the limit", () => {
    const html = pinterestForm({ urls: urls(PINTEREST_PIN_LIMIT + 1) });
    expect(html.match(/<button[^>]*data-qa="pinterest-create"[^>]*>/)?.[0]).toContain('disabled=""');
    expect(html).toContain(t("home.pinterest.tooMany", { count: PINTEREST_PIN_LIMIT }));
  });
});

describe("busy dialogs (UX-29)", () => {
  test("Given work in flight When the dialog props are derived Then the close control hides and Escape and outside clicks are cancelled", () => {
    const props = busyDialogProps(true);
    let prevented = 0;
    const event = { preventDefault() { prevented += 1; } };
    props.onEscapeKeyDown(event);
    props.onInteractOutside(event);
    expect(props.hideClose).toBe(true);
    expect(prevented).toBe(2);
  });

  test("Given settled work When the dialog props are derived Then the close control shows and dismissal proceeds", () => {
    const props = busyDialogProps(false);
    let prevented = 0;
    const event = { preventDefault() { prevented += 1; } };
    props.onEscapeKeyDown(event);
    props.onInteractOutside(event);
    expect(props.hideClose).toBe(false);
    expect(prevented).toBe(0);
  });

  test("Given the three dialogs When scanned Then each spreads the busy props onto its content", async () => {
    for (const file of ["settings/SettingsModal.tsx", "home/ProjectImportDialog.tsx", "home/PinterestImportDialog.tsx"]) {
      const source = await Bun.file(new URL(`../src/components/${file}`, import.meta.url)).text();
      expect(source, file).toContain("{...busyDialogProps(");
    }
  });
});

describe("import dialog bodies (UX-33)", () => {
  test("Given nothing selected When the project import form renders Then submit is disabled and no alert shows", () => {
    const html = importForm();
    expect(submit(html)).toContain('disabled=""');
    expect(alert(html)).toBeNull();
    expect(html).toContain(t("home.projectImport.open"));
  });

  test("Given a named ZIP within limits When the project import form renders Then submit is enabled", () => {
    expect(submit(importForm({ files: [new File(["x"], "site.zip")], name: "사이트" }))).not.toContain('disabled=""');
  });

  test("Given an oversized selection When the project import form renders Then the limit copy shows and submit is disabled", () => {
    const html = importForm({ files: [new File([new Uint8Array(1)], "big.zip")], name: "n", oversized: true });
    expect(submit(html)).toContain('disabled=""');
    expect(alert(html)).toBe(t("home.projectImport.limitError"));
  });

  test("Given an import in flight When the project import form renders Then the pending label shows and the fields are disabled", () => {
    const html = importForm({ files: [new File(["x"], "site.zip")], name: "n", pending: true });
    expect(html).toContain(t("home.projectImport.pending"));
    expect(html.match(/<input[^>]*maxlength="200"[^>]*>/i)?.[0] ?? "").toContain('disabled=""');
  });

  test("Given a failed pin fetch When the Pinterest form renders Then the alert carries the mapped copy", () => {
    expect(alert(pinterestForm({ urls: "https://www.pinterest.com/pin/1/", error: new ApiError("acquisition_timeout", "private", 408) }))).toBe(t("errors.acquisition_timeout"));
  });

  test("Given one pin When the Pinterest form renders Then the create button is enabled and labelled", () => {
    const html = pinterestForm({ urls: "https://www.pinterest.com/pin/1/" });
    const create = html.match(/<button[^>]*data-qa="pinterest-create"[^>]*>[^<]*<\/button>/)?.[0] ?? "";
    expect(create).not.toContain('disabled=""');
    expect(create).toContain(t("home.pinterest.create"));
  });
});
