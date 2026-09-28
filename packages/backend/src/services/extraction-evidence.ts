import { HTMLElement, parse } from "node-html-parser";
import type { CssDeclarationEvidence } from "./extraction-css";

export type SourceEvidence = {
  /** Null when the source has no h1; arrangement is null when its structure does not show one. */
  readonly hero: { readonly media: boolean; readonly arrangement: "split" | "centered" | null } | null;
  readonly featureColumns: number | null;
  readonly proofStrip: boolean;
  readonly pricing: boolean;
  readonly testimonials: boolean;
  readonly footerColumns: number | null;
  readonly alignment: "left" | "center" | null;
  readonly icons: { readonly count: number; readonly style: "outline" | "filled" | null; readonly strokeWidth: string | null };
  readonly photos: number;
  readonly illustrations: number;
  readonly gradients: number;
  readonly patterns: number;
  readonly motionMs: readonly [number, number] | null;
  readonly animations: number;
};

const MAX_HTML_CHARS = 1_000_000;

function mode<T>(values: readonly T[]): T | null {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | null = null;
  for (const [value, count] of counts) if (best === null || count > counts.get(best)!) best = value;
  return best;
}

const classOf = (element: HTMLElement) => `${element.getAttribute("class") ?? ""} ${element.getAttribute("id") ?? ""}`.toLowerCase();

const within = (ancestor: HTMLElement, node: HTMLElement): boolean => {
  for (let current: HTMLElement | null = node; current; current = current.parentNode as HTMLElement | null) if (current === ancestor) return true;
  return false;
};

// Only utility-framework classes with fixed meaning (Tailwind, Bootstrap) count; author class names can be restyled.
const HORIZONTAL_CLASS = /(?:^|\s)(?:(?:sm|md|lg|xl):)?(?:grid-cols-[2-9]|flex-row)(?=\s|$)/;
const BOOTSTRAP_COLUMN = /(?:^|\s)col-(?:sm|md|lg|xl)-(?:[1-9]|1[01])(?=\s|$)/;
const VERTICAL_CLASS = /(?:^|\s)(?:flex-col|flex-column|grid-cols-1|stack|vertical)(?=\s|$)/;

/**
 * Column count of a grid-template-columns value: named lines are ignored, repeat(N, list) counts N times
 * the tracks in list, and a trailing !important is dropped. Null for auto-fill/auto-fit, subgrid,
 * masonry or anything unreadable, so callers never claim a count the source does not fix.
 */
