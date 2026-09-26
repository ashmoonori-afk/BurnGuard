import { lstat, readFile } from "node:fs/promises";
import {
  LOGO_ACTION_TAG,
  LOGO_CANDIDATE_COUNT,
  LOGO_FILES,
  LOGO_PAGE,
  LOGO_SOURCE_ATTRIBUTE,
  UpgradeContractError,
  parseLogoAction,
  parseLogoManifestV1,
  resolveLogoPhase,
  type LogoActionV1,
  type LogoManifestV1,
  type LogoPhase,
  type LogoSetV1,
} from "@bg/shared";
import { resolveWithin } from "../security/path-boundary";
import { MAX_GUIDELINE_PAGES, REQUIRED_GUIDELINE_PAGES } from "../services/logo-deliverables";

/**
 * Guideline pages the finalize turn must author, in order. Modelled on the hcma and Asana brand
 * guidelines: numbered sections, one rule per page, every rule shown on the mark itself.
 */
export const LOGO_REQUIRED_PAGES = [
  "cover",
  "index",
  "brand-foundation",
  "logo-anatomy",
  "construction-grid",
  "logo-variations",
  "size-and-ratio",
  "clear-space",
  "colour",
  "logo-no-goes",
  "typography",
  "applications",
] as const;

/** Size to ask the image tool for; the gate accepts any 256-4096 px square, and the tool's bytes are kept as returned. */
export const LOGO_CANDIDATE_IMAGE_PX = 1024;

type LogoPromptState = {
  readonly logoSet: LogoSetV1;
  readonly manifest: LogoManifestV1 | null;
  readonly action: LogoActionV1 | null;
};

/**
 * Reads the exploration manifest for prompt assembly. An absent project directory and absent or
 * malformed manifests resolve to null so the turn starts a fresh explore round; the deliverables
 * gate after the turn, not the prompt, is the authority that rejects a corrupt manifest. A present
 * directory still goes through the path boundary, so an escaping path keeps its PathBoundaryError.
 */
