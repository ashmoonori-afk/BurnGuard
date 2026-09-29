import path from "node:path";
import { parse, type HTMLElement } from "node-html-parser";

export type ExtractionSafetyErrorCode =
  | "invalid_source_url"
  | "unsafe_source_content"
  | "unsafe_asset_path";

export class ExtractionSafetyError extends Error {
  readonly name = "ExtractionSafetyError";

  constructor(readonly code: ExtractionSafetyErrorCode, message: string) {
    super(message);
  }
}

const ACTIVE_ELEMENTS = [
  "script",
  "iframe",
  "object",
  "embed",
  "form",
  "base",
  "set",
  "animate",
  "animatemotion",
  "animatetransform",
] as const;
const URL_ATTRIBUTES = ["href", "src", "action", "formaction", "poster", "background", "xlink:href", "srcset", "imagesrcset", "ping"] as const;
/** Raw-text or inert containers whose markup a JS-disabled consumer still renders and fetches. */
const HIDDEN_MARKUP_CONTAINERS = ["noscript", "template"] as const;
export const MAX_HIDDEN_MARKUP_DEPTH = 8;
const DANGEROUS_SCHEME = /^(?:javascript|data:text\/html|vbscript):/i;
const NETWORK_STYLE = /(?:@import\b|url\s*\()/i;
// CSS that can load a resource once escapes are decoded (\75 rl( is url(, @\69mport is @import) and
// resource functions that take plain strings (image-set("https://...")).
const CSS_RESOURCE = /(?:@import\b|url\s*\(|(?:-webkit-)?image-set\s*\(|\bimage\s*\(|cross-fade\s*\(|\belement\s*\(|\bsrc\s*\()/i;
const MAX_URL_ATTRIBUTES_PER_ELEMENT = 64;

/**
 * Attributes a browser only ever reads as prose, never as a CSS value. Every other attribute value (SVG
 * presentation attributes such as cursor, fill, mask, filter included) is held to the CSS resource check.
 */
function isProseAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  return ["alt", "title", "placeholder", "content", "value", "label"].includes(lower) || lower.startsWith("aria-") || lower.startsWith("data-");
}

/** True when an attribute value can reach the network: CSS-parsed values are checked escape-aware. */
function attributeCanLoadResources(name: string, value: string): boolean {
  return NETWORK_STYLE.test(value) || (!isProseAttribute(name) && cssCanLoadResources(value));
}

function decodeCssEscapes(css: string): string {
  // CSS input preprocessing first: CRLF, CR and FF become LF, NUL becomes U+FFFD, so an escape's
  // single trailing whitespace swallows the whole CRLF exactly as a browser does.
  return css
    .replace(/\r\n|[\r\f]/g, "\n")
    .replace(/\0/g, "\ufffd")
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?/g, (_, hex: string) => { const code = Number.parseInt(hex, 16); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd"; })
    .replace(/\\([^\n\r\f0-9a-fA-F])/g, "$1");
}

/** True when CSS text can reach the network once escapes are decoded. */
function cssCanLoadResources(css: string): boolean {
  return CSS_RESOURCE.test(css) || CSS_RESOURCE.test(decodeCssEscapes(css));
}

/** Attribute names in source order, consuming quoted and unquoted values so they are never read as names. */
function attributeNames(rawAttrs: string): string[] {
  return [...rawAttrs.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g)].map((match) => match[1]!.toLowerCase());
}
const TEXT_NODE = 3;

/** Every URL an attribute value can make the consumer fetch (srcset/imagesrcset candidates, ping list). */
function attributeUrls(attributeName: string, value: string): string[] {
  if (attributeName === "srcset" || attributeName === "imagesrcset") {
    return value.split(",").map((candidate) => candidate.trim().split(/\s+/u)[0] ?? "").filter((url) => url.length > 0);
  }
  if (attributeName === "ping") return value.split(/\s+/u).filter((url) => url.length > 0);
  return [value];
}

export function parseSafeExtractionUrl(sourceUrl: string): URL {
  const trimmed = sourceUrl.trim();
  if (!trimmed || path.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed) || trimmed.startsWith(".")) {
    throw new ExtractionSafetyError("invalid_source_url", "Extraction source must be a public HTTPS URL");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ExtractionSafetyError("invalid_source_url", "Extraction source must be a public HTTPS URL");
    }
    throw error;
  }
  if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) {
    throw new ExtractionSafetyError("invalid_source_url", "Local, credential-bearing, and non-HTTPS transports are not supported");
  }
  return url;
}

export function safeSourceReference(sourceUrl: string): string {
  const url = parseSafeExtractionUrl(sourceUrl);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function assertInertSourceMarkup(content: string, kind: "html" | "svg"): void {
  assertSourceMarkup(content, kind, false);
}

export function assertAcquirableSourceMarkup(content: string, kind: "html" | "svg"): void {
  assertSourceMarkup(content, kind, true);
}

/**
 * node-html-parser reads attributes case-insensitively (getAttribute lowercases) but removes them by
 * exact raw name, so React's `srcSet` survived `removeAttribute("srcset")` while the gate still saw it.
 * Remove every raw spelling of the name so sanitizer and gate agree.
 */
function removeAttributeAnyCase(node: HTMLElement, attributeName: string): void {
  const lower = attributeName.toLowerCase();
  for (const rawName of Object.keys(node.rawAttributes)) {
    if (rawName.toLowerCase() === lower) node.removeAttribute(rawName);
  }
}

export function removeSourceMarkupReferences(content: string): string {
  const root = parse(content, { lowerCaseTagName: true });
  for (const node of root.querySelectorAll("*")) {
    for (const attributeName of URL_ATTRIBUTES) removeAttributeAnyCase(node, attributeName);
  }
  return root.toString();
}

/**
 * Strips a fetched page down to inert evidence instead of rejecting it: active elements, refresh
 * metas, event handlers, network-capable styles and every resource reference are removed, so an
 * ordinary script-bearing homepage still imports. `assertInertSourceMarkup` remains the gate.
 */
export function removeActiveSourceMarkup(content: string): string {
  const root = parse(content, { lowerCaseTagName: true });
  for (const elementName of [...ACTIVE_ELEMENTS, ...HIDDEN_MARKUP_CONTAINERS]) {
    for (const node of root.querySelectorAll(elementName)) node.remove();
  }
  for (const meta of root.querySelectorAll("meta")) {
    if (meta.getAttribute("http-equiv")?.trim().toLowerCase() === "refresh") meta.remove();
  }
  for (const style of root.querySelectorAll("style")) {
    if (cssCanLoadResources(style.textContent)) style.set_content("");
  }
  for (const node of root.querySelectorAll("*")) {
    for (const attributeName of Object.keys(node.attributes)) {
      if (attributeName.toLowerCase().startsWith("on")) node.removeAttribute(attributeName);
    }
    const style = node.getAttribute("style");
    if (style !== undefined && cssCanLoadResources(style)) node.removeAttribute("style");
    // Any other attribute may carry url() too (SVG fill, stroke, filter, mask, ...): remove it, including
    // in-document fragment references, rather than rejecting the whole page. Removal rebuilds the
    // attribute string, so an element with an unbounded number of them is dropped instead.
    const urlAttributes = Object.entries(node.attributes).filter(([name, value]) => attributeCanLoadResources(name, value)).map(([name]) => name);
    if (urlAttributes.length > MAX_URL_ATTRIBUTES_PER_ELEMENT) { node.remove(); continue; }
    for (const attributeName of urlAttributes) node.removeAttribute(attributeName);
    for (const attributeName of URL_ATTRIBUTES) removeAttributeAnyCase(node, attributeName);
    for (const child of node.childNodes) {
      // Prose that merely mentions CSS network syntax stays readable but can no longer trip the gate.
      if (child.nodeType === TEXT_NODE && NETWORK_STYLE.test(child.rawText)) {
        child.rawText = child.rawText.replace(/url(\s*)\(/giu, "url$1&#40;").replace(/@import/giu, "&#64;import");
      }
    }
  }
  return root.toString();
}

function assertSourceMarkup(content: string, kind: "html" | "svg", relativeReferencesAllowed: boolean): void {
  const normalized = content.toLowerCase();
  const structurallyComplete = kind === "html"
    ? normalized.includes("<html") && normalized.includes("<body") && normalized.includes("</body>") && normalized.includes("</html>")
    : normalized.includes("<svg") && normalized.includes("</svg>");
  if (!structurallyComplete) throw new ExtractionSafetyError("unsafe_source_content", `Malformed ${kind} source is not accepted`);
  if (NETWORK_STYLE.test(content)) throw new ExtractionSafetyError("unsafe_source_content", `Network-capable ${kind} styles are not accepted`);
  const root = parse(content, { lowerCaseTagName: true });
  assertNoHiddenAttributeReferences(root, kind);
  assertInertTree(root, kind, relativeReferencesAllowed);
}

/**
 * Attribute values are checked decoded, so entity-encoded url() cannot hide from the text check above,
 * and duplicate attribute names are refused because parsers and browsers may keep different copies.
 */
function assertNoHiddenAttributeReferences(root: HTMLElement, kind: "html" | "svg"): void {
  for (const node of root.querySelectorAll("*")) {
    const names = attributeNames(node.rawAttrs);
    if (new Set(names).size !== names.length) throw new ExtractionSafetyError("unsafe_source_content", `Duplicate ${kind} attributes are not accepted`);
    for (const [name, value] of Object.entries(node.attributes)) {
      if (attributeCanLoadResources(name, value)) throw new ExtractionSafetyError("unsafe_source_content", `Network-capable ${kind} styles are not accepted`);
    }
    if (node.tagName?.toLowerCase() === "style" && cssCanLoadResources(node.textContent)) throw new ExtractionSafetyError("unsafe_source_content", `Network-capable ${kind} styles are not accepted`);
  }
}

function assertInertTree(root: HTMLElement, kind: "html" | "svg", relativeReferencesAllowed: boolean, depth = 0): void {
  for (const elementName of ACTIVE_ELEMENTS) {
    if (root.querySelector(elementName) !== null) throw new ExtractionSafetyError("unsafe_source_content", `Active ${kind} element is not accepted`);
  }
  for (const meta of root.querySelectorAll("meta")) {
    if (meta.getAttribute("http-equiv")?.trim().toLowerCase() === "refresh") throw new ExtractionSafetyError("unsafe_source_content", `Active ${kind} refresh is not accepted`);
  }
  for (const node of root.querySelectorAll("*")) {
    for (const attributeName of Object.keys(node.attributes)) {
      if (attributeName.toLowerCase().startsWith("on")) throw new ExtractionSafetyError("unsafe_source_content", `Active ${kind} handler is not accepted`);
    }
    for (const attributeName of URL_ATTRIBUTES) {
      for (const value of attributeUrls(attributeName, node.getAttribute(attributeName)?.trim() ?? "")) {
        const localFragment = attributeName === "href" && value.startsWith("#");
        const relativeReference = relativeReferencesAllowed && isSafeRelativeReference(value);
        if (value.length > 0 && !localFragment && !relativeReference) throw new ExtractionSafetyError("unsafe_source_content", `Network-capable ${kind} URL is not accepted`);
        if (DANGEROUS_SCHEME.test(value)) throw new ExtractionSafetyError("unsafe_source_content", `Dangerous ${kind} URL is not accepted`);
      }
    }
  }
  // The parser keeps <noscript> as raw text and <template> inert, but a JS-disabled or printing
  // consumer renders both, so their markup is held to the same rules. Only the outermost containers
  // are reparsed here (the recursion reaches nested ones exactly once), and nesting beyond a small
  // depth fails closed, so crafted nested containers cannot force exponential validation work.
  const outermost = root.querySelectorAll(HIDDEN_MARKUP_CONTAINERS.join(",")).filter(node => !hasHiddenContainerAncestor(node, root));
  if (outermost.length > 0 && depth >= MAX_HIDDEN_MARKUP_DEPTH) {
    throw new ExtractionSafetyError("unsafe_source_content", `Deeply nested hidden ${kind} markup is not accepted`);
  }
  for (const node of outermost) assertInertTree(parse(node.innerHTML, { lowerCaseTagName: true }), kind, relativeReferencesAllowed, depth + 1);
}

function hasHiddenContainerAncestor(node: HTMLElement, root: HTMLElement): boolean {
  for (let parent = node.parentNode; parent !== null && parent !== root; parent = parent.parentNode) {
    if ((HIDDEN_MARKUP_CONTAINERS as readonly string[]).includes(parent.rawTagName?.toLowerCase() ?? "")) return true;
  }
  return false;
}

function isSafeRelativeReference(value: string): boolean {
  if (value.startsWith("//") || value.includes("\\")) return false;
  try {
    const resolved = new URL(value, "https://source.invalid/");
    return resolved.origin === "https://source.invalid" && resolved.username === "" && resolved.password === "";
  } catch {
    return false;
  }
}

export function assertSafeBundleRelativePath(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    path.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) ||
    normalized.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new ExtractionSafetyError("unsafe_asset_path", "Extraction asset path escapes its bundle");
  }
  return normalized;
}
