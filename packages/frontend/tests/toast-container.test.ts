import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ToastContainer from "../src/components/errors/BackendCrashToast";
import { useUIStore, type Toast } from "../src/state/uiStore";
import { ApiError } from "../src/api/client";
import { apiErrorCopy } from "../src/lib/error-copy";
import { t } from "../src/i18n/t";

// The server renderer reads the store's initial snapshot, so the seed goes there and is reset afterwards.
function render(toasts: readonly Toast[]): string {
  Object.assign(useUIStore.getInitialState(), { toasts: [...toasts] });
  return renderToStaticMarkup(createElement(ToastContainer));
}

afterEach(() => { Object.assign(useUIStore.getInitialState(), { toasts: [] }); });

describe("toast container (UX-33, UX-23)", () => {
  test("Given an error toast When rendered Then it is an alert carrying the mapped error copy", () => {
    const body = apiErrorCopy(new ApiError("forbidden", "private", 403));
    const html = render([{ id: "1", title: "T", body, tone: "error" }]);
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html).toContain(body);
    expect(html).toContain(t("errors.forbidden"));
  });

  test("Given an info toast When rendered Then it is not an alert and the polite region still announces it", () => {
    const html = render([{ id: "1", title: "Queued", tone: "info" }]);
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('aria-live="polite"');
  });

  test("Given no toasts When rendered Then nothing is emitted", () => {
    expect(render([])).toBe("");
  });

  test("Given a narrow viewport When rendered Then the stack never exceeds the viewport and the close control has a usable hit area", () => {
    const html = render([{ id: "1", title: "T", tone: "warn" }]);
    expect(html).toContain("w-[min(20rem,calc(100vw-2rem))]");
    const close = html.match(new RegExp(`<button[^>]*aria-label="${t("shell.close")}"[^>]*>`))?.[0] ?? "";
    expect(close).toContain("min-h-9");
    expect(close).toContain("min-w-9");
  });

  test("Given a toast with an action When rendered Then the action label is a button", () => {
    const html = render([{ id: "1", title: "T", tone: "success", action: { label: "Open", onSelect() {} } }]);
    expect(html).toMatch(/<button[^>]*>Open<\/button>/);
  });
});
