/** Trailing "Design system" in any shipped language, with an optional separator before it. */
const REDUNDANT_SUFFIX = /\s*[-\u2013\u2014\u00b7:]?\s*(?:design\s*system|\ub514\uc790\uc778\s*\uc2dc\uc2a4\ud15c|\u8bbe\u8ba1\u7cfb\u7edf)\s*$/iu;

/** Display only: every system card already says "Design system" in its subtitle, so the name drops a repeated suffix. Stored names are untouched. */
export function systemDisplayName(name: string): string {
  const trimmed = name.trim();
  const stripped = trimmed.replace(REDUNDANT_SUFFIX, "").trim();
  return stripped.length > 0 ? stripped : trimmed;
}

/** First visible character of the display name, for the neutral placeholder. */
export function systemMonogram(name: string): string {
  const [first] = Array.from(systemDisplayName(name).trim());
  return first === undefined ? "?" : first.toLocaleUpperCase();
}

/** The reference system staged from the repository `design system sample/` directory. */
const NORTHVALE_ID = "northvale-capital";

/** Bundled themes, original samples and the reference system ship with the app; everything else was created or imported by the user. */
export function isBuiltInSystem(system: { readonly id: string; readonly is_template: boolean }): boolean {
  return system.is_template || system.id === NORTHVALE_ID || system.id.startsWith("builtin-theme-") || system.id.startsWith("sample-system-");
}
