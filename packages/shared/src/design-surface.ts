import type { ProjectType } from "./app";
import { isRecord, UpgradeContractError } from "./contract-parser";

/**
 * A design system is shared brand identity plus one contract per output geometry. `colors_and_type.css`
 * owns the shared part - colour, type families, spacing, radius, elevation, motion - and the website
 * grid; a surface owns what only applies to one geometry: a fluid page, a fixed 1920x1080 slide, or a
 * fixed content artboard. See doc/22-design-system-surfaces-2026-09-15.md.
 *
 * Surface-independent brand rules - a theme's "## Composition" prose and its --family-* structural
 * decisions - are NOT part of a surface. They keep travelling with the layout contract in
 * design-system-layout.ts, which every surface receives.
 */
export const DESIGN_SURFACES = ["website", "slides", "content"] as const;
export type DesignSurface = (typeof DESIGN_SURFACES)[number];

export const DESIGN_SURFACE_FILES: Readonly<Record<DesignSurface, string>> = {
  website: "surfaces/website.css",
  slides: "surfaces/slides.css",
  content: "surfaces/content.css",
};

/**
 * How a value is allowed to be written. A surface file reaches the prompt and the authored CSS, so a
 * token that parses as text but cannot act as a length, count or enum is rejected rather than passed
 * on: an unusable value must fall back to the default instead of silently blocking it.
 */
type TokenKind = "length" | "responsive" | "count" | "fraction" | "flag" | "anchor" | "aspect";

