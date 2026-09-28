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

const HORIZONTAL_CLASS = /(?:^|\s)(?:row|split|two-col|half|columns|(?:(?:sm|md|lg|xl):)?grid-cols-[2-9]|(?:(?:sm|md|lg|xl):)?flex-row|col-(?:sm|md|lg|xl)-\d+)(?=\s|$)/;
const VERTICAL_CLASS = /(?:^|\s)(?:flex-col|flex-column|grid-cols-1|stack|vertical)(?=\s|$)/;

/** Top-level track count of a grid-template-columns value, expanding repeat(N, ...); null when it cannot be read. */
export function gridTrackCount(value: string): number | null {
  const tracks: string[] = [];
  let depth = 0, current = "";
  for (const char of value.trim()) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth < 0) return null;
    if (depth === 0 && /\s/.test(char)) { if (current) tracks.push(current); current = ""; continue; }
    current += char;
  }
  if (depth !== 0) return null;
  if (current) tracks.push(current);
  let count = 0;
  for (const track of tracks) {
    if (track.startsWith("[")) continue;
    const repeat = /^repeat\(\s*(\d+)\s*,/i.exec(track);
    if (/^repeat\(/i.test(track) && !repeat) return null;
    count += repeat ? Number(repeat[1]) : 1;
  }
  return count;
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
  return HORIZONTAL_CLASS.test(classes);
}

function heroOf(root: HTMLElement): SourceEvidence["hero"] {
  const heading = root.querySelector("h1");
  if (!heading) return null;
  let region: HTMLElement | null = heading.parentNode as HTMLElement | null;
  while (region && region.parentNode && !["section", "header", "main", "body"].includes(region.tagName?.toLowerCase() ?? "") && !/hero|banner|masthead|jumbotron/.test(classOf(region))) region = region.parentNode as HTMLElement;
  if (!region) return null;
  const media = region.querySelector("img, picture, video");
  const centered = /(?:^|[\s-])(?:center|centered|text-center)\b/.test(classOf(heading) + " " + classOf(region)) || /text-align\s*:\s*center/i.test(`${heading.getAttribute("style") ?? ""} ${region.getAttribute("style") ?? ""}`);
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
  const columns = values(["grid-template-columns"]).flatMap(value => [...value.matchAll(/repeat\(\s*(\d)\s*,/g)].map(match => Number(match[1]))).filter(count => count >= 2 && count <= 4);

  const all = (selector: string) => roots.flatMap(root => root.querySelectorAll(selector));
  const text = roots.map(root => root.querySelectorAll("h1, h2, h3").map(heading => heading.text).join(" ")).join(" ").toLowerCase();
  const classes = all("[class], [id]").map(classOf).join(" ");
  const footerColumns = all("footer").map(footer => footer.querySelectorAll("ul, nav").length).filter(count => count >= 2);

  const svgs = all("svg").filter(svg => !/logo|brand/.test(classOf(svg) + classOf(svg.parentNode as HTMLElement)));
  const positiveStrokes = (svg: HTMLElement) => [svg, ...svg.querySelectorAll("*")]
    .filter(node => (node.getAttribute("stroke") ?? "").toLowerCase() !== "none")
    .map(node => node.getAttribute("stroke-width"))
    .filter((value): value is string => typeof value === "string" && /^\d*\.?\d+$/.test(value) && Number(value) > 0);
  const hasStroke = (svg: HTMLElement) => positiveStrokes(svg).length > 0 || [svg, ...svg.querySelectorAll("*")].some(node => { const stroke = (node.getAttribute("stroke") ?? "").toLowerCase(); return stroke !== "" && stroke !== "none"; });
  // Outline needs a positive stroke and no root fill; filled needs a fill and no positive stroke; anything else stays unclassified.
  const classified = svgs.map(svg => {
    const fill = (svg.getAttribute("fill") ?? "").toLowerCase();
    if (hasStroke(svg) && (fill === "none" || fill === "")) return "outline" as const;
    if (!hasStroke(svg) && fill !== "none") return "filled" as const;
    return null;
  }).filter((style): style is "outline" | "filled" => style !== null);
  const outline = classified.filter(style => style === "outline").length;
  const strokeWidth = mode(svgs.flatMap(positiveStrokes));

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
    icons: { count: svgs.length, style: classified.length < 2 ? null : outline * 2 > classified.length ? "outline" : outline * 2 < classified.length ? "filled" : null, strokeWidth },
    photos: images.filter(src => /\.(?:jpe?g|webp|avif)$/.test(src)).length,
    illustrations: images.filter(src => src.endsWith(".svg")).length,
    gradients: backgrounds.filter(value => /(?<!repeating-)(?:linear|radial|conic)-gradient\(/.test(value)).length,
    patterns: backgrounds.filter(value => /repeating-(?:linear|radial|conic)-gradient\(/.test(value)).length + values(["background-repeat"]).filter(value => value.startsWith("repeat") && value !== "repeat-x" && value !== "repeat-y").length,
    motionMs: durations.length ? [durations[0]!, durations.at(-1)!] : null,
    animations: values(["animation", "animation-name"]).filter(value => value !== "none").length,
  };
}
