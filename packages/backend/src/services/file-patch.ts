import { createHash } from "node:crypto";
import { parse, TextNode } from "node-html-parser";

export class FilePatchError extends Error {
  readonly code:
    | "file_not_found"
    | "not_a_file"
    | "unsupported_file"
    | "node_not_found"
    | "ambiguous_node_id"
    | "non_leaf_text_target"
    | "stale_node_fingerprint"
    | "invalid_utf8"
    | "invalid_attribute_url";

  constructor(code: FilePatchError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export interface PatchHtmlNodeInput {
  node_bg_id: string;
  text?: string;
  attributes?: Record<string, string | null>;
  /** Inline-style merge patch; null removes a property. See PatchFileRequest. */
  styles?: Record<string, string | null>;
}

export interface PatchHtmlNodeResult {
  absolutePath: string;
  updatedAt: number;
}

export type HtmlNodeFingerprint = {
  readonly fingerprint: string;
  readonly start: number;
  readonly end: number;
};

/** Preview anchors also resolve against the untouched canonical bytes. */
function parseWithEditableIds(html: string) {
  const root = parse(html, { comment: true });
  const elements = root.querySelectorAll("*");
  const used = new Set(elements.map((node) => node.getAttribute("data-bg-node-id")).filter(Boolean));
  const additions: { start: number; id: string }[] = [];
  for (const node of elements) {
    if (node.hasAttribute("data-bg-node-id") || /^(html|head|body|script|style|meta|link|title|base|noscript)$/i.test(node.tagName)) continue;
    let id = `bg-auto-${node.range[0]}`;
    while (used.has(id)) id += "-";
    used.add(id);
    node.setAttribute("data-bg-node-id", id);
    additions.push({ start: node.range[0] + 1 + node.rawTagName.length, id });
  }
  return { root, additions };
}

export function htmlWithEditableIds(html: string): string {
  const { additions } = parseWithEditableIds(html);
  for (const { start, id } of additions.reverse()) {
    html = `${html.slice(0, start)} data-bg-node-id="${id}"${html.slice(start)}`;
  }
  return html;
}

/**
 * Pure HTML rewrite: serialize a patched DOM tree, preserving everything
 * except the target node's text/attributes. Exposed separately so it can
 * be exercised by unit tests without touching the filesystem or the DB.
 */
export function applyHtmlNodePatch(
  html: string,
  input: PatchHtmlNodeInput,
): string {
  const { root } = parseWithEditableIds(html);
  const selector = `[data-bg-node-id="${escapeAttrSelector(input.node_bg_id)}"]`;
  const targets = root.querySelectorAll(selector);
  if (targets.length === 0) {
    throw new FilePatchError(
      "node_not_found",
      `No element with data-bg-node-id="${input.node_bg_id}"`,
    );
  }
  if (targets.length !== 1) {
    throw new FilePatchError("ambiguous_node_id", "ambiguous_node_id");
  }
  const target = targets[0];
  if (target === undefined) throw new FilePatchError("node_not_found", "node_not_found");
  const [start, end] = target.range;
  validateAttributeUrls(input.attributes);

  if (input.text !== undefined) {
    if (target.querySelectorAll("*").some((node) => !/^(span|em|strong|br|i|b|u|s|small|sup|sub|mark|code)$/i.test(node.tagName))) {
      throw new FilePatchError("non_leaf_text_target", "Select a text element without child elements");
    }
    target.set_content(escapeHtmlText(input.text));
  }

  if (input.attributes) {
    for (const [name, value] of Object.entries(input.attributes)) {
      if (name === "data-bg-node-id") {
        // The anchor is immutable — editing it would orphan the pin and
        // break every follow-up PATCH. Silently ignore.
        continue;
      }
      if (value === null) {
        target.removeAttribute(name);
      } else {
        target.setAttribute(name, value);
      }
    }
  }

  if (input.styles) {
    const current = parseInlineStyle(target.getAttribute("style") ?? "");
    for (const [prop, value] of Object.entries(input.styles)) {
      const key = prop.trim();
      if (!key) continue;
      if (value === null) {
        delete current[key];
      } else {
        current[key] = value;
      }
    }
    const serialized = serializeInlineStyle(current);
    if (serialized.length === 0) {
      target.removeAttribute("style");
    } else {
      target.setAttribute("style", serialized);
    }
  }

  return `${html.slice(0, start)}${target.toString()}${html.slice(end)}`;
}

// The extraction policy covers these URL attributes too, but its inert-source
// validator rejects legitimate editable links (including HTTPS). Keep the patch
// gate limited to executable schemes/content rather than sanitizing whole HTML.
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "poster", "xlink:href"]);

