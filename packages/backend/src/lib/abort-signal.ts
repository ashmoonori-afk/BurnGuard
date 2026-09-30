const armed = new WeakSet<AbortSignal>();
const standing = (): void => undefined;

/**
 * Bun 1.3.14 cancels the timer of an `AbortSignal.timeout()` signal when its last "abort" listener is removed
 * (measured: the signal then never aborts; Bun 1.4 fires). Code that listens on a caller's signal for one wait and
 * then stops listening would silently disarm the caller's deadline. One standing listener per signal keeps it
 * armed; it goes away when the signal aborts or is collected.
 */
export function keepAbortSignalArmed(signal: AbortSignal): void {
  if (signal.aborted || armed.has(signal)) return;
  armed.add(signal);
  signal.addEventListener("abort", standing, { once: true });
}
