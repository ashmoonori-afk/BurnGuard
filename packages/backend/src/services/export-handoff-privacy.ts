/**
 * One sanitizer for every user-derived string that reaches the handoff manifest, HANDOFF.md or
 * prompt.md. Every pattern is a linear character-class scan (no nested quantifiers), so hostile
 * artifact text cannot trigger catastrophic backtracking.
 */
function isControlCode(code: number): boolean {
  return code <= 0x1f || code === 0x7f;
}

function replaceControlCharacters(value: string): string {
  let result = "";
  for (const character of value) result += isControlCode(character.codePointAt(0) ?? 0) ? " " : character;
  return result;
}

const PATH_TAIL = String.raw`[^\s"'<>|)\]};,]*`;
// Paths that can never be an application route: file URIs, home-relative, drive-letter and UNC paths.
const UNAMBIGUOUS_PATH = new RegExp(
  [
    String.raw`file:\/{2,3}${PATH_TAIL}`,
    String.raw`(?<![\w.-])~\/${PATH_TAIL}`,
    String.raw`\b[a-z]:[\\/]${PATH_TAIL}`,
    String.raw`\\\\[^\s"'<>|)\]};,]+`,
  ].join("|"),
  "giu",
);
// In free text, a standalone multi-segment absolute POSIX path (not part of a URL or relative path).
const POSIX_MULTI_SEGMENT = /(?<![\w.:/~-])\/[^\s"'<>|)\]};,/]+\/[^\s"'<>|)\]};,]*/gu;
const QUOTED_ABSOLUTE = /(["'])(?:\/|~\/|[a-z]:[\\/]|\\\\)[^"'\n]{0,512}\1/giu;
const SECRET_ASSIGNMENT =
  /\b(token|secret|password|passwd|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key|authorization)(\s*[:=]\s*)(?!<redacted>)("[^"]*"|'[^']*'|[^\s),;&]+)/giu;
const BEARER = /\bBearer\s+(?!<redacted>)[\w.~+/=-]+/giu;
const KNOWN_SECRET =
  /\b(?:sk-[\w-]{16,}|gh[pousr]_\w{20,}|github_pat_\w{20,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|figd_[\w-]{20,}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,})/gu;

export const HANDOFF_TEXT_LIMIT = 200;

function redactSecrets(value: string): string {
  return value
    .replace(BEARER, "Bearer <redacted>")
    .replace(KNOWN_SECRET, "<redacted>")
    .replace(SECRET_ASSIGNMENT, "$1$2<redacted>");
}

function collapse(value: string, limit: number): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, limit);
}

export function sanitizeHandoffText(value: string, limit = HANDOFF_TEXT_LIMIT): string {
  const withoutPaths = replaceControlCharacters(value)
    .replace(QUOTED_ABSOLUTE, "$1<private-path>$1")
    .replace(UNAMBIGUOUS_PATH, "<private-path>")
    .replace(POSIX_MULTI_SEGMENT, "<private-path>");
  return collapse(redactSecrets(withoutPaths), limit);
}

export function sanitizeNullableHandoffText(value: string | null | undefined, limit?: number): string | null {
  if (value === null || value === undefined) return null;
  const sanitized = sanitizeHandoffText(value, limit);
  return sanitized === "" ? null : sanitized;
}

/** Routes and link targets are structured values: secrets are redacted, but route paths are kept. */
export function sanitizeHandoffRoute(value: string, limit = HANDOFF_TEXT_LIMIT): string {
  return collapse(redactSecrets(replaceControlCharacters(value)), limit);
}

export function containsSensitiveHandoffText(value: string): boolean {
  return [UNAMBIGUOUS_PATH, BEARER, KNOWN_SECRET, SECRET_ASSIGNMENT].some((pattern) => {
    pattern.lastIndex = 0;
    const found = pattern.test(value);
    pattern.lastIndex = 0;
    return found;
  }) || [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return isControlCode(code) && code !== 0x09 && code !== 0x0a && code !== 0x0d;
  });
}

function isUnambiguousPath(value: string): boolean {
  UNAMBIGUOUS_PATH.lastIndex = 0;
  const found = UNAMBIGUOUS_PATH.test(value);
  UNAMBIGUOUS_PATH.lastIndex = 0;
  return found;
}

export function safeHandoffTarget(target: string | null): string | null {
  if (target === null || isUnambiguousPath(target)) return null;
  const withoutQuery = target.split(/[?#]/u)[0] ?? "";
  if (withoutQuery === "") return target.startsWith("#") ? "#" : null;
  if (/^[a-z][a-z\d+.-]*:/iu.test(withoutQuery)) {
    try {
      const url = new URL(withoutQuery);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return nullIfEmpty(sanitizeHandoffRoute(`${url.protocol}//${url.host}${url.pathname}`));
    } catch (error) {
      if (error instanceof TypeError) return null;
      throw error;
    }
  }
  return nullIfEmpty(sanitizeHandoffRoute(withoutQuery));
}

function nullIfEmpty(value: string): string | null {
  return value === "" || value.includes("<redacted>") ? null : value;
}
