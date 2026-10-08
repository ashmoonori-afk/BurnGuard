type UnloadTarget = Pick<Window, "addEventListener" | "removeEventListener">;

/** The browser shows its own leave-page prompt; the text it renders is not ours to set. */
function confirmLeave(event: Event): void {
  event.preventDefault();
  // Older Chromium and WebKit builds prompt only when returnValue is set.
  (event as BeforeUnloadEvent).returnValue = true;
}

/** Asks before the tab closes or reloads while a generation is running; returns the uninstaller. */
export function installLeaveGuard(target: UnloadTarget = window): () => void {
  target.addEventListener("beforeunload", confirmLeave);
  return () => target.removeEventListener("beforeunload", confirmLeave);
}
