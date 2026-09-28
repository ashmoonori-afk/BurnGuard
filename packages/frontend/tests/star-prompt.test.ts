import { afterEach, describe, expect, test } from "bun:test";
import {
  claimStarPrompt,
  countsAsStarExport,
  hasOpenModal,
  OPEN_MODAL_SELECTOR,
  STAR_PROMPT_STORAGE_KEY,
  type StarPromptStorage,
} from "../src/lib/star-prompt";
import { useUIStore } from "../src/state/uiStore";

function memoryStorage(initial: Record<string, string> = {}): StarPromptStorage & { readonly values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

function blockedStorage(error: Error): StarPromptStorage {
  return {
    getItem: () => { throw error; },
    setItem: () => { throw error; },
  };
}

const store = () => useUIStore.getState();

afterEach(() => useUIStore.setState({ starPromptOwed: false, starPromptOpen: false }));

describe("one-time star prompt", () => {
  test("Given no earlier prompt When the first export succeeds with no modal open Then the prompt opens once and later successes keep it closed", () => {
    const storage = memoryStorage();
    store().oweStarPrompt();
    store().revealStarPrompt(() => storage, false);
    expect(store().starPromptOpen).toBe(true);
    expect(storage.values.get(STAR_PROMPT_STORAGE_KEY)).toBe("shown");

    store().dismissStarPrompt();
    store().oweStarPrompt();
    store().revealStarPrompt(() => storage, false);
    expect(store().starPromptOpen).toBe(false);
    expect(store().starPromptOwed).toBe(false);
  });

  test("Given an owed prompt When a modal menu or dialog is open Then nothing is claimed until it closes", () => {
    const storage = memoryStorage();
    store().oweStarPrompt();
    store().revealStarPrompt(() => storage, true);
    expect(store().starPromptOpen).toBe(false);
    expect(store().starPromptOwed).toBe(true);
    expect(storage.values.has(STAR_PROMPT_STORAGE_KEY)).toBe(false);

    store().revealStarPrompt(() => storage, false);
    expect(store().starPromptOpen).toBe(true);
  });

  test("Given the share dialog flow When its preparatory export succeeds and then publishing succeeds Then only the publish owes the prompt and it waits for the dialog to close", () => {
    const storage = memoryStorage();
    const preparatory = { options: { skip_quality_check: true } };
    if (countsAsStarExport(preparatory)) store().oweStarPrompt();
    expect(store().starPromptOwed).toBe(false);

    store().oweStarPrompt();
    store().revealStarPrompt(() => storage, true);
    expect(store().starPromptOpen).toBe(false);
    store().revealStarPrompt(() => storage, false);
    expect(store().starPromptOpen).toBe(true);
  });

  test("Given ordinary exports When classified Then they count toward the prompt", () => {
    expect(countsAsStarExport({ options: {} })).toBe(true);
    expect(countsAsStarExport({ options: { skip_quality_check: false } })).toBe(true);
  });

  test("Given a document When modal state is read Then only open Radix menus and dialogs count", () => {
    const selectors: string[] = [];
    const root = (found: boolean) => ({ querySelector: (selector: string) => { selectors.push(selector); return found ? ({} as Element) : null; } });
    expect(hasOpenModal(root(true))).toBe(true);
    expect(hasOpenModal(root(false))).toBe(false);
    expect(selectors).toEqual([OPEN_MODAL_SELECTOR, OPEN_MODAL_SELECTOR]);
    for (const role of ["menu", "dialog", "alertdialog"]) expect(OPEN_MODAL_SELECTOR).toContain(`[role="${role}"][data-state="open"]`);
  });

  test("Given a dismissed prompt When the app starts again with the same storage Then a new success does not reopen it", () => {
    const storage = memoryStorage();
    store().oweStarPrompt();
    store().revealStarPrompt(() => storage, false);
    store().dismissStarPrompt();

    const relaunched = memoryStorage(Object.fromEntries(storage.values));
    store().oweStarPrompt();
    store().revealStarPrompt(() => relaunched, false);
    expect(store().starPromptOpen).toBe(false);
  });

  test("Given a prompt shown but never dismissed When the app starts again Then it is not shown again", () => {
    const storage = memoryStorage();
    expect(claimStarPrompt(() => storage)).toBe(true);
    expect(claimStarPrompt(() => memoryStorage(Object.fromEntries(storage.values)))).toBe(false);
  });

  test("Given blocked storage When a success is reported Then the prompt stays closed; other errors are not swallowed", () => {
    store().oweStarPrompt();
    store().revealStarPrompt(() => blockedStorage(new DOMException("blocked", "SecurityError")), false);
    expect(store().starPromptOpen).toBe(false);
    expect(claimStarPrompt(() => { throw new DOMException("blocked", "SecurityError"); })).toBe(false);
    expect(() => claimStarPrompt(() => blockedStorage(new TypeError("broken")))).toThrow(TypeError);
  });

  test("Given the prompt sources When scanned Then nothing is sent over the network", async () => {
    const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
    for (const source of [await read("../src/components/layout/StarPrompt.tsx"), await read("../src/lib/star-prompt.ts")]) {
      expect(source).not.toMatch(/\bfetch\(|apiFetch|sendBeacon|XMLHttpRequest/);
    }
  });
});