const TOKEN_KIND_PATTERN: Readonly<Record<TokenKind, RegExp>> = {
  length: /^\d{1,4}(?:\.\d{1,2})?px$/,
  responsive: /^(?:\d{1,4}(?:\.\d{1,2})?px|clamp\(\s*\d{1,4}(?:\.\d{1,2})?px\s*,\s*\d{1,3}(?:\.\d{1,2})?vw\s*,\s*\d{1,4}(?:\.\d{1,2})?px\s*\)|var\(--[a-z0-9-]{1,60}\))$/,
  count: /^\d{1,2}$/,
  fraction: /^(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/,
  flag: /^[01]$/,
  anchor: /^(?:top|center|bottom|left|right)$/,
  aspect: /^\d{1,2}\s\/\s\d{1,2}$/,
};

const SURFACE_TOKEN_KINDS: Readonly<Record<DesignSurface, Readonly<Record<string, TokenKind>>>> = {
  website: {
    "--web-type-hero": "responsive",
    "--web-type-heading": "responsive",
    "--web-type-body": "length",
    "--web-type-caption": "length",
    "--web-pad-block": "length",
  },
  slides: {
    "--slide-w": "length",
    "--slide-h": "length",
    "--slide-aspect": "aspect",
    "--slide-pad-edge": "length",
    "--slide-pad-block": "length",
    "--slide-columns": "count",
    "--slide-gutter": "length",
    "--slide-rule": "length",
    "--slide-type-hero": "length",
    "--slide-type-heading": "length",
    "--slide-type-body": "length",
    "--slide-type-caption": "length",
  },
  content: {
    "--content-base": "length",
    "--content-safe": "fraction",
    "--content-columns": "count",
    "--content-pad-block": "length",
    "--content-rule": "length",
    "--content-figure": "fraction",
    "--content-bleed": "flag",
    "--content-anchor": "anchor",
    "--content-type-hero": "length",
    "--content-type-sub": "length",
    "--content-type-body": "length",
    "--content-type-caption": "length",
  },
};

export const REQUIRED_SURFACE_TOKENS: Readonly<Record<DesignSurface, readonly string[]>> = {
  website: Object.keys(SURFACE_TOKEN_KINDS.website),
  slides: Object.keys(SURFACE_TOKEN_KINDS.slides),
  content: Object.keys(SURFACE_TOKEN_KINDS.content),
};

/**
 * Values a surface falls back to when neither the installed system nor its bundled source ships the
 * file. They are the constants the deck skill and the graphic craft block already hardcode, so a system
 * without surfaces behaves exactly as it did before this contract existed, and the theme generator
 * starts from the same numbers so a theme and a default never disagree about what a token means.
 */
export const DERIVED_SURFACE_TOKENS: Readonly<Record<DesignSurface, Readonly<Record<string, string>>>> = {
  website: {
    "--web-type-hero": "clamp(44px, 6.1vw, 88px)",
    "--web-type-heading": "clamp(32px, 3.9vw, 56px)",
    "--web-type-body": "17px",
    "--web-type-caption": "13px",
    "--web-pad-block": "24px",
  },
  slides: {
    "--slide-w": "1920px",
    "--slide-h": "1080px",
    "--slide-aspect": "16 / 9",
    "--slide-pad-edge": "72px",
    "--slide-pad-block": "32px",
    "--slide-columns": "12",
    "--slide-gutter": "32px",
    "--slide-rule": "1px",
    "--slide-type-hero": "80px",
    "--slide-type-heading": "52px",
    "--slide-type-body": "32px",
    "--slide-type-caption": "24px",
  },
  content: {
    "--content-base": "1080px",
    "--content-safe": "0.07",
    "--content-columns": "6",
    "--content-pad-block": "40px",
    "--content-rule": "2px",
    "--content-figure": "0.55",
    "--content-bleed": "0",
    "--content-anchor": "center",
    "--content-type-hero": "120px",
    "--content-type-sub": "56px",
    "--content-type-body": "32px",
    "--content-type-caption": "24px",
  },
};

/** Absolute floor for scaled content type, matching the craft self-check's readability floor. */
export const CONTENT_TYPE_FLOOR_PX = 12;

/**
 * How many type steps a content frame can actually carry.
 *
 * The ramp is authored at `--content-base` and scaled by the frame's shorter side, so on a banner the
 * 12px floor collapses the lower steps onto each other: every shipped theme prints body and caption at
 * exactly 12px on a 250px short side. Measured across all 41 themes, four steps stay distinct only at
 * 433px and above, three at 250px and above. The ladder therefore drops a step instead of emitting two
 * that render identically - fewer sizes on a small frame, not smaller ones.
 */
export const CONTENT_TYPE_LADDER = [
  { min_short_ratio: 440 / 1080, steps: ["hero", "sub", "body", "caption"] },
  { min_short_ratio: 250 / 1080, steps: ["hero", "sub", "caption"] },
  { min_short_ratio: 0, steps: ["hero", "caption"] },
] as const;

export type ContentTypeStep = (typeof CONTENT_TYPE_LADDER)[number]["steps"][number];

/** The type steps a frame of this shorter side may use, against the system's authored base. */
export function contentTypeStepsFor(shortSideCssPx: number, baseCssPx: number): readonly ContentTypeStep[] {
  const ratio = shortSideCssPx / baseCssPx;
  return (CONTENT_TYPE_LADDER.find((rung) => ratio >= rung.min_short_ratio) ?? CONTENT_TYPE_LADDER[2]).steps;
}

export const SURFACE_SECTION_KINDS = ["slides", "content", "imagery"] as const;
export type SurfaceSectionKind = (typeof SURFACE_SECTION_KINDS)[number];

/**
 * README headings a surface reads. Only the generated per-surface sections are read: "## Composition"
 * travels with the layout contract, and "## Image direction" is deliberately excluded because several
 * themes phrase it against the website opening's media position and aspect ratio, which is exactly the
 * website geometry a fixed frame must not inherit.
 */
const SURFACE_SECTION_HEADINGS: Readonly<Record<DesignSurface, readonly { readonly heading: string; readonly kind: SurfaceSectionKind }[]>> = {
  website: [],
  slides: [{ heading: "Slide deck", kind: "slides" }, { heading: "Image direction", kind: "imagery" }],
  content: [{ heading: "Content artboards", kind: "content" }, { heading: "Image direction", kind: "imagery" }],
};

/**
 * Labelled fields dropped from a section before it ships to a fixed surface.
 *
 * A theme's image direction is the strongest thing that separates its artboards from another theme's -
 * subject, treatment, light, palette behaviour - and all of it is geometry-free. Its `Framing` field is
 * not: several themes phrase framing against the website opening's hero region, and on a fixed frame
 * the framing is the surface's own job through --content-anchor, --content-figure and --slide-pad-edge.
 */
const EXCLUDED_SECTION_FIELDS: Readonly<Record<SurfaceSectionKind, readonly string[]>> = {
  slides: [],
  content: [],
  imagery: ["Framing"],
};

/**
 * Sections a surface is incomplete without. Imagery is deliberately absent: the donor themes ship no
 * `## Image direction`, and a theme that authors none is honestly imageless rather than broken.
 */
const REQUIRED_SURFACE_SECTIONS: Readonly<Record<DesignSurface, readonly SurfaceSectionKind[]>> = {
  website: [],
  slides: ["slides"],
  content: ["content"],
};

/** Drops whole labelled paragraphs (`**Label.** ...`) from an authored section. */
function stripFields(text: string, labels: readonly string[]): string {
  if (labels.length === 0) return text;
  return text
    .split(/\r?\n\s*\r?\n/)
    .filter((paragraph) => !labels.some((label) => new RegExp(`^\\*\\*${label}[.:]\\*\\*`).test(paragraph.trimStart())))
    .join("\n\n")
    .trim();
}

export type DesignSystemSurface = {
  readonly schema_version: 1;
  readonly surface: DesignSurface;
  readonly tokens: Readonly<Record<string, string>>;
  readonly sections: readonly { readonly kind: SurfaceSectionKind; readonly text: string }[];
  /**
   * Token names and section kinds that did not come from the system's own files, so the model can tell
   * a system's own decision from a default. Sorted, and always a subset of the keys present above.
   */
  readonly supplied: readonly string[];
};

const MAX_SECTION_CHARS = 1800;

function isValidToken(surface: DesignSurface, name: string, value: string): boolean {
  const kind = SURFACE_TOKEN_KINDS[surface][name];
  return kind !== undefined && TOKEN_KIND_PATTERN[kind].test(value);
}

/** The surface a project type renders into. A user never picks it; the deliverable decides. */
export function surfaceForProjectType(projectType: ProjectType): DesignSurface {
  switch (projectType) {
    case "slide_deck":
      return "slides";
    case "graphic":
    case "logo":
      return "content";
    default:
      return "website";
  }
}

export function extractDesignSystemSurface(
  css: string,
  readme: string,
  surface: DesignSurface,
): DesignSystemSurface {
  const tokens: Record<string, string> = {};
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)) {
    const name = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (isValidToken(surface, name, value)) tokens[name] = value;
  }
  const sections: { kind: SurfaceSectionKind; text: string }[] = [];
  const body = readme.replace(/```[\s\S]*?```/g, "");
  for (const { heading, kind } of SURFACE_SECTION_HEADINGS[surface]) {
    const match = new RegExp("^##\\s+" + heading + "\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))", "im").exec(body);
    const captured = match?.[1]?.replace(/^\|.*$/gm, "").trim() ?? "";
    const text = stripFields(captured, EXCLUDED_SECTION_FIELDS[kind]).slice(0, MAX_SECTION_CHARS);
    if (text) sections.push({ kind, text });
  }
  return { schema_version: 1, surface, tokens, sections, supplied: [] };
}