export function gridTrackCount(value: string): number | null {
  const tokens: string[] = [];
  let depth = 0, current = "";
  for (const char of value.replace(/!\s*important\s*$/i, "").trim()) {
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (depth < 0) return null;
    if (depth === 0 && /\s/.test(char)) { if (current) tokens.push(current); current = ""; continue; }
    current += char;
  }
  if (depth !== 0) return null;
  if (current) tokens.push(current);
  if (tokens.length === 0) return null;
  let count = 0;
  for (const token of tokens) {
    if (token.startsWith("[")) continue;
    if (/^(?:subgrid|masonry|none|auto-fill|auto-fit)$/i.test(token) || token.includes("!")) return null;
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

/** Horizontal only on explicit row evidence; any explicit vertical signal wins and uncertainty stays false. */
function arrangesHorizontally(container: HTMLElement): boolean {
  const style = (container.getAttribute("style") ?? "").toLowerCase().replace(/\s+/g, "");
  const classes = classOf(container);
  if (/flex-direction:column|display:block/.test(style) || (VERTICAL_CLASS.test(classes) && !/(?:sm|md|lg|xl):(?:grid-cols-[2-9]|flex-row)/.test(classes))) return false;
  if (/display:flex/.test(style)) return true;
  if (/display:grid/.test(style)) {
    const columns = /grid-template-columns\s*:\s*([^;]+)/i.exec(container.getAttribute("style") ?? "")?.[1];
    return columns !== undefined && (gridTrackCount(columns) ?? 0) >= 2;
  }
  if (HORIZONTAL_CLASS.test(classes)) return true;
  return /(?:^|\s)row(?=\s|$)/.test(classes) && container.childNodes.filter((node): node is HTMLElement => node instanceof HTMLElement).filter(child => BOOTSTRAP_COLUMN.test(classOf(child))).length >= 2;
}

function heroOf(root: HTMLElement): SourceEvidence["hero"] {
  const heading = root.querySelector("h1");
  if (!heading) return null;
  let region: HTMLElement | null = heading.parentNode as HTMLElement | null;
  while (region && region.parentNode && !["section", "header", "main", "body"].includes(region.tagName?.toLowerCase() ?? "") && !/hero|banner|masthead|jumbotron/.test(classOf(region))) region = region.parentNode as HTMLElement;
  if (!region) return null;
  const media = region.querySelector("img, picture, video");
  const centered = /(?:^|\s)(?:(?:sm|md|lg|xl):)?text-center(?=\s|$)/.test(classOf(heading) + " " + classOf(region)) || /text-align\s*:\s*center/i.test(`${heading.getAttribute("style") ?? ""} ${region.getAttribute("style") ?? ""}`);
  if (!media) return { media: false, arrangement: centered ? "centered" : null };
  // Split only when copy and media sit in different children of a container marked as a row or grid.
  for (let container: HTMLElement | null = media.parentNode as HTMLElement | null; container && container !== region.parentNode; container = container.parentNode as HTMLElement | null) {
    const branches = container.childNodes.filter((node): node is HTMLElement => node instanceof HTMLElement);
    const headingBranch = branches.find(branch => within(branch, heading));
    const mediaBranch = branches.find(branch => within(branch, media));
    if (headingBranch && mediaBranch) return { media: true, arrangement: headingBranch !== mediaBranch && arrangesHorizontally(container) ? "split" : centered ? "centered" : null };
  }
  return { media: true, arrangement: centered ? "centered" : null };
}

/**
 * Observable brand evidence in the source HTML and CSS: section structure, alignment, icon, image,
 * background and motion treatment. Every field is null, zero or false when the source does not show
 * it, so callers can label the matching rule as a default instead of presenting it as extracted.
 */
export function collectSourceEvidence(htmlSources: readonly string[], declarations: readonly CssDeclarationEvidence[]): SourceEvidence {
  const roots = htmlSources.filter(html => html.length <= MAX_HTML_CHARS).map(html => parse(html, { comment: false }));
  const values = (properties: readonly string[]) => declarations.filter(item => properties.includes(item.property.toLowerCase())).map(item => item.value.toLowerCase());

  const aligns = values(["text-align"]).map(value => value.trim()).filter(value => ["center", "left", "start"].includes(value));
  const centered = aligns.filter(value => value === "center").length;
  const alignment = aligns.length < 3 ? null : centered * 2 > aligns.length ? "center" : "left";

  const heroes = roots.map(heroOf).filter((value): value is NonNullable<SourceEvidence["hero"]> => value !== null);
  const columns = values(["grid-template-columns"]).map(gridTrackCount).filter((count): count is number => count !== null && count >= 2 && count <= 4);

  const all = (selector: string) => roots.flatMap(root => root.querySelectorAll(selector));
  const text = roots.map(root => root.querySelectorAll("h1, h2, h3").map(heading => heading.text).join(" ")).join(" ").toLowerCase();
  const classes = all("[class], [id]").map(classOf).join(" ");
  // Link lists are the columns; a nav wrapper only counts when it holds no list of its own.
  const footerColumns = all("footer").map(footer => footer.querySelectorAll("ul, ol").length + footer.querySelectorAll("nav").filter(nav => nav.querySelectorAll("ul, ol").length === 0).length).filter(count => count >= 2);

  const svgs = all("svg").filter(svg => !/logo|brand/.test(classOf(svg) + classOf(svg.parentNode as HTMLElement)));
  // SVG defaults: stroke none, stroke-width 1, fill black; each value inherits from the nearest ancestor that sets it.
  // An inline style beats the presentation attribute on the same element.
  const inherited = (node: HTMLElement, name: string, root: HTMLElement): string | null => {
    for (let current: HTMLElement | null = node; current; current = current === root ? null : current.parentNode as HTMLElement | null) {
      const inline = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i").exec(current.getAttribute("style") ?? "")?.[1];
      const value = inline ?? current.getAttribute(name);
      if (value !== undefined && value !== null) return value.replace(/!\s*important/i, "").trim().toLowerCase();
    }
    return null;
  };
  // Stylesheet paint rules cannot be matched to markup here, so they make the icon treatment unknown.
  const stylesheetPaint = declarations.some(item => ["fill", "stroke", "stroke-width"].includes(item.property.toLowerCase()));
  const iconStyle = (svg: HTMLElement): { readonly style: "outline" | "filled" | null; readonly widths: readonly string[] } => {
    const shapes = svg.querySelectorAll("path, circle, rect, ellipse, polygon, polyline, line");
    const strokeWidths: string[] = [];
    let stroked = 0, filled = 0;
    for (const shape of shapes) {
      const stroke = inherited(shape, "stroke", svg);
      const width = inherited(shape, "stroke-width", svg) ?? "1";
      if (stroke !== null && stroke !== "none" && stroke !== "transparent" && /^\d*\.?\d+$/.test(width) && Number(width) > 0) { stroked += 1; strokeWidths.push(width); }
      const fill = inherited(shape, "fill", svg);
      if (shape.tagName.toLowerCase() !== "line" && fill !== "none" && fill !== "transparent") filled += 1;
    }
    if (stroked > 0 && filled === 0) return { style: "outline", widths: strokeWidths };
    if (filled > 0 && stroked === 0) return { style: "filled", widths: [] };
    return { style: null, widths: [] };
  };
  const styles = svgs.map(iconStyle);
  const classified = styles.map(entry => entry.style).filter((style): style is "outline" | "filled" => style !== null);
  const outline = classified.filter(style => style === "outline").length;
  const iconSetStyle = stylesheetPaint || classified.length < 2 ? null : outline * 2 > classified.length ? "outline" : outline * 2 < classified.length ? "filled" : null;
  const strokeWidth = iconSetStyle === "outline" ? mode(styles.filter(entry => entry.style === "outline").flatMap(entry => entry.widths)) : null;

  const images = all("img").map(image => (image.getAttribute("src") ?? "").toLowerCase().split(/[?#]/)[0] ?? "").filter(src => !/logo|brand|icon|favicon/.test(src));
  const backgrounds = values(["background", "background-image"]);
  const durations = values(["transition", "transition-duration", "animation", "animation-duration"]).flatMap(value => [...value.matchAll(/(\d*\.?\d+)(ms|s)\b/g)].map(match => Math.round(Number(match[1]) * (match[2] === "s" ? 1000 : 1)))).filter(ms => ms > 0 && ms <= 5000).sort((a, b) => a - b);

  return {
    hero: heroes[0] ?? null,
    featureColumns: mode(columns),
    proofStrip: /\b(?:logos|clients|customers|partners|trusted)\b/.test(classes),
    pricing: /\b(?:pricing|plans?)\b/.test(classes) || /\bpricing\b|per month|\/\s?mo\b/.test(text),
    testimonials: all("blockquote").length > 0 || /\b(?:testimonials?|reviews?)\b/.test(classes),
    footerColumns: footerColumns.length ? Math.min(6, Math.max(...footerColumns)) : null,
    alignment,
    icons: { count: svgs.length, style: iconSetStyle, strokeWidth },
    photos: images.filter(src => /\.(?:jpe?g|webp|avif)$/.test(src)).length,
    illustrations: images.filter(src => src.endsWith(".svg")).length,
    gradients: backgrounds.filter(value => /(?<!repeating-)(?:linear|radial|conic)-gradient\(/.test(value)).length,
    patterns: backgrounds.filter(value => /repeating-(?:linear|radial|conic)-gradient\(/.test(value)).length + values(["background-repeat"]).filter(value => value.startsWith("repeat") && value !== "repeat-x" && value !== "repeat-y").length,
    motionMs: durations.length ? [durations[0]!, durations.at(-1)!] : null,
    animations: values(["animation", "animation-name"]).filter(value => value !== "none").length,
  };
}
