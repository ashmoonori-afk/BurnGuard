import { HTMLElement, parse } from "node-html-parser";
import type { CssDeclarationEvidence } from "./extraction-css";

export type SourceEvidence = {
  /** Null when the source has no h1. Arrangement is never inferred: it depends on the cascade. */
  readonly hero: { readonly media: boolean } | null;
  readonly featureColumns: number | null;
  readonly proofStrip: boolean;
  readonly pricing: boolean;
  readonly testimonials: boolean;
  readonly footerColumns: number | null;
  readonly alignment: "left" | "center" | "right" | null;
  /** Inline SVG icons outside logos; their paint depends on the cascade, so only the count is observed. */
  readonly iconCount: number;
  readonly photos: number;
  readonly illustrations: number;
  readonly gradients: number;
  readonly patterns: number;
  readonly motionMs: readonly [number, number] | null;
  readonly animations: number;
};

const MAX_HTML_CHARS = 1_000_000;
const SUBSTITUTIONS = ["var", "env", "attr"] as const;
const SUBSTITUTIONS_AND_MATH = [...SUBSTITUTIONS, "calc", "min", "max", "clamp"] as const;

/** The value with every call to the named functions removed, nested parentheses included. */
export function withoutFunctions(value: string, names: readonly string[]): string {
  const start = new RegExp(`^(?:${names.join("|")})\\(`, "i");
  let out = "", index = 0;
  while (index < value.length) {
    const previous = value[index - 1] ?? " ";
    if (!/[\w-]/.test(previous) && start.test(value.slice(index))) {
      let depth = 0;
      for (; index < value.length; index += 1) {
        if (value[index] === "(") depth += 1;
        if (value[index] === ")" && --depth === 0) { index += 1; break; }
      }
      out += " ";
      continue;
    }
    out += value[index];
    index += 1;
  }
  return out;
}

function mode<T>(values: readonly T[]): T | null {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | null = null;
  for (const [value, count] of counts) if (best === null || count > counts.get(best)!) best = value;
  return best;
}

const classOf = (element: HTMLElement) => `${element.getAttribute("class") ?? ""} ${element.getAttribute("id") ?? ""}`.toLowerCase();

/**
 * Column count of a grid-template-columns value: named lines are ignored, repeat(N, list) counts N times
 * the tracks in list, and a trailing !important is dropped. Null for auto-fill/auto-fit, subgrid,
 * masonry or anything unreadable, so callers never claim a count the source does not fix.
 */
