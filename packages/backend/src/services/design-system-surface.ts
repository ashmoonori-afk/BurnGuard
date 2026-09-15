import path from "node:path";
import { createHash } from "node:crypto";
import legacyDeckHashes from "../data/deck-legacy-hashes.json";
import {
  CONTENT_TYPE_FLOOR_PX,
  DERIVED_SURFACE_TOKENS,
  DESIGN_SURFACE_FILES,
  extractDesignSystemSurface,
  supplementDesignSystemSurface,
  type DesignSurface,
  type DesignSystemSurface,
} from "@bg/shared";
import {
  bundledDesignSystemSourceDir,
  readDesignSystemSourceFile,
  type LayoutSystem,
} from "./design-system-layout";

export type DesignSystemSurfaceRead = {
  readonly contract: DesignSystemSurface;
  /** Absolute path of the system's own surface file, or null when it ships none. */
  readonly file: string | null;
};

/**
 * Resolves one surface for a system: the system's own files first, then the repository copy of a
 * bundled system, then the derived defaults. An installation seeded before surfaces existed therefore
 * reads the current contract without any of its authored files being rewritten.
 */
export async function readDesignSystemSurface(
  system: LayoutSystem,
  surface: DesignSurface,
): Promise<DesignSystemSurfaceRead> {
  const root = system.dir_path;
  const relativeSurface = DESIGN_SURFACE_FILES[surface].split("/").join(path.sep);
  const [css, readme] = await Promise.all([
    readDesignSystemSourceFile(root, relativeSurface),
    system.readme_md_path ? readDesignSystemSourceFile(root, path.relative(root, system.readme_md_path)) : "",
  ]);
  const local = extractDesignSystemSurface(css, readme, surface);
  const source = bundledDesignSystemSourceDir(system.id);
  let resolved = local;
  if (source !== null && path.resolve(source) !== path.resolve(root)) {
    const [bundledCss, bundledReadme] = await Promise.all([
      readDesignSystemSourceFile(source, relativeSurface),
      readDesignSystemSourceFile(source, "README.md"),
    ]);
    const bundled = extractDesignSystemSurface(bundledCss, bundledReadme, surface);
    // Only the exact shipped v0.5.15 values upgrade. Any user-authored change retains precedence;
    // this is a read-time fallback, so managed files and their receipts remain untouched.
    const legacy = surface === "slides" && system.id.startsWith("builtin-theme-")
      ? legacyDeckHashes[system.id.slice("builtin-theme-".length) as keyof typeof legacyDeckHashes] : undefined;
    const hash = (value: string) => createHash("sha256").update(value.replace(/\r\n/g, "\n")).digest("hex");
    const upgradeTokens = legacy && hash(JSON.stringify(local.tokens)) === legacy.css;
    const upgradeSection = legacy && hash(local.sections.find(section => section.kind === "slides")?.text ?? "") === legacy.section;
    resolved = supplementDesignSystemSurface({
      ...local,
      tokens: upgradeTokens ? {} : local.tokens,
      sections: upgradeSection ? local.sections.filter(section => section.kind !== "slides") : local.sections,
    }, bundled);
  }
  return {
    contract: supplementDesignSystemSurface(resolved, {
      schema_version: 1,
      surface,
      tokens: DERIVED_SURFACE_TOKENS[surface],
      sections: [],
      supplied: [],
    }),
    file: css ? path.join(root, relativeSurface) : null,
  };
}

/** Surface stylesheet for a system created at runtime, written from the shared derived defaults. */
export function renderDerivedSurfaceCss(surface: DesignSurface): string {
  const body = Object.entries(DERIVED_SURFACE_TOKENS[surface])
    .map(([token, value]) => `  ${token}: ${value};`)
    .join("\n");
  return [
    `/* ${surface} surface - derived defaults. Edit these values to make them this system's own. */`,
    "/* Shared brand identity - colour, type families, spacing, radius, elevation, motion - stays in colors_and_type.css. */",
    "",
    ":root {",
    body,
    "}",
    "",
  ].join("\n");
}

/**
 * README sections an extracted system needs so its slides and content surfaces are complete. They are
 * deliberately generic: extraction cannot know a brand's composition, and the values match the derived
 * defaults, so a user editing them is changing their own system rather than overriding a hidden rule.
 */
export const DERIVED_SURFACE_README_SECTIONS = [
  "",
  "## Surfaces",
  "",
  "This system has one contract per output geometry. Shared brand identity stays in `colors_and_type.css` together with the website grid; each surface owns only what its own geometry needs.",
  "",
  "| Surface | File | Owns | Used by |",
  "|---|---|---|---|",
  "| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |",
  "| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |",
  "| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |",
  "",
  `Content values are authored for a \`--content-base\` shorter side. Per artboard set \`--content-short\` to that frame's shorter side and \`--content-scale: calc(var(--content-short) / var(--content-base))\`, then size type as \`max(${CONTENT_TYPE_FLOOR_PX}px, calc(var(--content-type-body) * var(--content-scale)))\`. \`--content-safe\` is a fraction of the shorter side.`,
  "",
  "## Slide deck",
  "",
  "Slides are fixed 1920 x 1080 CSS px artboards at 16 / 9, not pages: no navigation bar, no footer, no reading measure, no breakpoint, no hover. Nothing required sits outside `--slide-pad-edge`, and `--slide-type-caption` is the smallest type on any slide.",
  "",
  "- Ground: the surface and background tokens from `colors_and_type.css`; the brand accent marks one element per slide.",
  "- Cover: one oversized title on the brand ground with a short context line, mirrored by the closing slide.",
  "- Structure: one takeaway per slide at `--slide-type-heading` with support at `--slide-type-body`; prefer structure over long bullet lists.",
  "- Imagery: one relevant image per slide at most, placed inside the safe area unless the request asks for full bleed.",
  "- Never: web density, a navigation bar or footer on a slide, text below the caption step.",
  "",
  "## Content artboards",
  "",
  "Each artboard is one fixed frame at the size the request declares; that kind's own rules - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's section sequence - come first, and the rules below govern how each frame or section looks.",
  "",
  "- Frame: the brand ground with required content inside the safe inset.",
  "- Composition: one claim per frame; in a set the first frame opens and the last carries the call to action.",
  "- Type: `--content-type-hero` for the claim, `--content-type-sub` for support, nothing below `--content-type-caption` once scaled.",
  "- Figure: one relevant image at `--content-figure` of the shorter side against `--content-anchor`.",
  "- Never: scroll, hover, viewport units, or text crossing the safe inset.",
  "",
].join("\n");
