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
  readonly backgroundImages: number;
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

const SPLIT_HINT = /\b(?:split|grid|row|columns?|two-col|half|cols?-\d+|col-(?:md|lg)-\d+|flex)\b/;

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
    if (headingBranch && mediaBranch) return { media: true, arrangement: headingBranch !== mediaBranch && SPLIT_HINT.test(classOf(container)) ? "split" : centered ? "centered" : null };
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
  const stroked = svgs.filter(svg => svg.getAttribute("fill") === "none" || svg.querySelector("[stroke-width]") !== null || svg.getAttribute("stroke-width") !== undefined);
  const strokeWidth = mode(svgs.flatMap(svg => [svg.getAttribute("stroke-width"), ...svg.querySelectorAll("[stroke-width]").map(node => node.getAttribute("stroke-width"))]).filter((value): value is string => typeof value === "string" && /^\d*\.?\d+$/.test(value)));

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
    icons: { count: svgs.length, style: svgs.length < 2 ? null : stroked.length * 2 >= svgs.length ? "outline" : "filled", strokeWidth },
    photos: images.filter(src => /\.(?:jpe?g|webp|avif)$/.test(src)).length,
    illustrations: images.filter(src => src.endsWith(".svg")).length,
    gradients: backgrounds.filter(value => /(?<!repeating-)(?:linear|radial|conic)-gradient\(/.test(value)).length,
    backgroundImages: backgrounds.filter(value => /url\(/.test(value)).length,
    patterns: backgrounds.filter(value => /repeating-(?:linear|radial|conic)-gradient\(/.test(value)).length + values(["background-repeat"]).filter(value => value.startsWith("repeat") && value !== "repeat-x" && value !== "repeat-y").length,
    motionMs: durations.length ? [durations[0]!, durations.at(-1)!] : null,
    animations: values(["animation", "animation-name"]).filter(value => value !== "none").length,
  };
}
