import postcss, { CssSyntaxError, type ChildNode, type Declaration } from "postcss";
import { SOURCE_LIMITS, type SourceCollector, type SourceContext, type SourceDeclaration } from "./token-audit-source";

export type CssRegion = {
  readonly start: number;
  readonly end: number;
  readonly origin: SourceDeclaration["origin"];
  readonly context: readonly SourceContext[];
};

/** One forward pass bounds parser nesting, including value functions, before PostCSS allocates an AST. */
function preflight(text: string): "depth-budget" | "malformed-css" | "dynamic-source" | null {
  const stack: string[] = [];
  let quote = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "\\") { i += 1; continue; }
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return "malformed-css";
      i = end + 1;
      continue;
    }
    if ((c === "$" || c === "#") && text[i + 1] === "{" || c === "{" && text[i + 1] === "{"
      || c === "<" && text[i + 1] === "%") return "dynamic-source";
    if (c === "{" || c === "(" || c === "[") stack.push(c);
    else if (c === "}" || c === ")" || c === "]") {
      const open = stack.pop();
      if (open !== (c === "}" ? "{" : c === ")" ? "(" : "[")) return "malformed-css";
    }
    if (stack.length > SOURCE_LIMITS.depth) return "depth-budget";
  }
  return quote || stack.length > 0 ? "malformed-css" : null;
}

const CONTEXT_RULES = new Set(["media", "supports", "container", "layer", "scope", "starting-style", "keyframes", "-webkit-keyframes", "font-face", "page", "property"]);
const DESCRIPTOR_RULES = new Set(["font-face", "page", "property"]);

export function collectCssSource(out: SourceCollector, region: CssRegion): void {
  const text = out.input.text.slice(region.start, region.end);
  const whole = out.span(region.start, region.end);
  if (Buffer.byteLength(text, "utf8") > SOURCE_LIMITS.cssBytes) { out.issue("source-budget", whole); return; }
  const problem = preflight(text);
  if (problem !== null) { out.issue(problem, whole); return; }
  const inline = region.origin === "style-attribute";
  const prefix = inline ? "a{" : "";
  let root: postcss.Root;
  try { root = postcss.parse(prefix + text + (inline ? "}" : ""), { from: undefined, map: false }); }
  catch (error) {
    if (!(error instanceof CssSyntaxError)) throw error;
    out.issue("malformed-css", whole);
    return;
  }
  const base = region.start - prefix.length;
  // Explicit frames preserve source order and bound context copying without recursive traversal.
  const frames: { readonly nodes: readonly ChildNode[]; index: number; readonly context: readonly SourceContext[] }[] = [
    { nodes: inline && root.first?.type === "rule" ? root.first.nodes : root.nodes, index: 0, context: region.context },
  ];
  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame === undefined) break;
    const node = frame.nodes[frame.index++];
    if (node === undefined) { frames.pop(); continue; }
    if (!out.consume()) return;
    const start = node.source?.start?.offset;
    const end = node.source?.end?.offset;
    if (start === undefined || end === undefined || base + start < region.start || base + end > region.end) {
      out.issue("unresolvable-location", whole);
      continue;
    }
    const span = out.span(base + start, base + end);
    let context: SourceContext;
    switch (node.type) {
      case "comment": continue;
      case "decl":
        if (!inline && !frame.context.some(context => context.kind === "selector")
          && !(node.parent?.type === "atrule" && DESCRIPTOR_RULES.has(node.parent.name.toLowerCase()))) {
          out.issue("unsupported-syntax", span);
          continue;
        }
        locateDeclaration(out, node, { ...region, context: frame.context });
        continue;
      case "rule":
        if (inline) { out.issue("unsupported-syntax", span); continue; }
        if (/[$`]|#\{/u.test(node.selector)) {
          out.issue("dynamic-source", span);
          continue;
        }
        context = { kind: "selector", name: node.raws.selector?.raw ?? node.selector, params: "", span };
        break;
      case "atrule":
        if (inline) { out.issue("unsupported-syntax", span); continue; }
        if (!CONTEXT_RULES.has(node.name.toLowerCase())) {
          out.issue(node.name.toLowerCase() === "import" ? "external-stylesheet" : "unsupported-syntax", span);
          continue;
        }
        context = { kind: "at-rule", name: node.name, params: node.raws.params?.raw ?? node.params, span };
        break;
      default: {
        const exhaustive: never = node;
        return exhaustive;
      }
    }
    if (frame.context.length >= SOURCE_LIMITS.depth) { out.issue("depth-budget", span); continue; }
    if (node.nodes) frames.push({ nodes: node.nodes, index: 0, context: [...frame.context, context] });
  }
}

function locateDeclaration(out: SourceCollector, node: Declaration, region: CssRegion): void {
  const base = region.start - (region.origin === "style-attribute" ? 2 : 0);
  const start = node.source?.start?.offset;
  const end = node.source?.end?.offset;
  if (start === undefined || end === undefined) { out.issue("unresolvable-location", null); return; }
  const declarationStart = base + start;
  const declarationEnd = base + end;
  const span = out.span(declarationStart, declarationEnd);
  const between = node.raws.between ?? ":";
  const rawValue = node.raws.value?.raw ?? node.value;
  const valueStart = declarationStart + node.prop.length + between.length;
  const valueEnd = valueStart + rawValue.length;
  const authored = out.input.text;
  if (!between.includes(":") || authored.slice(declarationStart, declarationStart + node.prop.length) !== node.prop
    || authored.slice(valueStart, valueEnd) !== rawValue || valueEnd > declarationEnd || rawValue.length === 0) {
    out.issue("unresolvable-location", span);
    return;
  }
  // PostCSS accepts non-CSS dialect constructs and legacy executable expressions.
  if (/[$`]|expression\s*\(/iu.test(rawValue) || !/^(?:--)?[-_a-zA-Z][-_a-zA-Z0-9]*$/u.test(node.prop)) {
    out.issue("unsupported-syntax", span);
    return;
  }
  const selectors = region.context.filter(context => context.kind === "selector");
  out.add({
    origin: region.origin, property: node.prop, value: rawValue, important: node.important === true,
    selector: selectors[selectors.length - 1]?.name ?? null, context: region.context,
    span, propertySpan: out.span(declarationStart, declarationStart + node.prop.length),
    valueSpan: out.span(valueStart, valueEnd),
  });
}
