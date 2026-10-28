import { parse } from "node-html-parser";
import { SOURCE_LIMITS, type SourceCollector, type SourceContext } from "./token-audit-source";
import { collectCssSource } from "./token-audit-source-css";

type Attribute = { readonly name: string; readonly value: string; readonly start: number; readonly end: number };
type Tag = { readonly name: string; readonly start: number; readonly end: number; readonly closing: boolean; readonly selfClosing: boolean; readonly attrs: readonly Attribute[] };
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["style", "script", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript"]);
const space = (c: string | undefined): boolean => c !== undefined && /[\t\n\f\r ]/u.test(c);

/** Strict forward lexer: tolerant HTML recovery must never manufacture an authored location. */
function readTag(text: string, start: number): Tag | null {
  let i = start + 1;
  const closing = text[i] === "/";
  if (closing) i += 1;
  const nameStart = i;
  while (i < text.length && /[a-zA-Z0-9:-]/u.test(text[i] ?? "")) i += 1;
  const name = text.slice(nameStart, i).toLowerCase();
  if (!/^[a-z]/u.test(name)) return null;
  const attrs: Attribute[] = [];
  const names = new Set<string>();
  while (i < text.length) {
    const before = i;
    while (space(text[i])) i += 1;
    if (text[i] === ">" || text[i] === "/" && text[i + 1] === ">") {
      const selfClosing = text[i] === "/";
      return { name, start, end: i + (selfClosing ? 2 : 1), closing, selfClosing, attrs };
    }
    if (closing || i === before) return null;
    const keyStart = i;
    while (i < text.length && !space(text[i]) && !/[=/>"'<>`]/u.test(text[i] ?? "")) i += 1;
    const key = text.slice(keyStart, i).toLowerCase();
    if (!key || names.has(key)) return null;
    names.add(key);
    const keyEnd = i;
    while (space(text[i])) i += 1;
    let valueStart = i;
    let valueEnd = i;
    if (text[i] === "=") {
      i += 1;
      while (space(text[i])) i += 1;
      const quote = text[i] === '"' || text[i] === "'" ? text[i] : null;
      if (quote) {
        valueStart = ++i;
        while (i < text.length && text[i] !== quote) i += 1;
        if (i === text.length) return null;
        valueEnd = i++;
      } else {
        valueStart = i;
        while (i < text.length && !space(text[i]) && text[i] !== ">") {
          if (/["'<=`]/u.test(text[i] ?? "")) return null;
          i += 1;
        }
        valueEnd = i;
        if (valueStart === valueEnd) return null;
      }
    } else i = keyEnd;
    attrs.push({ name: key, value: text.slice(valueStart, valueEnd), start: valueStart, end: valueEnd });
  }
  return null;
}

function rawClose(text: string, start: number, name: string): Tag | null {
  let cursor = start;
  while (cursor < text.length) {
    const next = text.indexOf("<", cursor);
    if (next < 0) return null;
    // Inspect only the fixed-length potential closing name, not the entire suffix.
    if (text[next + 1] === "/" && text.slice(next + 2, next + 2 + name.length).toLowerCase() === name) {
      const tag = readTag(text, next);
      if (tag?.closing && tag.name === name) return tag;
    }
    cursor = next + 1;
  }
  return null;
}

export function collectHtmlSource(out: SourceCollector): void {
  const text = out.input.text;
  const stack: { readonly tag: Tag; readonly context: SourceContext }[] = [];
  let i = 0;
  const malformed = (): void => {
    // A repaired tree cannot establish cascade context for any earlier declaration either.
    out.declarations.length = 0;
    out.issue("malformed-html", null);
  };
  while (i < text.length) {
    const start = text.indexOf("<", i);
    if (start < 0) break;
    if (text.startsWith("<!--", start)) {
      const end = text.indexOf("-->", start + 4);
      if (end < 0) { malformed(); return; }
      i = end + 3;
      continue;
    }
    if (/^<!doctype html\s*>/iu.test(text.slice(start, start + 32))) {
      i = text.indexOf(">", start) + 1;
      continue;
    }
    const tag = readTag(text, start);
    if (tag === null) { malformed(); return; }
    if (!out.consume()) return;
    i = tag.end;
    if (tag.closing) {
      if (stack.pop()?.tag.name !== tag.name || tag.selfClosing) { malformed(); return; }
      continue;
    }
    if (tag.name === "plaintext" || tag.name === "svg" || tag.name === "math") {
      out.issue("unsupported-syntax", out.span(start, text.length));
      return;
    }
    if (tag.selfClosing && !VOID.has(tag.name)) { malformed(); return; }
    if (stack.length >= SOURCE_LIMITS.depth) { out.issue("depth-budget", out.span(start, i)); return; }
    // Existing installed HTML parser owns attribute semantics. The lexer owns original spans.
    // Parsing one already bounded tag avoids repeated whole-document regex recovery.
    const element = parse(text.slice(start, tag.end), { blockTextElements: {} }).firstChild;
    if (!element || !("getAttribute" in element) || typeof element.getAttribute !== "function") {
      out.issue("unresolvable-location", out.span(start, i));
      continue;
    }
    const context: SourceContext = { kind: "element", name: tag.name, params: text.slice(start, i), span: out.span(start, i) };
    const ancestors = [...stack.map(frame => frame.context), context];
    for (const attr of tag.attrs) {
      if (attr.name.startsWith("on") || attr.value.includes("{{") || attr.value.includes("${") || attr.value.includes("<%")) {
        out.issue("dynamic-source", out.span(attr.start, attr.end));
      }
      if (attr.name !== "style") continue;
      if (attr.value.includes("&")) { out.issue("html-entity", out.span(attr.start, attr.end)); continue; }
      if (element.getAttribute("style") !== attr.value) { out.issue("unresolvable-location", out.span(start, i)); continue; }
      collectCssSource(out, { start: attr.start, end: attr.end, origin: "style-attribute", context: ancestors });
    }
    if (tag.name === "link" && tag.attrs.some(attr => attr.name === "rel" && attr.value.toLowerCase().split(/\s+/u).includes("stylesheet"))) {
      out.issue("external-stylesheet", out.span(start, i));
    }
    if (RAW.has(tag.name)) {
      const close = rawClose(text, tag.end, tag.name);
      if (close === null) { malformed(); return; }
      if (tag.name === "style") {
        const type = tag.attrs.find(attr => attr.name === "type");
        if (type && type.value.toLowerCase() !== "text/css") out.issue("unsupported-syntax", out.span(start, close.end));
        else collectCssSource(out, { start: tag.end, end: close.start, origin: "style-element", context: ancestors });
      } else if (tag.name === "script") out.issue("script", out.span(start, close.end));
      else if (tag.name !== "title" && tag.name !== "textarea") out.issue("unsupported-syntax", out.span(start, close.end));
      i = close.end;
    } else if (!VOID.has(tag.name)) stack.push({ tag, context });
  }
  if (stack.length > 0) malformed();
}