function validateAttributeUrls(attributes: PatchHtmlNodeInput["attributes"]): void {
  for (const [name, value] of Object.entries(attributes ?? {})) {
    if (value === null || !URL_ATTRIBUTES.has(name.trim().toLowerCase())) continue;
    // setAttribute preserves entity references in serialized HTML. Decode them
    // exactly as this parser does, then let WHATWG URL handle case, leading C0
    // controls and embedded ASCII tabs/newlines as the browser does.
    let url: URL;
    try { url = new URL(new TextNode(value).text, "https://artifact.invalid/"); }
    catch { throw new FilePatchError("invalid_attribute_url", "Invalid attribute URL"); }
    const mime = url.protocol === "data:" ? url.pathname.replace(/[;,].*$/s, "").trim().toLowerCase() : "";
    if (url.protocol === "javascript:" || url.protocol === "vbscript:" || mime === "text/html" || mime === "application/xhtml+xml") {
      throw new FilePatchError("invalid_attribute_url", "Executable attribute URLs are not allowed");
    }
  }
}

export function fingerprintHtmlNode(html: string, nodeBgId: string): HtmlNodeFingerprint {
  const { root } = parseWithEditableIds(html);
  const targets = root.querySelectorAll(`[data-bg-node-id="${escapeAttrSelector(nodeBgId)}"]`);
  if (targets.length === 0) throw new FilePatchError("node_not_found", "node_not_found");
  if (targets.length !== 1) throw new FilePatchError("ambiguous_node_id", "ambiguous_node_id");
  const target = targets[0];
  if (target === undefined) throw new FilePatchError("node_not_found", "node_not_found");
  const [start, end] = target.range;
  const fingerprint = createHash("sha256").update(String(start)).update("\0").update(html.slice(start, end)).digest("hex");
  return { fingerprint, start, end };
}

/**
 * Parse a `style="..."` attribute string into an ordered map.
 *
 * Tweaks mode emits well-behaved short values (px / rem / rgba / hex /
 * keywords) but Edit mode lets the user paste arbitrary inline styles,
 * which can include declarations whose value carries `;` or `:` inside
 * a function call or string — `background: url(data:image/png;base64,…)`,
 * `background: linear-gradient(red, blue)`, `color: var(--x, fallback)`,
 * `font-family: "Helvetica Neue, sans"`, etc.
 *
 * The parser is a tiny state machine: split on `;` only when paren
 * depth is zero AND we're outside a quoted string. Keys are still
 * separated from values by the first top-level `:`, which is safe
 * because CSS property names cannot contain `:` or `(`.
 */
export function parseInlineStyle(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let buf = "";

  const commit = () => {
    const trimmed = buf.trim();
    buf = "";
    if (!trimmed) return;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) return;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (!key || !value) return;
    out[key] = value;
  };

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      buf += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      buf += ch;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === "(") {
        depth += 1;
        buf += ch;
        continue;
      }
      if (ch === ")") {
        if (depth > 0) depth -= 1;
        buf += ch;
        continue;
      }
      if (ch === ";" && depth === 0) {
        commit();
        continue;
      }
    }
    buf += ch;
  }
  commit();
  return out;
}

export function serializeInlineStyle(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}

/**
 * Escapes an arbitrary string so it is safe to drop between HTML tags
 * via `set_content`. We escape quotes too even though they do not need
 * escaping in text content — the function is named generically and a
 * future caller might splice the result into an attribute by mistake.
 * Defense in depth, no behavioural change for the current call site.
 */
function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttrSelector(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