/**
 * Fills what "local" lacks from "fallback" without ever overwriting an authored value, recording every
 * filled key so the prompt can say which values are the system's own.
 */
export function supplementDesignSystemSurface(
  local: DesignSystemSurface,
  fallback: DesignSystemSurface,
): DesignSystemSurface {
  const tokens: Record<string, string> = { ...local.tokens };
  const supplied = new Set(local.supplied);
  for (const [name, value] of Object.entries(fallback.tokens)) {
    if (name in tokens) continue;
    tokens[name] = value;
    supplied.add(name);
  }
  const sections = [...local.sections];
  for (const section of fallback.sections) {
    if (sections.some((entry) => entry.kind === section.kind)) continue;
    sections.push(section);
    supplied.add(section.kind);
  }
  return {
    schema_version: 1,
    surface: local.surface,
    tokens,
    sections: SURFACE_SECTION_KINDS.flatMap((kind) => sections.filter((section) => section.kind === kind)),
    supplied: [...supplied].sort(),
  };
}

/** Required tokens and sections this surface is still missing. */
export function missingDesignSystemSurface(surface: DesignSystemSurface): readonly string[] {
  return [
    ...REQUIRED_SURFACE_TOKENS[surface.surface].filter((name) => !surface.tokens[name]),
    ...REQUIRED_SURFACE_SECTIONS[surface.surface]
      .filter((kind) => !surface.sections.some((section) => section.kind === kind)),
  ];
}

export function parseDesignSystemSurface(input: unknown): DesignSystemSurface {
  const invalid = (): never => {
    throw new UpgradeContractError("invalid_field", "design_system_surface");
  };
  if (
    !isRecord(input)
    || Object.keys(input).some((key) => !["schema_version", "surface", "tokens", "sections", "supplied"].includes(key))
    || input.schema_version !== 1
    || !DESIGN_SURFACES.some((surface) => surface === input.surface)
    || !isRecord(input.tokens)
    || !Array.isArray(input.sections)
    || !Array.isArray(input.supplied)
    || input.sections.length > SURFACE_SECTION_KINDS.length
  ) return invalid();
  const surface = input.surface as DesignSurface;
  const tokens: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.tokens)) {
    if (typeof value !== "string" || !isValidToken(surface, name, value)) return invalid();
    tokens[name] = value;
  }
  const sections = input.sections.map((section) => {
    if (
      !isRecord(section)
      || Object.keys(section).length !== 2
      || !SURFACE_SECTION_KINDS.some((kind) => kind === section.kind)
      || typeof section.text !== "string"
      || section.text.length === 0
      || section.text.length > MAX_SECTION_CHARS
    ) return invalid();
    return { kind: section.kind as SurfaceSectionKind, text: section.text };
  });
  if (new Set(sections.map((section) => section.kind)).size !== sections.length) return invalid();
  const known = new Set<string>([...Object.keys(tokens), ...sections.map((section) => section.kind)]);
  const supplied = input.supplied.map((key) => {
    if (typeof key !== "string" || !known.has(key)) return invalid();
    return key;
  });
  if (new Set(supplied).size !== supplied.length) return invalid();
  return { schema_version: 1, surface, tokens, sections, supplied: [...supplied].sort() };
}
