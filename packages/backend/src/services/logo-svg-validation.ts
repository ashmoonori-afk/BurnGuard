import { LOGO_SOURCE_ATTRIBUTE } from "@bg/shared";
import { LogoDeliverableError } from "./logo-deliverables";

/**
 * The master vector contract (doc/23-logo-design-deliverable-2026-09-18.md, D6).
 *
 * A blacklist scan cannot state this contract: a namespaced `<s:script>`, a `<style>@import`, an
 * entity-encoded `u&#114;l(` and malformed XML all read as harmless to a regular expression while a
 * browser still executes them. So this module tokenises the document with a strict grammar and
 * admits only an allowlisted element / attribute / value subset; anything unrecognised is refused.
 * One validator serves both the turn gate and the SVG export, so both judge the same bytes.
 */

const MAX_SVG_BYTES = 1024 * 1024;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

const ELEMENTS = new Set([
  "svg", "g", "defs", "symbol", "use", "path", "circle", "ellipse",
  "rect", "line", "polyline", "polygon", "title", "desc", "clipPath", "mask",
]);
/** `<title>` and `<desc>` are the only elements whose character data means anything to a mark. */
const TEXT_ELEMENTS = new Set(["title", "desc"]);
/** Same-document fragment references. */
const FRAGMENT_ATTRIBUTES = new Set(["href", "xlink:href"]);
/** The only attributes that may spell `url(`, and only as `url(#<local id>)`. */
const URL_ATTRIBUTES = new Set(["clip-path", "mask"]);

const ID = /^[A-Za-z_][\w:.-]{0,63}$/;
const NUMBER = /^-?\d+(\.\d+)?(px|%)?$/;
const VIEW_BOX = /^-?\d+(\.\d+)?([ ,]+-?\d+(\.\d+)?){3}$/;
const COLOUR = /^(none|currentColor|black|white|transparent|#[0-9A-Fa-f]{3}|#[0-9A-Fa-f]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/;
const TRANSFORM = /^((translate|scale|rotate|matrix|skewX|skewY)\(\s*-?\d+(\.\d+)?([ ,]+-?\d+(\.\d+)?)*\s*\)\s*)+$/;
const SOURCE = /^explorations\/round-\d{1,2}\/candidate-[1-4]\.png$/;
/**
 * The accessible name of the mark. A logo is a picture, so a screen reader has nothing to read
 * unless the document names it, and every finished vector the contract accepts should carry that
 * name. It is admitted as inert character data only: 1..64 characters from a closed set of letters,
 * digits, combining marks, spaces and light punctuation, starting on a letter or digit. The set
 * spells no scheme, no `url(`, no markup, no entity and no control character, so a Korean brand
 * name passes while nothing in the value can address or execute anything. `aria-labelledby` and the
 * other referencing ARIA attributes stay forbidden: they point at another node instead of naming
 * this one, and resolving them is a second reference graph this validator deliberately does not have.
 */
const ARIA_LABEL = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}\p{Zs}.,'\u2019-]{0,63}$/u;

const ATTRIBUTES = new Map<string, RegExp>([
  ["version", /^\d+(\.\d+)?$/],
  ["viewBox", VIEW_BOX],
  ["preserveAspectRatio", /^(none|x(Min|Mid|Max)Y(Min|Mid|Max)( (meet|slice))?)$/],
  ["id", ID],
  ["d", /^[MmZzLlHhVvCcSsQqTtAa0-9eE+\-., \t\r\n]*$/],
  ["points", /^[0-9eE+\-., \t\r\n]*$/],
  ["transform", TRANSFORM],
  ["fill-rule", /^(nonzero|evenodd)$/],
  ["clip-rule", /^(nonzero|evenodd)$/],
  ["stroke-linecap", /^(butt|round|square)$/],
  ["stroke-linejoin", /^(miter|round|bevel)$/],
  ["aria-hidden", /^(true|false)$/],
  ["aria-label", ARIA_LABEL],
  ["role", /^[a-z]+$/],
  ["lang", /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/],
]);
for (const name of ["width", "height", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2",
  "stroke-width", "stroke-miterlimit", "opacity", "fill-opacity", "stroke-opacity"]) ATTRIBUTES.set(name, NUMBER);
for (const name of ["fill", "stroke"]) ATTRIBUTES.set(name, COLOUR);

