/**
 * The one pypdf release BurnGuard has reviewed for untrusted PDF uploads.
 * `requirements.txt`, the in-app installer and the embedded extractor script
 * all derive their pin from this value; older releases carry malformed-PDF
 * resource-exhaustion advisories and are refused before any page is parsed.
 */
export const PYPDF_REQUIRED_VERSION = "6.18.0";

function numericParts(version: string): readonly number[] | null {
  const match = /^(\d+(?:\.\d+)*)/.exec(version.trim());
  if (match?.[1] === undefined) return null;
  return match[1].split(".").map((part) => Number.parseInt(part, 10));
}

/** True when `version` is the required release or a newer one. */
export function isSupportedPypdfVersion(version: string | null): boolean {
  if (version === null) return false;
  const installed = numericParts(version);
  if (installed === null) return false;
  const required = numericParts(PYPDF_REQUIRED_VERSION) ?? [];
  const length = Math.max(installed.length, required.length);
  for (let index = 0; index < length; index += 1) {
    const left = installed[index] ?? 0;
    const right = required[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}