export function gridTrackCount(value: string): number | null {
  const tokens: string[] = [];
  let depth = 0, current = "";
  for (const char of value.replace(/!\s*important\s*$/i, "").trim()) {
    // A named-line group is its own token even when written without spaces, e.g. [a]1fr[b].
    if (char === "[" && depth === 0 && current) { tokens.push(current); current = ""; }
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (depth < 0) return null;
    if (depth === 0 && /\s/.test(char)) { if (current) tokens.push(current); current = ""; continue; }
    current += char;
    if (char === "]" && depth === 0) { tokens.push(current); current = ""; }
  }
  if (depth !== 0) return null;
  if (current) tokens.push(current);
  if (tokens.length === 0) return null;
  let count = 0;
  for (const token of tokens) {
    if (token.startsWith("[")) continue;
    if (/^(?:subgrid|masonry|none|auto-fill|auto-fit)$/i.test(token) || token.includes("!") || /var\(|env\(|attr\(/i.test(token)) return null;
    const repeat = /^repeat\(\s*(\d+)\s*,([\s\S]*)\)$/i.exec(token);
    if (/^repeat\(/i.test(token)) {
      const inner = repeat ? gridTrackCount(repeat[2]!) : null;
      if (!repeat || inner === null) return null;
      count += Number(repeat[1]) * inner;
      continue;
    }
    count += 1;
  }
  return count > 0 ? count : null;
}

function heroOf(root: HTMLElement): SourceEvidence["hero"] {
  const heading = root.querySelector("h1");
  if (!heading) return null;
  // The opening region is the nearest section/header or an element whose class token is exactly a hero
  // name; wrappers such as hero-content never end the search. Without such a region nothing is claimed.
  for (let region: HTMLElement | null = heading.parentNode as HTMLElement | null; region?.tagName; region = region.parentNode as HTMLElement | null) {
    const tag = region.tagName.toLowerCase();
    if (tag === "main" || tag === "body") return null;
    if (tag === "section" || tag === "header" || /(?:^|\s)(?:hero|banner|masthead|jumbotron)(?=\s|$)/.test(classOf(region))) return { media: region.querySelector("img, picture, video") !== null };
  }
  return null;
}

/**
 * Observable brand evidence in the source HTML and CSS: section structure, alignment, icon, image,
 * background and motion treatment. Every field is null, zero or false when the source does not show
 * it, so callers can label the matching rule as a default instead of presenting it as extracted.
 */
export function collectSourceEvidence(htmlSources: readonly string[], declarations: readonly CssDeclarationEvidence[]): SourceEvidence {
  const roots = htmlSources.filter(html => html.length <= MAX_HTML_CHARS).map(html => parse(html, { comment: false }));
  const values = (properties: readonly string[]) => declarations.filter(item => properties.includes(item.property.toLowerCase())).map(item => item.value.toLowerCase());

  // Physical keywords only; start/end depend on writing direction, so a dominant logical value stays unknown.
  const aligns = values(["text-align"]).map(value => value.replace(/!\s*important/, "").trim());
  const dominant = mode(aligns);
  const alignment = aligns.length >= 3 && dominant !== null && aligns.filter(value => value === dominant).length * 2 > aligns.length && (dominant === "left" || dominant === "center" || dominant === "right") ? dominant : null;

  const heroes = roots.map(heroOf).filter((value): value is NonNullable<SourceEvidence["hero"]> => value !== null);
  const columns = values(["grid-template-columns"]).map(gridTrackCount).filter((count): count is number => count !== null && count >= 2 && count <= 4);

  const all = (selector: string) => roots.flatMap(root => root.querySelectorAll(selector));
  const text = roots.map(root => root.querySelectorAll("h1, h2, h3").map(heading => heading.text).join(" ")).join(" ").toLowerCase();
  const classes = all("[class], [id]").map(classOf).join(" ");
  // Link lists are the columns; a nav wrapper only counts when it holds no list of its own.
  const footerColumns = all("footer").map(footer => footer.querySelectorAll("ul, ol").length + footer.querySelectorAll("nav").filter(nav => nav.querySelectorAll("ul, ol").length === 0).length).filter(count => count >= 2);

  const svgs = all("svg").filter(svg => !/logo|brand/.test(classOf(svg) + classOf(svg.parentNode as HTMLElement)));
  const images = all("img").map(image => (image.getAttribute("src") ?? "").toLowerCase().split(/[?#]/)[0] ?? "").filter(src => !/logo|brand|icon|favicon/.test(src));
  // Gradients inside a substitution fallback may never apply, so only independently written ones count.
  const backgrounds = values(["background", "background-image"]).map(value => withoutFunctions(value, SUBSTITUTIONS));
  const durations = values(["transition", "transition-duration", "animation", "animation-duration"]).flatMap(value => [...withoutFunctions(value, SUBSTITUTIONS_AND_MATH).matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)(?![\w-])/g)].map(match => Math.round(Number(match[1]) * (match[2] === "s" ? 1000 : 1)))).filter(ms => ms > 0 && ms <= 5000).sort((a, b) => a - b);

  return {
    hero: heroes[0] ?? null,
    featureColumns: mode(columns),
    proofStrip: /\b(?:logos|clients|customers|partners|trusted)\b/.test(classes),
    pricing: /\b(?:pricing|plans?)\b/.test(classes) || /\bpricing\b|per month|\/\s?mo\b/.test(text),
    testimonials: all("blockquote").length > 0 || /\b(?:testimonials?|reviews?)\b/.test(classes),
    footerColumns: footerColumns.length ? Math.max(...footerColumns) : null,
    alignment,
    iconCount: svgs.length,
    photos: images.filter(src => /\.(?:jpe?g|webp|avif)$/.test(src)).length,
    illustrations: images.filter(src => src.endsWith(".svg")).length,
    gradients: backgrounds.filter(value => /(?<!repeating-)(?:linear|radial|conic)-gradient\(/.test(value)).length,
    patterns: backgrounds.filter(value => /repeating-(?:linear|radial|conic)-gradient\(/.test(value)).length + values(["background-repeat"]).filter(value => value.startsWith("repeat") && value !== "repeat-x" && value !== "repeat-y").length,
    motionMs: durations.length ? [durations[0]!, durations.at(-1)!] : null,
    animations: values(["animation", "animation-name"]).filter(value => value !== "none").length,
  };
}
