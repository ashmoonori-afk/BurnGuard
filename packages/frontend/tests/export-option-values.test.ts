import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_EXPORT_OPTION_VALUES, type ExportOptionValues } from "../src/components/export/export-options";
import { useExportOptionValues } from "../src/components/export/useExportOptionValues";

type Rendered = { readonly values: ExportOptionValues; readonly update: (next: ExportOptionValues) => void };

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

function installStorage(storage: () => Pick<Storage, "getItem" | "setItem">): void {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { get localStorage() { return storage(); } } });
}

function renderOptionValues(projectId: string): Rendered {
  const seen: { current?: Rendered } = {};
  function Probe() {
    const [values, update] = useExportOptionValues(projectId);
    seen.current = { values, update };
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  if (seen.current === undefined) throw new TypeError("the probe did not render");
  return seen.current;
}

afterEach(() => {
  if (originalWindow === undefined) Reflect.deleteProperty(globalThis, "window");
  else Object.defineProperty(globalThis, "window", originalWindow);
});

describe("export option draft storage", () => {
  test("Given site data is blocked so the localStorage getter throws SecurityError When the export options render Then the defaults are used instead of throwing", () => {
    installStorage(() => { throw new DOMException("Access is denied for this document.", "SecurityError"); });

    expect(renderOptionValues("project-1").values).toEqual(DEFAULT_EXPORT_OPTION_VALUES);
  });

  test("Given storage is full When an option is edited Then no error escapes the change handler", () => {
    installStorage(() => ({
      getItem: () => null,
      setItem: () => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); },
    }));
    const { update } = renderOptionValues("project-1");

    expect(() => update({ ...DEFAULT_EXPORT_OPTION_VALUES, assetBaseUrl: "/web/upload/burnguard/spring/" })).not.toThrow();
  });

  test("Given a stored draft When the export options render Then the entered values return", () => {
    const stored = { ...DEFAULT_EXPORT_OPTION_VALUES, assetBaseUrl: "https://cdn.example.com/burnguard/" };
    installStorage(() => ({ getItem: (key) => key === "bg.export-options.project-1" ? JSON.stringify(stored) : null, setItem: () => {} }));

    expect(renderOptionValues("project-1").values).toEqual(stored);
  });
});
