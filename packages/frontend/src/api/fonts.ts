/** Bundled fonts are public, immutable assets; never send the launch capability. */
export function requestBundledFont(url: string): Promise<Response> {
  return fetch(url, { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15000) });
}
