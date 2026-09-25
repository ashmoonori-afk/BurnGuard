/** AbortSignal.any shipped in WebKit 17.4; the macOS 14.0-14.3 WKWebView lacks it. */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller = new AbortController();
  const aborted = signals.find(signal => signal.aborted);
  if (aborted) controller.abort(aborted.reason);
  else for (const signal of signals) signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true, signal: controller.signal });
  return controller.signal;
}
