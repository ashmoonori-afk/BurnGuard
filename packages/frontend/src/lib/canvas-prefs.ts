/** Canvas aids the user can switch off. Each is on until switched off and is remembered on this computer. */
export const CANVAS_MAGNET_PREF = "bg.canvas.magnet";
export type CanvasPrefKey = typeof CANVAS_MAGNET_PREF;
export type CanvasPrefStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): CanvasPrefStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch (error) {
    if (error instanceof DOMException) return null;
    throw error;
  }
}

/** Only an explicit "0" turns an aid off, so a blocked or empty storage leaves it on. */
export function readCanvasPref(key: CanvasPrefKey, storage: CanvasPrefStorage | null = browserStorage()): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(key) !== "0";
  } catch (error) {
    if (error instanceof DOMException) return true;
    throw error;
  }
}

/** A blocked or full storage costs the memory of the choice, never the toggle itself. */
export function writeCanvasPref(key: CanvasPrefKey, on: boolean, storage: CanvasPrefStorage | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(key, on ? "1" : "0");
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
  }
}
