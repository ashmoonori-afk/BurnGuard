import type { DesignBriefDensity, DesignBriefOutputSize, DesignBriefV1 } from "@bg/shared";

/** CSS px per slide for each fixed output size; print pages are landscape at 96 px per inch. */
const SLIDE_SIZES: Readonly<Partial<Record<DesignBriefOutputSize, { readonly width: number; readonly height: number; readonly aspect: string }>>> = {
  "widescreen-16x9": { width: 1920, height: 1080, aspect: "16 / 9" },
  "standard-4x3": { width: 1440, height: 1080, aspect: "4 / 3" },
  a4: { width: 1123, height: 794, aspect: "297 / 210" },
  letter: { width: 1056, height: 816, aspect: "11 / 8.5" },
};

const DENSITY_GUIDANCE: Readonly<Record<DesignBriefDensity, string>> = {
  sparse: "few elements per view with generous whitespace; split content across more units rather than packing a view.",
  balanced: "one dominant element with a few supporting ones per view; the usual spacing scale.",
  dense: "more content per view with tighter spacing, never below the type floor or inside the safe area.",
};

export function appendDesignBriefContext(
  lines: string[],
  designBrief: DesignBriefV1 | null,
): void {
  if (designBrief === null) return;
  lines.push("<burnguard-design-brief-v1>");
  lines.push(JSON.stringify(designBrief));
  lines.push("</burnguard-design-brief-v1>");
  if (designBrief.output_type === "prototype" && designBrief.section_count !== undefined) lines.push(`Create exactly ${designBrief.section_count} complete vertical content sections, each with substantive copy and a purpose-built layout; navigation and footer do not count as sections.`);
  if (designBrief.pages !== undefined) lines.push(`Create exactly these pages as real local files linked from the shared nav: index.html, ${designBrief.pages.join(", ")}`);
  const slide = designBrief.output_type === "slide_deck" ? SLIDE_SIZES[designBrief.output_size] : undefined;
  if (slide !== undefined) lines.push(`Requested slide dimensions (${designBrief.output_size}): ${slide.width} x ${slide.height} CSS px per slide. Declare --slide-w: ${slide.width}px, --slide-h: ${slide.height}px and --slide-aspect: ${slide.aspect} in :root; these are the slide dimensions the artboard verification refers to and they override a surface's default size.`);
  lines.push(`Brief density (${designBrief.density}): ${DENSITY_GUIDANCE[designBrief.density]}`);
  lines.push("");
}