export async function readLogoManifestForPrompt(projectDir: string): Promise<LogoManifestV1 | null> {
  let text: string;
  try {
    await lstat(projectDir);
    text = await readFile(resolveWithin(projectDir, ...LOGO_FILES.manifest.split("/")), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  try {
    return parseLogoManifestV1(JSON.parse(text.replace(/^\uFEFF/, "")));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof UpgradeContractError) return null;
    throw error;
  }
}

/** Emits the logo delivery contract and the phase rules for a logo project. */
export function appendLogoOutputContext(lines: string[], state: LogoPromptState, requestText: string): void {
  const action = state.action ?? parseLogoAction(requestText);
  const phase = resolveLogoPhase(state.manifest, action);
  const round = phase === "finalize" && action?.action === "select" ? action.round : (state.manifest?.rounds.length ?? 0) + 1;
  const selected = phase === "finalize" && action?.action === "select" ? selectedCandidate(state.manifest, action) : undefined;
  const { schema_version: _version, ...brief } = state.logoSet;
  lines.push("<burnguard-logo-output-v1>");
  lines.push(JSON.stringify({
    schema_version: 1,
    phase,
    round,
    candidate_count: LOGO_CANDIDATE_COUNT,
    candidate_image_target_px: LOGO_CANDIDATE_IMAGE_PX,
    page: { width: LOGO_PAGE.width, height: LOGO_PAGE.height },
    ...brief,
    files: { ...LOGO_FILES },
    source_attribute: LOGO_SOURCE_ATTRIBUTE,
    action_tag: LOGO_ACTION_TAG,
    ...(selected === undefined ? {} : { selected, required_pages: LOGO_REQUIRED_PAGES, page_count: { min: REQUIRED_GUIDELINE_PAGES, max: MAX_GUIDELINE_PAGES } }),
  }));
  lines.push("</burnguard-logo-output-v1>");
  lines.push(`<burnguard-logo-rules-v1 phase="${phase}">`);
  for (const rule of phase === "explore" ? exploreRules(state.logoSet, round) : finalizeRules(state.logoSet)) lines.push(`- ${rule}`);
  lines.push("</burnguard-logo-rules-v1>");
  lines.push("");
}

function selectedCandidate(manifest: LogoManifestV1 | null, action: Extract<LogoActionV1, { action: "select" }>) {
  const candidate = manifest?.rounds.find((round) => round.round === action.round)?.candidates.find((entry) => entry.id === action.candidate_id);
  if (candidate === undefined) throw new TypeError("finalize phase without a manifest candidate");
  return { round: action.round, candidate_id: candidate.id, file: candidate.file, logo_type: candidate.logo_type };
}

function exploreRules(logoSet: LogoSetV1, round: number): readonly string[] {
  const folder = `${LOGO_FILES.explorations}/round-${round}`;
  const spread = logoSet.logo_type === "auto"
    ? "Span at least three different logo types across the four candidates (choose from wordmark, lettermark, pictorial, abstract, mascot, combination, emblem by fit to the niche and character); never four variations of one idea."
    : `Every candidate is a ${logoSet.logo_type} logo; make the four differ in symbol, construction and letterform, not in colour alone.`;
  return [
    `LOGO_IMAGE_GENERATION_REQUIRED: every logo candidate is a raster image produced by the built-in image-generation tool in this turn. Never draw, code or assemble a candidate by hand in SVG, CSS, HTML canvas or any other means, and never reuse a supplied or earlier image as a new candidate. LOGO_CANDIDATE_BYTES_VERBATIM: copy each candidate byte-for-byte from the file the image tool saved (a plain cp), then leave it alone. Never resize, crop, recompress, convert, re-save or otherwise re-encode a candidate (no sips, ImageMagick, PIL or similar): the gate binds every candidate's bytes to the images the tool produced during its calls in this turn, so a PNG whose bytes differ from the tool's output is refused as candidate_unprovenanced. Any square the tool returns between 256 and 4096 px is accepted as-is. A turn that does not leave exactly ${LOGO_CANDIDATE_COUNT} newly generated PNG files in ${folder}/ fails with logo_deliverables_missing and no work is published.`,
    `Generate exactly ${LOGO_CANDIDATE_COUNT} candidates, saved as ${folder}/candidate-1.png through candidate-${LOGO_CANDIDATE_COUNT}.png, square (ask the image tool for about ${LOGO_CANDIDATE_IMAGE_PX} px and keep exactly what it returns), one mark per image, centred on a flat plain ground (white, or the brand's dark ground) with generous clear space. No mockups, no scene, no shadows, no gradients, no texture, no extra text beyond the brand name where the type calls for it.`,
    spread,
    "Design each candidate from the brief: brand name, niche, the character adjectives and the symbol keywords with their meanings (shape psychology: circle = unity, square = stability, upward triangle = growth; symbols such as shield = protection, mountain = achievement, leaf = growth). Prefer one strong idea with hidden meaning or negative space over decoration. Avoid the generic clichés of the niche and anything the brief says to avoid.",
    "Black-and-white first: at least two candidates are a single colour on a plain ground; the others may use at most one hero colour plus black. Every candidate must survive a grayscale and a 16 px small-size test; write the image prompt so the mark stays simple and geometric enough to be vectorised later.",
    "LOGO_REALISM_EXCEPTION: the photorealism contract and the abstract-imagery prohibition do not apply to logo candidates. A logo is a flat, vector-like mark; describe it as such in the image prompt (flat vector logo, solid fills, geometric construction, plain ground, no photograph, no 3D, no mockup).",
    `Write ${LOGO_FILES.manifest} exactly to the LogoManifestV1 schema: {"schema_version":1,"rounds":[...],"selected":null}; keep every earlier round untouched and append {"round":${round},"candidates":[4 entries]}. Each entry: id "candidate-<i>", file "${folder}/candidate-<i>.png", logo_type (one concrete type, never auto), prompt (the exact image prompt sent), rationale (<= 500 characters: the idea, the symbol meaning, the construction basis such as golden-ratio circles or a modular grid, and why it fits the character).`,
    `Author ${LOGO_FILES.guidelines} as ONE ${LOGO_PAGE.width} x ${LOGO_PAGE.height} CSS px [data-graphic-artboard] candidate sheet with id frame-1-candidates: a 2 x 2 grid of the four candidate images (referenced by their relative paths) with their number, logo type and rationale, and a short header naming the brand and round. Replace the starter brief entirely. Keep --page-background. This sheet is what the user compares; the app adds the choose and regenerate controls.`,
    `Do not vectorise, do not write ${LOGO_FILES.logo}, and do not author guideline pages in this phase; the user picks a candidate first. Inspect all four PNGs at display size and regenerate any with garbled lettering, extra artefacts or a busy ground before finishing. End with one line per candidate: number, type, idea.`,
  ];
}

function finalizeRules(logoSet: LogoSetV1): readonly string[] {
  return [
    `LOGO_IMAGE_GENERATION_REQUIRED: the master vector reproduces the generated candidate the user selected. Do not redesign, replace, restyle or "improve" the concept; vectorise that image. ${LOGO_FILES.logo} without a faithful generated source fails with logo_deliverables_missing.`,
    `Vectorise the selected candidate into ${LOGO_FILES.logo}: read the PNG, reconstruct its silhouette on a geometric basis (circles and tangents, a modular grid or golden-ratio proportions), apply optical corrections by eye, and keep the result recognisably the same mark. The standalone root <svg> must carry xmlns="http://www.w3.org/2000/svg", viewBox, width and height, and ${LOGO_SOURCE_ATTRIBUTE}="<selected candidate file>". The file is validated by an allowlist parser: only svg, g, defs, symbol, use, path, circle, ellipse, rect, line, polyline, polygon, title, desc, clipPath and mask elements, no namespace prefixes, no DOCTYPE, CDATA, processing instructions or entities other than &amp; &lt; &gt; &quot; &apos;, no <text> (draw letterforms as paths, outlined from a bundled font or the candidate), no <image>, <script>, <style>, <foreignObject>, gradients, filters, patterns or animation, no style attribute, no on* attributes, no external href/xlink:href or data: URLs; href points at a local #id, url(#id) appears only in clip-path or mask and must resolve inside the file; fills and strokes are none, currentColor, #rrggbb or rgb(); at most 1 MiB. Solid fills only; no raster effects.`,
    `Optional variants, same rules, same source attribute: logo-mark.svg (symbol only), logo-wordmark.svg, logo-mono.svg (one colour), logo-reversed.svg (for dark grounds). Update ${LOGO_FILES.manifest}: set "selected" to the chosen {"round","candidate_id"}; leave rounds unchanged.`,
    `Author ${LOGO_FILES.guidelines} as a brand-guidelines document of ${LOGO_PAGE.width} x ${LOGO_PAGE.height} CSS px [data-graphic-artboard] pages, one per required page in required_pages order, id page-<nn>-<slug>, every page carrying data-bg-node-id values on its heading, body and figure. Follow the reference structure: numbered section eyebrow and title in a left column, one rule per page, the rule demonstrated on the mark itself (inline the SVG so it can be recoloured), running footer with brand name, "Brand guidelines", version and page number. Author exactly one page per required_pages entry (${LOGO_REQUIRED_PAGES.length} pages). The gate refuses fewer than ${REQUIRED_GUIDELINE_PAGES} or more than ${MAX_GUIDELINE_PAGES} artboards (page_count, PDF raster budget), but anything under ${LOGO_REQUIRED_PAGES.length} omits a required section; add nothing beyond required_pages.`,
    "Page contents: cover (mark + brand name + version + date); index (numbered sections); brand foundation (niche, character, what the mark means, symbol meanings used); logo anatomy (parts named on the mark); construction grid (the geometric basis drawn over the mark: circles, axes, ratios); logo variations (primary, symbol, wordmark, mono, reversed); size and ratio (the aspect ratio stated as w:h with a scaling ladder, and the minimum size in px for screen and mm for print shown at that size); clear space (a stated fraction of the mark height, e.g. x = cap height, shown with guides); colour (approved mark-on-ground pairings at equal size beside a palette table with name, HEX, RGB, CMYK approximate, role); logo no-goes (a 3 x 4 grid of forbidden treatments rendered with CSS transforms and filters on the inline SVG: stretch, rotate, skew, outline, recolour, gradient, drop shadow, busy photo ground, low contrast, crop, altered spacing, added effects, each crossed with a red diagonal and captioned Don't ...); typography (display, body and mono roles with the actual bundled or design-system fonts, hierarchy sizes); applications (business card, signage, app icon, social avatar: generate the physical scene with the image tool WITHOUT the logo baked in, then overlay the SVG in HTML so the mark stays exact; close the page with the file kit: the delivered files and when to use SVG, PDF, PNG).",
    `Palette and type: when a design system is selected, take colour and type from its tokens and put the mark's hero colour in the palette; otherwise derive a hero colour, one or two supporting colours and neutrals from the candidate and the character (${logoSet.character.join(", ")}). Write ${LOGO_FILES.design_system_patch} as {"schema_version":1,"colors":[{"name":"brand-primary","value":"#RRGGBB"},...],"readme_section":"## Logo\\n...","logo_asset":"${LOGO_FILES.logo}"} (<= 12 colours, kebab-case names, the README section describing the mark, clear space, minimum size and approved pairings) so the app can fold the guidelines into the existing design system.`,
    "Before finishing, inspect the rendered pages at 1920 x 1080: no text below 24 px, nothing outside the page, every inline SVG loads, every generated application image loads and its overlay is positioned. Report which checks you performed. End with one line naming the selected candidate, the files written and the page count.",
  ];
}

export type { LogoPhase };
