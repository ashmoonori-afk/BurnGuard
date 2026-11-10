import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CanvasTopBar from "../src/components/canvas/CanvasTopBar";
import { CANVAS_MAGNET_PREF, readCanvasPref, writeCanvasPref, type CanvasPrefStorage } from "../src/lib/canvas-prefs";
import { useUIStore } from "../src/state/uiStore";

function memoryStorage(): CanvasPrefStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

test("Given no stored choice When the magnet preference is read Then it is on", () => {
  expect(readCanvasPref(CANVAS_MAGNET_PREF, memoryStorage())).toBe(true);
  expect(readCanvasPref(CANVAS_MAGNET_PREF, null)).toBe(true);
});

test("Given the magnet is switched off When a fresh read follows Then the stored 0 turns it off, and switching it on stores 1", () => {
  const storage = memoryStorage();
  writeCanvasPref(CANVAS_MAGNET_PREF, false, storage);
  expect(storage.values.get("bg.canvas.magnet")).toBe("0");
  expect(readCanvasPref(CANVAS_MAGNET_PREF, storage)).toBe(false);
  writeCanvasPref(CANVAS_MAGNET_PREF, true, storage);
  expect(storage.values.get("bg.canvas.magnet")).toBe("1");
  expect(readCanvasPref(CANVAS_MAGNET_PREF, storage)).toBe(true);
});

test("Given blocked storage When the preference is read or written Then the magnet stays usable, and other failures surface", () => {
  const blocked: CanvasPrefStorage = { getItem() { throw new DOMException("blocked", "SecurityError"); }, setItem() { throw new DOMException("full", "QuotaExceededError"); } };
  expect(readCanvasPref(CANVAS_MAGNET_PREF, blocked)).toBe(true);
  expect(() => writeCanvasPref(CANVAS_MAGNET_PREF, false, blocked)).not.toThrow();
  const broken: CanvasPrefStorage = { getItem() { throw new TypeError("bug"); }, setItem() { throw new TypeError("bug"); } };
  expect(() => readCanvasPref(CANVAS_MAGNET_PREF, broken)).toThrow(TypeError);
  expect(() => writeCanvasPref(CANVAS_MAGNET_PREF, false, broken)).toThrow(TypeError);
});

test("Given the UI store When the magnet is toggled Then the state follows and starts on", () => {
  expect(useUIStore.getState().canvasMagnet).toBe(true);
  useUIStore.getState().setCanvasMagnet(false);
  expect(useUIStore.getState().canvasMagnet).toBe(false);
  useUIStore.getState().setCanvasMagnet(true);
  expect(useUIStore.getState().canvasMagnet).toBe(true);
});

test("Given the canvas top bar When the magnet handler is present Then one pressed-state toggle renders in the alignment group", () => {
  const bar = (props: { magnet?: boolean; onMagnetChange?: (on: boolean) => void }) => renderToStaticMarkup(createElement(CanvasTopBar, { mode: "tweaks", onModeChange() {}, onRefresh() {}, ...props }));
  const group = (html: string) => html.match(/<div data-toolbar-item="assist"[\s\S]*?<\/button>/)?.[0] ?? "";
  expect(group(bar({ magnet: true, onMagnetChange() {} }))).toContain('aria-pressed="true"');
  expect(group(bar({ magnet: false, onMagnetChange() {} }))).toContain('aria-pressed="false"');
  expect(bar({})).not.toContain('data-toolbar-item="assist"');
});