const END_TAG = /^<\/([A-Za-z_][\w.:-]*)\s*>/;
const START_TAG = /^<([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/;
const ATTRIBUTE_TOKEN = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g;

interface SvgAttribute {
  readonly name: string;
  readonly value: string;
}

interface SvgElement {
  readonly name: string;
  readonly attributes: readonly SvgAttribute[];
}

function fail(detail: string): LogoDeliverableError {
  return new LogoDeliverableError(detail);
}

/**
 * Everything a tokeniser cannot judge safely: a DTD can declare entities no scan expands, a
 * processing instruction can attach a stylesheet, CDATA hides markup from the grammar and an entity
 * reference hides a keyword from every value rule. None of them has a use in a flat mark.
 */
function prepare(text: string): string {
  if (Buffer.byteLength(text, "utf8") > MAX_SVG_BYTES) throw fail("svg_too_large");
  const body = text.replace(/<!--[\s\S]*?-->/g, "");
  if (/<!DOCTYPE/i.test(body)) throw fail("svg_doctype");
  if (body.includes("<![CDATA[")) throw fail("svg_cdata");
  const declared = body.replace(/^\s*<\?xml\s+[^<>]*\?>/, "");
  if (declared.includes("<?")) throw fail("svg_processing_instruction");
  if (/&(?!(amp|lt|gt|quot|apos);)/.test(declared)) throw fail("svg_entity");
  return declared;
}

function attributesOf(source: string): SvgAttribute[] {
  const attributes: SvgAttribute[] = [];
  const seen = new Set<string>();
  ATTRIBUTE_TOKEN.lastIndex = 0;
  for (let match = ATTRIBUTE_TOKEN.exec(source); match !== null; match = ATTRIBUTE_TOKEN.exec(source)) {
    const name = match[1];
    if (seen.has(name)) throw fail("svg_malformed");
    seen.add(name);
    attributes.push({ name, value: match[2] ?? match[3] ?? "" });
  }
  return attributes;
}

/**
 * Tokenises the document into elements in document order. Only well-formed start, end and
 * self-closing tags with quoted attribute values are accepted and every end tag must match the open
 * element it closes. The parent of each run of non-whitespace character data is collected into
 * `textParents` rather than judged here, so a forbidden element is reported before its payload.
 */
function parseElements(body: string, textParents: string[]): SvgElement[] {
  const elements: SvgElement[] = [];
  const stack: string[] = [];
  let index = 0;
  let roots = 0;
  while (index < body.length) {
    const rest = body.slice(index);
    if (!rest.startsWith("<")) {
      const next = rest.indexOf("<");
      const text = next === -1 ? rest : rest.slice(0, next);
      if (text.trim() !== "") textParents.push(stack[stack.length - 1] ?? "");
      index += text.length;
      continue;
    }
    const end = END_TAG.exec(rest);
    if (end !== null) {
      if (stack.pop() !== end[1]) throw fail("svg_malformed");
      index += end[0].length;
      continue;
    }
    const start = START_TAG.exec(rest);
    if (start === null) throw fail("svg_malformed");
    if (stack.length === 0 && ++roots > 1) throw fail("svg_root_invalid");
    elements.push({ name: start[1], attributes: attributesOf(start[2]) });
    if (start[3] !== "/") stack.push(start[1]);
    index += start[0].length;
  }
  if (stack.length > 0) throw fail("svg_malformed");
  return elements;
}

function attributeOf(element: SvgElement, name: string): string | null {
  return element.attributes.find((attribute) => attribute.name === name)?.value ?? null;
}

/** Checks one attribute and records the local id it references, if any. */
function checkAttribute(attribute: SvgAttribute, references: string[]): void {
  const { name, value } = attribute;
  if (/^on/i.test(name)) throw fail("svg_event_handler");
  if (name === "style") throw fail("svg_forbidden_attribute:style");
  if (name === "xmlns" || name === "xmlns:xlink") {
    const expected = name === "xmlns" ? SVG_NAMESPACE : XLINK_NAMESPACE;
    if (value !== expected) throw fail(`svg_attribute_invalid:${name}`);
    return;
  }
  if (name.startsWith("xmlns:")) throw fail(`svg_forbidden_attribute:${name}`);
  if (name === LOGO_SOURCE_ATTRIBUTE) {
    if (!SOURCE.test(value)) throw fail("svg_source_invalid");
    return;
  }
  if (FRAGMENT_ATTRIBUTES.has(name)) {
    if (!value.startsWith("#")) throw fail("svg_external_reference");
    const id = value.slice(1);
    if (!ID.test(id)) throw fail(`svg_attribute_invalid:${name}`);
    references.push(id);
    return;
  }
  if (URL_ATTRIBUTES.has(name)) {
    const target = /^url\(#([^)]*)\)$/.exec(value);
    if (target === null) throw fail("svg_external_reference");
    if (!ID.test(target[1])) throw fail(`svg_attribute_invalid:${name}`);
    references.push(target[1]);
    return;
  }
  const pattern = ATTRIBUTES.get(name);
  if (pattern === undefined) throw fail(`svg_forbidden_attribute:${name}`);
  if (/url\s*\(/i.test(value)) throw fail("svg_url_reference");
  if (!pattern.test(value)) throw fail(`svg_attribute_invalid:${name}`);
}

/**
 * The master vector contract. It lives here rather than in the export lane so the turn gate and the
 * SVG export validate exactly the same bytes against exactly the same rules.
 */
export function validateLogoSvg(text: string): void {
  const textParents: string[] = [];
  const elements = parseElements(prepare(text), textParents);
  const root = elements[0];
  if (root === undefined || root.name !== "svg") throw fail("svg_root_invalid");
  const viewBox = attributeOf(root, "viewBox");
  if (viewBox === null) throw fail("svg_viewbox_missing");
  if (!VIEW_BOX.test(viewBox)) throw fail("svg_viewbox_invalid");
  // Element names first: a prefixed or foreign element is the graver finding, and reporting it
  // before the namespace declaration that enabled it names the payload rather than its wrapper.
  for (const element of elements) {
    if (!ELEMENTS.has(element.name)) throw fail(`svg_forbidden_element:${element.name}`);
  }
  // Character data draws nothing outside <title>/<desc>; anywhere else it is stray markup or copy
  // the mark would render as an accident.
  for (const parent of textParents) if (!TEXT_ELEMENTS.has(parent)) throw fail("svg_text_content");
  const ids = new Set<string>();
  for (const element of elements) {
    const id = attributeOf(element, "id");
    if (id !== null) ids.add(id);
  }
  const references: string[] = [];
  for (const element of elements) for (const attribute of element.attributes) checkAttribute(attribute, references);
  // A reference this document cannot resolve is either a typo or a placeholder for bytes the
  // validator never saw; neither belongs in a finished master vector.
  for (const reference of references) if (!ids.has(reference)) throw fail("svg_reference_missing");
  if (attributeOf(root, "xmlns") === null) throw fail("svg_namespace_missing");
}

/**
 * Every violation this parser can report, without the subject it found. A detail reads
 * `svg_forbidden_attribute:<name>`, and that name is copied out of the document, so it is
 * model-authored text; the head is not. Only the head — one of this closed list — and the
 * allowlist below ever leave the server, so a repair is told which rule it broke and what the rule
 * is, and never handed back a string the model itself wrote.
 */
export const LOGO_SVG_VIOLATIONS = [
  "svg_too_large", "svg_doctype", "svg_cdata", "svg_processing_instruction", "svg_entity",
  "svg_malformed", "svg_root_invalid", "svg_viewbox_missing", "svg_viewbox_invalid",
  "svg_namespace_missing", "svg_forbidden_element", "svg_text_content", "svg_event_handler",
  "svg_forbidden_attribute", "svg_attribute_invalid", "svg_external_reference",
  "svg_url_reference", "svg_reference_missing", "svg_source_invalid",
] as const;
export type LogoSvgViolation = (typeof LOGO_SVG_VIOLATIONS)[number];

/** The finite head of a validator detail, or null when the detail is not one of this module's. */
export function logoSvgViolation(detail: string): LogoSvgViolation | null {
  const head = detail.split(":")[0] ?? "";
  return (LOGO_SVG_VIOLATIONS as readonly string[]).includes(head) ? head as LogoSvgViolation : null;
}

export type LogoSvgContract = {
  readonly elements: readonly string[];
  readonly text_elements: readonly string[];
  readonly attributes: readonly string[];
  readonly max_bytes: number;
};

/**
 * The allowlist itself, read off the tables above so it cannot drift from what is enforced. This
 * is what a repair is given instead of a diagnostic: the permitted surface, as data.
 */
export function logoSvgContract(): LogoSvgContract {
  return {
    elements: [...ELEMENTS].sort(),
    text_elements: [...TEXT_ELEMENTS].sort(),
    attributes: [...new Set([
      ...ATTRIBUTES.keys(), ...FRAGMENT_ATTRIBUTES, ...URL_ATTRIBUTES,
      "xmlns", "xmlns:xlink", LOGO_SOURCE_ATTRIBUTE,
    ])].sort(),
    max_bytes: MAX_SVG_BYTES,
  };
}

/** The generated candidate the vector claims to reproduce, or null when the root does not say. */
export function logoSvgSource(text: string): string | null {
  const body = text.replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*<\?xml\s+[^<>]*\?>/, "");
  const start = body.indexOf("<svg");
  if (start === -1) return null;
  const tag = START_TAG.exec(body.slice(start));
  if (tag === null) return null;
  try {
    return attributeOf({ name: tag[1], attributes: attributesOf(tag[2]) }, LOGO_SOURCE_ATTRIBUTE);
  } catch {
    return null;
  }
}
