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
] as const;
const URL_ATTRIBUTES = ["href", "src", "action", "formaction", "poster", "xlink:href", "srcset", "imagesrcset", "ping"] as const;
/** Raw-text or inert containers whose markup a JS-disabled consumer still renders and fetches. */
const HIDDEN_MARKUP_CONTAINERS = ["noscript", "template"] as const;
const DANGEROUS_SCHEME = /^(?:javascript|data:text\/html|vbscript):/i;
const NETWORK_STYLE = /(?:@import\b|url\s*\()/i;
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

export function removeSourceMarkupReferences(content: string): string {
  const root = parse(content, { lowerCaseTagName: true });
  for (const node of root.querySelectorAll("*")) {
    for (const attributeName of URL_ATTRIBUTES) node.removeAttribute(attributeName);
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
    if (NETWORK_STYLE.test(style.textContent)) style.set_content("");
  }
  for (const node of root.querySelectorAll("*")) {
    for (const attributeName of Object.keys(node.attributes)) {
      if (attributeName.toLowerCase().startsWith("on")) node.removeAttribute(attributeName);
    }
    const style = node.getAttribute("style");
    if (style !== undefined && NETWORK_STYLE.test(style)) node.removeAttribute("style");
    for (const attributeName of URL_ATTRIBUTES) node.removeAttribute(attributeName);
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
  assertInertTree(parse(content, { lowerCaseTagName: true }), kind, relativeReferencesAllowed);
}

function assertInertTree(root: HTMLElement, kind: "html" | "svg", relativeReferencesAllowed: boolean): void {
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
  // consumer renders both, so their markup is held to the same rules.
  for (const elementName of HIDDEN_MARKUP_CONTAINERS) {
    for (const node of root.querySelectorAll(elementName)) assertInertTree(parse(node.innerHTML, { lowerCaseTagName: true }), kind, relativeReferencesAllowed);
  }
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
