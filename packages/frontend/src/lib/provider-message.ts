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
  const privateDirectories = [...INTERNAL_DIRECTORIES].map((value) => value.replaceAll(".", "\\.")).join("|");
  const privateSegment = new RegExp(`(?:^|[\\\\/])(?:${privateDirectories})(?=$|[\\\\/:?#])`, "iu");
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
    if (!candidate || segments.some((segment) => !segment || segment === "." || segment === "..") || privateSegment.test(candidate) || candidate.includes(":") || [...candidate].some((character) => character.charCodeAt(0) < 32)) return PRIVATE_PATH;
    return candidate;
  };

  // Consume a whole destination (including spaces) and do not trust the provider's label.
  let safe = text.replace(/\[([^\]\n]*)\]\((<[^>\n]*>|[^)\n]*)\)/gu, (link, _label: string, target: string) =>
    /^(?:https?:|mailto:)/iu.test(target.replace(/^<|>$/gu, "").trim()) && !privateSegment.test(target.replace(/^<|>$/gu, "").trim()) ? link : localReference(target));
  // A streaming destination is not complete yet. Hide it before any private prefix can appear.
  safe = safe.replace(/\[([^\]\n]*)\]\([^)\n]*$/gu, PRIVATE_PATH);
  // Quoting bounds a complete reference, including relative prefixes and spaces.
  safe = safe.replace(/([`"'])([^`"'\r\n]*)\1/gu,
    (quoted, _quote: string, target: string) =>
      /^(?:file:\/\/|[a-z]:[\\/]|[\\/])/iu.test(target) || privateSegment.test(target) ? localReference(target) : quoted);
  // Match the known root before tokenizing a file tail: root spaces and normalization are not
  // prose boundaries. An unquoted filename ends at its extension/line suffix before prose.
  const roots = root === undefined ? [] : [...new Set([root.normalize("NFC"), root.normalize("NFD")]
    .flatMap((value) => [value, value.replaceAll("/", "\\")]))]
    .sort((left, right) => right.length - left.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  const knownRoot = roots.length === 0 ? "" : `(?:${roots.join("|")})[\\\\/]|`;
  const start = `${knownRoot}${String.raw`file:\/\/\/|[a-z]:[\\/]|[\\/](?=\S)`}`;
  const fileTail = /(?:[^\s<>[\]`"',;!?]| (?!(?:[\\/]|[a-z]:[\\/]|https?:|mailto:|\.(?:meta|burnguard-inputs|attachments)[\\/])))*?\.[\p{L}\p{N}]{1,16}(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)?(?=$|[\s)\].,;!?<>])/u.source;
  const tokenTail = /[^\s<>()[\]`"',;!?]+/u.source;
  // Recognize complete relative segment sequences before examining private directories; an
  // internal segment cannot evade classification by following a dot, parent or subtree prefix.
  const segment = /[^\s\\/<>()[\]`"',;!?:]+/u.source;
  const relative = `((?:${segment}[\\\\/])+(?:${fileTail}|${tokenTail})|(?:${privateDirectories})[\\\\/]*(?=$|[\\s<>()\\[\\]"\`,;!?]))`;
  const boundary = String.raw`(?<![\p{L}\p{N}_/\\])`;
  const references = new RegExp(`((?:https?:\\/\\/|mailto:)[^\\s<>\\[\\]"\`,;]+)|${boundary}(?:${start})(?:${fileTail}|${tokenTail})|${boundary}${relative}`, "giu");
  return safe.replace(references, (target, external: string | undefined, relativePath: string | undefined) =>
    (external !== undefined || relativePath !== undefined) && !privateSegment.test(target) ? target : localReference(target));
}
