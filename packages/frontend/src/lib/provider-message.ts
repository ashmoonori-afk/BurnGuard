const PRIVATE_PATH = "[private-path]";
const INTERNAL_DIRECTORIES = new Set([".meta", ".attachments", ".burnguard-inputs", ".git", ".omc", ".claude", ".codex"]);

/**
 * Provider links name the editable stage, not the published project. Resolve them at the
 * display boundary, after deltas are joined, so reopened history and split links are safe too.
 * This produces labels only; it never grants filesystem access.
 */
export function providerMessageText(text: string, projectDir?: string): string {
  const root = projectDir?.replaceAll("\\", "/").normalize("NFC").replace(/\/+$/u, "");
  const windows = root !== undefined && (/^[a-z]:\//iu.test(root) || root.startsWith("//"));
  const localReference = (target: string): string => {
    let candidate = target.replace(/^<|>$/gu, "").trim();
    try { candidate = decodeURIComponent(candidate); }
    catch { return PRIVATE_PATH; }
    candidate = candidate.replace(/^file:\/\/(?:localhost)?/iu, "").replace(/^\/([a-z]:\/)/iu, "$1");
    const windowsPath = windows || candidate.includes("\\");
    candidate = candidate.replaceAll("\\", "/").normalize("NFC");
    const absolute = /^(?:\/|[a-z]:\/)/iu.test(candidate);
    if (absolute) {
      if (!root) return PRIVATE_PATH;
      const prefix = `${root}/`;
      if (!(windows ? candidate.toLowerCase().startsWith(prefix.toLowerCase()) : candidate.startsWith(prefix))) return PRIVATE_PATH;
      candidate = candidate.slice(prefix.length);
    }
    candidate = candidate.replace(new RegExp(String.raw`^\.meta/artifact-operations/[A-Za-z0-9_-]+/stage/`, windowsPath ? "iu" : "u"), "");
    candidate = candidate.replace(/(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)$/u, "");
    const segments = candidate.split("/");
    if (!candidate || segments.some((segment) => !segment || segment === "." || segment === ".." || INTERNAL_DIRECTORIES.has(segment.toLowerCase())) || candidate.includes(":") || [...candidate].some((character) => character.charCodeAt(0) < 32)) return PRIVATE_PATH;
    return candidate;
  };

  // Consume a whole destination (including spaces) and do not trust the provider's label.
  let safe = text.replace(/\[([^\]\n]*)\]\((<[^>\n]*>|[^)\n]*)\)/gu, (link, _label: string, target: string) =>
    /^(?:https?:|mailto:)/iu.test(target.replace(/^<|>$/gu, "").trim()) ? link : localReference(target));
  // A streaming destination is not complete yet. Hide it before any private prefix can appear.
  safe = safe.replace(/\[([^\]\n]*)\]\([^)\n]*$/gu, PRIVATE_PATH);
  // Quoted paths have an explicit boundary even when a filename contains spaces.
  safe = safe.replace(/([`"'])(file:\/\/[^`"'\n]*|[a-z]:[\\/][^`"'\n]*|\/[^`"'\n]*|\\\\[^`"'\n]*)\1/giu,
    (_match, _quote: string, target: string) => localReference(target));
  // Match the known root before tokenizing a file tail: root spaces and normalization are not
  // prose boundaries. An unquoted filename ends at its extension/line suffix before prose.
  const roots = root === undefined ? [] : [...new Set([root.normalize("NFC"), root.normalize("NFD")]
    .flatMap((value) => [value, value.replaceAll("/", "\\")]))]
    .sort((left, right) => right.length - left.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  const knownRoot = roots.length === 0 ? "" : `(?:${roots.join("|")})[\\\\/]|`;
  const start = `${knownRoot}${String.raw`file:\/\/\/|[a-z]:[\\/]|\\\\|\/(?=\S)|(?:\.meta|\.burnguard-inputs|\.attachments)[\\/]`}`;
  const fileTail = /(?:[^\s<>[\]`"',;!?]| (?!(?:[\\/]|[a-z]:[\\/]|https?:|mailto:|\.(?:meta|burnguard-inputs|attachments)[\\/])))*?\.[\p{L}\p{N}]{1,16}(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)?(?=$|[\s)\].,;!?<>])/u.source;
  const tokenTail = /[^\s<>()[\]`"',;!?]+/u.source;
  // Consume external URLs as whole tokens so their scheme colon and path slashes are never
  // mistaken for punctuation-adjacent local paths. Classify each local reference only once.
  const references = new RegExp(`((?:https?:\\/\\/|mailto:)[^\\s<>\\[\\]"\`,;]+)|(?<![\\p{L}\\p{N}_/\\\\])(?:${start})(?:${fileTail}|${tokenTail})`, "giu");
  return safe.replace(references, (target, external: string | undefined) =>
    external === undefined ? localReference(target) : target);
}
