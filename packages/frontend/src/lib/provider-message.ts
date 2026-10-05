const PRIVATE_PATH = "[private-path]";
const INTERNAL_DIRECTORIES = new Set([".meta", ".attachments", ".burnguard-inputs", ".git", ".omc", ".claude", ".codex"]);

/**
 * Provider links name the editable stage, not the published project. Resolve them at the
 * display boundary, after deltas are joined, so reopened history and split links are safe too.
 * This produces labels only; it never grants filesystem access.
 */
export function providerMessageText(text: string, projectDir?: string): string {
  const localReference = (target: string): string => {
    let candidate = target.replace(/^<|>$/gu, "").trim();
    try { candidate = decodeURIComponent(candidate); }
    catch { return PRIVATE_PATH; }
    candidate = candidate.replace(/^file:\/\/(?:localhost)?/iu, "").replace(/^\/([a-z]:\/)/iu, "$1");
    candidate = candidate.replaceAll("\\", "/").normalize("NFC");
    const root = projectDir?.replaceAll("\\", "/").normalize("NFC").replace(/\/+$/u, "");
    const absolute = /^(?:\/|[a-z]:\/)/iu.test(candidate);
    if (absolute) {
      if (!root) return PRIVATE_PATH;
      const prefix = `${root}/`;
      const windows = /^[a-z]:\//iu.test(root) || root.startsWith("//");
      if (!(windows ? candidate.toLowerCase().startsWith(prefix.toLowerCase()) : candidate.startsWith(prefix))) return PRIVATE_PATH;
      candidate = candidate.slice(prefix.length);
    }
    candidate = candidate.replace(/^\.meta\/artifact-operations\/[A-Za-z0-9_-]+\/stage\//u, "");
    candidate = candidate.replace(/(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)$/u, "");
    const segments = candidate.split("/");
    if (!candidate || segments.some((segment) => !segment || segment === "." || segment === ".." || INTERNAL_DIRECTORIES.has(segment.toLowerCase())) || candidate.includes(":") || [...candidate].some((character) => character.charCodeAt(0) < 32)) return PRIVATE_PATH;
    return candidate;
  };

  // Consume a whole destination (including spaces) and do not trust the provider's label.
  let safe = text.replace(/\[([^\]\n]*)\]\((<[^>\n]*>|[^)\n]*)\)/gu, (link, _label: string, target: string) =>
    /^(?:https?:|mailto:)/iu.test(target) ? link : localReference(target));
  // A streaming destination is not complete yet. Hide it before any private prefix can appear.
  safe = safe.replace(/\[([^\]\n]*)\]\([^)\n]*$/gu, PRIVATE_PATH);
  // Quoted paths can contain spaces; bare paths end at whitespace or a prose delimiter.
  safe = safe.replace(/([`"'])(file:\/\/[^`"'\n]*|[a-z]:[\\/][^`"'\n]*|\/[^`"'\n]*|\\\\[^`"'\n]*)\1/giu,
    (_match, _quote: string, target: string) => localReference(target));
  safe = safe.replace(/(^|[\s[(<=>])((?:file:\/\/\/|[a-z]:[\\/]|\\\\|\/)[^\s<>)\]`"',;]*)/giu,
    (_match, before: string, target: string) => before + localReference(target));
  // Relative staging references are private too, even when no absolute root was included.
  return safe.replace(/(?:\.meta|\.burnguard-inputs|\.attachments)[\\/][^\s<>)\]`"',;]*/gu,
    (target) => localReference(target));
}
