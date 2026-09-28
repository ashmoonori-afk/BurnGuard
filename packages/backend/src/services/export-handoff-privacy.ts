const PRIVATE_PATH_SOURCE =
  String.raw`(?:file:\/\/\/)?(?:\/(?:Users|home|tmp|var\/folders)\/[^\s"'<>|)\]};,]+|[a-z]:\\Users\\[^\s"'<>|)\]};,]+)`;

export function isPrivatePath(value: string): boolean {
  return new RegExp(PRIVATE_PATH_SOURCE, "iu").test(value);
}

export function redactPrivatePaths(value: string): string {
  return value.replace(new RegExp(PRIVATE_PATH_SOURCE, "giu"), "<private-path>");
}

export function redactSensitiveText(value: string): string {
  return redactPrivatePaths(value).replace(
    /\b(token|secret|password|api[_-]?key)\s*=\s*[^\s),;]+/giu,
    "$1=<redacted>",
  );
}

export function safeHandoffTarget(target: string | null): string | null {
  if (target === null || isPrivatePath(target)) return null;
  const withoutPrivateQuery = target.split(/[?#]/u)[0] ?? "";
  if (withoutPrivateQuery === "") return target.startsWith("#") ? "#" : null;
  try {
    const url = new URL(withoutPrivateQuery);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch (error) {
    if (error instanceof TypeError) return withoutPrivateQuery;
    throw error;
  }
}
