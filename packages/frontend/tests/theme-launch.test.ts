import { afterEach, describe, expect, test } from "bun:test";
import { THEME_STORAGE_KEY, applyLaunchTheme, applyTheme, readCachedTheme } from "../src/hooks/useTheme";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");

function install(storage: Pick<Storage, "getItem" | "setItem"> | (() => never)): { readonly dataset: Record<string, string | undefined> } {
  const dataset: Record<string, string | undefined> = {};
  Object.defineProperty(globalThis, "window", { configurable: true, value: { get localStorage() { return typeof storage === "function" ? storage() : storage; } } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { dataset } } });
  return { dataset };
}

afterEach(() => {
  for (const [name, descriptor] of [["window", originalWindow], ["document", originalDocument]] as const) {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
    else Object.defineProperty(globalThis, name, descriptor);
  }
});

describe("launch theme (UX-08)", () => {
  test("Given a cached dark theme When the entry applies it before the first render Then the root carries the dark attribute", () => {
    const { dataset } = install({ getItem: (key) => key === THEME_STORAGE_KEY ? "dark" : null, setItem() {} });
    applyLaunchTheme();
    expect(dataset["theme"]).toBe("dark");
  });

  test("Given no cache or an unknown cached value When read Then nothing is applied and the server value stays authoritative", () => {
    const { dataset } = install({ getItem: () => "sepia", setItem() {} });
    expect(readCachedTheme()).toBeNull();
    applyLaunchTheme();
    expect(dataset["theme"]).toBeUndefined();
  });

  test("Given blocked storage When the cache is read Then the launch continues without a theme", () => {
    const { dataset } = install(() => { throw new DOMException("Access is denied for this document.", "SecurityError"); });
    expect(readCachedTheme()).toBeNull();
    applyLaunchTheme();
    expect(dataset["theme"]).toBeUndefined();
  });

  test("Given the resolved server theme When applied Then the root and the cache both carry it", () => {
    const written: string[] = [];
    const { dataset } = install({ getItem: () => null, setItem: (key, value) => { written.push(`${key}=${value}`); } });
    applyTheme("dark");
    expect(dataset["theme"]).toBe("dark");
    expect(written).toEqual([`${THEME_STORAGE_KEY}=dark`]);
  });

  test("Given the theme hook source When scanned Then it never paints the light default before the settings arrive", async () => {
    const source = await Bun.file(new URL("../src/hooks/useTheme.ts", import.meta.url)).text();
    expect(source).not.toContain('?? "light"');
    expect(source).toContain("applyTheme(");
  });
});
