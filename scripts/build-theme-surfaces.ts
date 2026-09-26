#!/usr/bin/env bun
/**
 * Regenerate the per-surface sub-systems of every design system that ships with the app.
 *
 * A design system is shared brand identity plus one contract per output geometry: a fluid website, a
 * fixed 1920x1080 slide, and a fixed content artboard. `colors_and_type.css` keeps the shared part and
 * the website grid; this generator writes `surfaces/{website,slides,content}.css` and the README
 * sections that carry the prose those tokens cannot. See doc/22-design-system-surfaces-2026-09-15.md (local-only record, see doc/README.md).
 *
 * Like `build-theme-catalogue.ts` this is a deliberate generator for committed artifacts, not a step in
 * `bun run build`: it rewrites tracked source. Run it after changing the registry, a theme's layout
 * tokens, or a spec below: `bun run surfaces`.
 *
 * Numbers are derived from each system's own landed layout decisions rather than invented per theme, so
 * a theme's slides and artboards agree with its website. Prose comes from the spec table, which records
 * the five facts a generic template cannot know: ground, signal, cover, structure, figure, never.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deckReferenceFor, deckReferenceSection } from "../packages/backend/src/data/deck-references";
import {
  CONTENT_TYPE_FLOOR_PX,
  DESIGN_SURFACE_FILES,
  DESIGN_SURFACES,
  missingDesignSystemSurface,
  parseDesignSystemSurface,
  REQUIRED_SURFACE_TOKENS,
  type DesignSurface,
} from "../packages/shared/src/design-surface";

const repoRoot = path.resolve(import.meta.dir, "..");
const themesRoot = path.join(repoRoot, "design system themes");
const registryPath = path.join(repoRoot, "packages/backend/src/data/bundled-design-systems.ts");

/** The five facts about a system that its tokens cannot express. Keep each under ~22 words. */
type SurfaceSpec = {
  /** What the slide or artboard is made of before anything is placed on it. */
  readonly ground: string;
  /** What the accent, chrome or emphasis device is allowed to do. */
  readonly signal: string;
  /** What the cover slide and the first artboard of a set look like. */
  readonly cover: string;
  /** How a body slide and an artboard are structured. */
  readonly structure: string;
  /** What imagery on a fixed frame is of. */
  readonly figure: string;
  /** What breaks this system. */
  readonly never: string;
};

const SPECS: Readonly<Record<string, SurfaceSpec>> = {
  light: {
    ground: "the crisp neutral canvas, kept open",
    signal: "violet, pink or teal touches one element per frame",
    cover: "a centred title over one uninterrupted wide scene with generous whitespace around it",
    structure: "aligned evidence rows and a flat hierarchy; let the canvas stay open rather than filling it",
    figure: "one clean product or scene image, never a grey placeholder box",
    never: "dense card rows, two accent hues in one frame, clutter crossing the safe area",
  },
  dark: {
    ground: "the dark workspace ground",
    signal: "steel blue marks the live metric or control and nothing else",
    cover: "a centred statement with the wide background field behind it",
    structure: "compact metric rows and contextual controls on the slide grid, one operational takeaway per frame",
    figure: "an interface panel or scenic field dark enough for type to cross it",
    never: "bright daylight imagery, filled panels competing with the metric, a second accent hue",
  },
  cupcake: {
    ground: "soft pastel panels on warm paper",
    signal: "pink or teal carries one friendly action",
    cover: "a welcoming title above a rounded media panel",
    structure: "benefit groups in soft panels and calm story sections; nothing is boxed twice",
    figure: "a bright product or everyday scene, with soft corners applied in CSS rather than baked in",
    never: "hard shadows, dense tables, sharp corporate grids",
  },
  retro: {
    ground: "printed editorial bands on aged paper",
    signal: "the print palette colours a band or a heading, not small parts",
    cover: "a specimen poster: an oversized wordmark with the object in front of it",
    structure: "broad bands with small supporting figures; avoid uniform card rows",
    figure: "an object photographed as a print specimen, matte and unglossed",
    never: "uniform card rows, digital gradients, thin modern grids",
  },
  cyberpunk: {
    ground: "hard grid edges on the dark field",
    signal: "the neon accent marks status, never decoration",
    cover: "a full-bleed field with the headline held in the top third",
    structure: "compact status strips and supporting telemetry; the scan order stays obvious despite the density",
    figure: "a dense technical or product scene with one calm region for the headline",
    never: "soft rounded panels, pastel tints, glow that maps to no state",
  },
  synthwave: {
    ground: "the panoramic dark field",
    signal: "the sunset accent carries one element per frame",
    cover: "a centred heading above one large product panel",
    structure: "wide chapters with compact captions; scale and open gaps supply the drama",
    figure: "a panoramic scene or product panel, horizon-led",
    never: "many small cards, competing accent hues, cramped gutters",
  },
  luxury: {
    ground: "the deep ground with generous open space",
    signal: "gold touches one word or one rule",
    cover: "a framed portrait cover with a narrow centred text axis",
    structure: "restrained captions around a large portrait; one idea per frame",
    figure: "a large product portrait against a calm background",
    never: "repeated boxed cards, busy collages, bright competing colour",
  },
  dracula: {
    ground: "the dark documentation ground",
    signal: "purple or pink marks an active term",
    cover: "a display masthead with the subject silhouette below it",
    structure: "continuous prose blocks and inset code examples; do not box every line",
    figure: "a cropped masthead image, or a code surface rendered as a real element",
    never: "boxing every paragraph, four-column sitemaps, bright fills",
  },
  nord: {
    ground: "the quiet cool ground",
    signal: "the frost accent marks one figure or link",
    cover: "a restrained introduction above a crisp product panel",
    structure: "figures on the slide grid with whitespace between chapters, never dense card surfaces",
    figure: "a crisp interface or product panel, evenly lit",
    never: "card walls, saturated accents, tight gutters",
  },
  business: {
    ground: "the sober charcoal ground",
    signal: "muted blue marks the decision value",
    cover: "the main statement across the top with evidence left and the action stack right",
    structure: "metrics, filters and one table in decision order, with numeric columns aligned",
    figure: "a wide evidence panel or chart; stay text-first so PPTX export survives",
    never: "decorative photography, misaligned numeric columns, effects that only survive raster capture",
  },
  "cobalt-atelier": {
    ground: "cobalt as the ground, not an accent",
    signal: "mono labels and near-square unraised controls carry the chrome",
    cover: "a short stacked display left, one isolated figure right",
    structure: "a light serif voice with mono labels, and visible cobalt around every inset figure",
    figure: "a single subject isolated against a plain ground, one idea per frame",
    never: "warm golden grading, busy backgrounds, hazy low-contrast treatments",
  },
  "signal-reel": {
    ground: "near-black with signal red reserved for the live state",
    signal: "red marks one live element or the primary action",
    cover: "a centred masthead with a cinematic strip beneath it",
    structure: "large display type supplies the scale; zero radius, no elevation, every label still readable",
    figure: "motion held still, with a dark region for the display type to cross",
    never: "bright high-key frames, several saturated colours, posed static subjects",
  },
  "daylight-press": {
    ground: "warm off-white paper",
    signal: "buttercup marks the action or the active state",
    cover: "a framed cover panel under a soft lowercase display title",
    structure: "warm hairline dividers and printed, approachable body copy",
    figure: "everyday life at close range, warm and deliberately unremarkable",
    never: "cool blue-grey grading, hard shadows, staged corporate scenes",
  },
  "blueprint-manual": {
    ground: "the paper ground with blueprint annotation",
    signal: "line work explains content; the blueprint line marks a numbered figure",
    cover: "an edge-wide title above one dominant technical specimen",
    structure: "numbered figures, mono headings and a serif reading body; near-square corners, no elevation",
    figure: "a described object shown as a figure the text refers to, with labels typeset rather than drawn in",
    never: "atmospheric photography, coloured backgrounds, annotation baked into the image",
  },
  "ledger-index": {
    ground: "the ruled index sheet",
    signal: "emphasis comes from cell size and rule weight, not colour",
    cover: "a concise title above one product panel, shared edges throughout",
    structure: "shared-edge cells and mono labels, with no radius and no shadow",
    figure: "an indexed item shown plainly, monochrome and consistently toned",
    never: "colour images, inconsistent tone between cells, one cell dominating the sheet",
  },
  "dune-editorial": {
    ground: "sand neutrals at a wide editorial rhythm",
    signal: "terracotta carries one action or rule",
    cover: "a tall image on one side with a narrow serif column on the other",
    structure: "a grotesque name with a serif speaking voice, hairline rules and wide margins",
    figure: "landscape and natural surface at scale, horizon-led and free of people",
    never: "cool or blue-dominant landscapes, dominant figures, harsh midday light",
  },
  "archive-folio": {
    ground: "dense serif entries on the archive sheet",
    signal: "position and weight carry hierarchy; colour does not",
    cover: "a compact title block with the record itself beneath it",
    structure: "dates and notes beside their records, hairline dividers, tight rhythm",
    figure: "an archival item reproduced as a record, keeping its identifying caption",
    never: "styled angled photography, cleaning away age and creases, added borders or shadows",
  },
  "signal-console": {
    ground: "the near-black instrument ground",
    signal: "phosphor marks only a live or interactive state",
    cover: "a real product surface panel in the upper band with the title beneath it",
    structure: "mono labels and numbered annotation, hairline regions, radii at or below 3px",
    figure: "hardware or an interface shot as an object, never a desk or an office",
    never: "stock-photo people, cyber gradients or circuit overlays, warm ambient light",
  },
  "paper-instrument": {
    ground: "bright paper with generous emptiness",
    signal: "ink blue marks the action",
    cover: "a framed cover with the instrument beside a stacked title",
    structure: "scale, position and full-width hairline rules; no filled panels, no elevation",
    figure: "one manufactured object on a plain seamless surface that merges into the paper",
    never: "dark or coloured backdrops, hard directional shadows, cluttered props",
  },
  "quiet-runtime": {
    ground: "the warm grey ground with soft edged surfaces",
    signal: "one violet marks the action; semantic colour stays inside its chips",
    cover: "a centred statement over a soft square field",
    structure: "a humanist voice at low arousal, brief motion, nothing shouting for attention",
    figure: "interface fragments and soft abstract forms, implied rather than photographed",
    never: "neon or high-contrast renders, sharp specular edges, literal screenshots of other products",
  },
  "graphite-spec": {
    ground: "graphite and bone at zero radius",
    signal: "amber marks the value under discussion",
    cover: "a measured specimen with the title set against the field edge",
    structure: "a measured mono body, numbered figures, margin annotation and first-class tables",
    figure: "technical drawing and measured artifacts; line work rather than photography",
    never: "perspective renders, colour beyond the amber callout, soft shadows",
  },
  "long-form-press": {
    ground: "the continuous serif reading ground",
    signal: "rust marks links and pull quotes",
    cover: "a tall plate on one side with the title in the reading column",
    structure: "generous leading and indented paragraphs with sans captions and mono dates; no cards",
    figure: "reportage that carries information, shown in its real context",
    never: "studio cut-outs, heavy colour grading, stock staging",
  },
  "wide-gutter-review": {
    ground: "a narrow sans spine beside an empty wide gutter",
    signal: "blue marks one live item",
    cover: "a high-contrast serif title with the plate to its side",
    structure: "mono captions on flat square surfaces; the wide gutter stays empty",
    figure: "one considered subject per plate, presented whole rather than snapped",
    never: "busy multi-subject scenes, pale low-contrast plates, filling the gutter",
  },
  "quarterly-folio": {
    ground: "warm bound paper with wide margins",
    signal: "deep green stays sparse",
    cover: "a didone opening above one contained plate",
    structure: "letterspaced eyebrows, a warm serif body with indents, hairline rules",
    figure: "still life and considered arrangement; quiet subjects that reward a long look",
    never: "cool blue-cast images, high-energy motion, margins filled to the edge",
  },
  "night-edition": {
    ground: "the ink ground, at the same hour as its imagery",
    signal: "the warm signal marks the active item or reading progress",
    cover: "a type marquee over a wide night field",
    structure: "a readable serif body at loose leading; images supply the only bright areas",
    figure: "night and low-light subjects that belong to the same hour as the page",
    never: "bright daytime scenes, lifted hazy blacks, cool blue night grading",
  },
  "studio-counter": {
    ground: "photography dominant with compact chrome",
    signal: "bone-on-black or black-on-bone actions replace coloured emphasis",
    cover: "a framed cover where the product photograph is the whole subject",
    structure: "paired product rows at tight gaps, with large scale differences doing the emphasis",
    figure: "a single garment or object on a form, studio-shot, with no environment",
    never: "bright seamless backgrounds, lifestyle props, readable brand marks",
  },
  "atelier-counter": {
    ground: "warm bone paper with contained product plates",
    signal: "oxblood marks price or action",
    cover: "a didone marquee with the object plate beneath it",
    structure: "hairline rows and a humanist reading face; nothing elevated",
    figure: "a single object presented whole, with the complete silhouette visible",
    never: "cropping the object at the frame edge, cool white seamless, models posing in a scene",
  },
  "market-stack": {
    ground: "the bright ground with soft large shapes",
    signal: "orange carries the action, blue the link, yellow only a badge fill",
    cover: "a square product plate with the price set as the headline",
    structure: "square plates and prices as headlines, with crops consistent across the set",
    figure: "one product straight on filling its square frame: cheerful everyday goods",
    never: "dark moody treatments, inconsistent crops within a set, multi-product scenes",
  },
  "vitrine-mono": {
    ground: "goods as exhibits in shared-edge ruled cells",
    signal: "position and rule weight carry emphasis; radius stays at zero",
    cover: "a masthead crop with the object fully contained beneath it",
    structure: "mono specifications under each object, shared edges, nothing raised",
    figure: "one object documented straight on or in strict profile, as a record shot",
    never: "angled hero shots, coloured backdrops, props or styling context",
  },
  "night-marquee": {
    ground: "one cinematic still with achromatic chrome",
    signal: "small letterspaced credits are the only chrome allowed",
    cover: "a title stack placed in the empty region of the held frame",
    structure: "dark space and scale carry the atmosphere; no raised surfaces anywhere",
    figure: "a single human moment held still, lifted out of a longer sequence",
    never: "bright high-key frames, frames with no empty region for the title, posed studio smiles",
  },
  "stencil-field": {
    ground: "the spacious pale field with saturated media",
    signal: "green marks links or live states only",
    cover: "a wide display face over one loud colour band",
    structure: "thin rules and a single deliberate image-to-type seam",
    figure: "an abstract material close-up; the image is a colour event, not an object",
    never: "recognisable objects or people, muted pastel treatments, competing hues in one frame",
  },
  "press-riso": {
    ground: "cream stock with flat riso inks",
    signal: "vermilion, ultramarine and sun-yellow hold fixed roles",
    cover: "condensed large type with one three-degree rotation",
    structure: "2px rules and square corners, at most three inks on a frame",
    figure: "a graphic print rather than a photograph, with a small deliberate ink misregistration",
    never: "smooth photographic gradients, perfect registration, glossy or 3D finishes",
  },
  "exhibit-wall": {
    ground: "warm plaster visible around complete works",
    signal: "clay marks the action",
    cover: "one complete work with serif wall text beside it",
    structure: "mono labels giving title, year, medium and dimensions; zero radius and no elevation",
    figure: "a single artwork photographed as documentation, always complete",
    never: "cropping into the work, cool grey gallery walls, visitors or plinth clutter",
  },
  "index-table": {
    ground: "the machine-produced data sheet",
    signal: "blue is reserved for links, focus and the active filter",
    cover: "a compact title beside one framed specimen",
    structure: "fixed-width columns, compact hairline rows and tabular mono numbers",
    figure: "a small square thumbnail that identifies a row; it is never decoration",
    never: "decorative photography replacing the data surface, varied backgrounds between rows, coloured tag fills",
  },
  "facet-archive": {
    ground: "the light specimen grid inside dark chrome",
    signal: "steel marks active state and focus",
    cover: "a named specimen above the title, with the 1px ruling kept",
    structure: "typed facets with counts, mono identifiers, and one camera distance across specimens",
    figure: "one specimen per frame, identifiable and classifiable",
    never: "dark backgrounds inside cells, posed multi-specimen compositions, inconsistent crops",
  },
  "console-ledger": {
    ground: "tight hairline rows of right-aligned tabular numbers",
    signal: "health colours mark values, never whole rows",
    cover: "a compact labelled figure beside the title",
    structure: "mechanical corners, no elevation, at most four series in a figure",
    figure: "a plotted figure that carries data, or no image at all",
    never: "photographs of any kind, gradients or glows, colour that maps to no state",
  },
  "field-register": {
    ground: "the warm paper ground with white fields",
    signal: "teal is for focus or action",
    cover: "a label-and-value block beside one square evidence frame",
    structure: "label/value rows with explicit required and validation text, keeping the stationery character",
    figure: "documentary evidence inside a containing hairline frame",
    never: "stylised or graded photography, evidence without its frame, saturated colour fills",
  },
  "warm-vestibule": {
    ground: "putty, timber, clay and olive taken from the interior",
    signal: "the place leads; no cart, price or promotional device appears",
    cover: "a full-bleed interior with the title over its calmest region",
    structure: "plain practical lists on unraised square surfaces",
    figure: "an interior or architectural space with no people in it",
    never: "people in frame, cool fluorescent casts, tilted verticals or wide-angle distortion",
  },
  "stone-court": {
    ground: "cool limestone with ground visible around every plate",
    signal: "slate marks the action",
    cover: "one whole architectural plate with a didone statement beside it",
    structure: "mono captions identifying place, year and material; nothing bleeds off the frame",
    figure: "an architectural exterior or masonry detail: structure and material, not interiors",
    never: "cropping into the structure, warm golden-hour grading, dominant people or signage",
  },
  "linen-retreat": {
    ground: "linen with one partial image bleed",
    signal: "a single tan booking action",
    cover: "a wide detail bleeding past one edge with a serif statement over the linen",
    structure: "heavily spaced eyebrows above plain rates and arrival lists, small restrained radii",
    figure: "a detail of a stay at intimate scale rather than a whole room",
    never: "wide empty room shots, people posing, cool clinical colour",
  },
  "timber-hall": {
    ground: "dark timber and warm lamplight with dark edges",
    signal: "amber marks the action; radii stay at or below 2px",
    cover: "a low-light room with the serif statement set into its dark edge",
    structure: "quiet practical information, nothing elevated",
    figure: "an interior after dark, empty of people and lit from within",
    never: "bright evenly lit interiors, daylight or cool bulbs, edges that stay bright",
  },
  sonnel: {
    ground: "the cobalt synthesis-lab ground",
    signal: "cobalt marks one control or value",
    cover: "tactile product photography beside a concise message column",
    structure: "material details, one broad product feature, then aligned specifications; keep the gutters open",
    figure: "tactile product photography where the material leads",
    never: "closing the open gutters, decorative filler, a second accent hue",
  },
  foliover: {
    ground: "the journal paper ground",
    signal: "the editorial accent marks one link or lede",
    cover: "a journal masthead above a broad material study",
    structure: "continuous reading columns with inset details alternating against wide photographs and small captions",
    figure: "a material study photographed for texture",
    never: "converting articles into cards, closing the editorial gutters, busy collages",
  },
  oddward: {
    ground: "the expressive lime field with magenta panels",
    signal: "one magenta panel marks the emphasis",
    cover: "giant typography beside an offset visual field",
    structure: "staggered paired tiles at roughly a 1:1.4 message-to-media ratio",
    figure: "an original sculptural form, cropped so the material leads",
    never: "treating a generated form as production evidence, timid type, symmetrical tiling",
  },
  velune: {
    ground: "deep plum lit by opal mint",
    signal: "opal mint marks one lit element",
    cover: "a compact sculptural story beside a large portrait image",
    structure: "immersive image chapters with small material captions and calm negative space around each object",
    figure: "sculptural lighting objects cropped so the material leads",
    never: "crowding the object, warm grading, treating a generated form as production evidence",
  },
  halide: {
    ground: "the optical stage centred on a square field",
    signal: "the refracting ring is the only bright event",
    cover: "a circular optical stage with the title aligned to its edges",
    structure: "focused optical details and concise specifications; preserve the stage geometry",
    figure: "an optical ring or refraction study, not a blurred glass panel",
    never: "flat blur passed off as refraction, off-centre stages, busy backgrounds",
  },
  "northvale-capital": {
    ground: "the editorial finance ground",
    signal: "the brand blue marks one figure or action",
    cover: "an editorial masthead with a broad lead statement",
    structure: "research figures, tables and copy aligned on one grid, separated by rules and whitespace",
    figure: "a restrained institutional figure or chart rather than stock photography",
    never: "tech-product styling, decorative photography, an unlabelled figure",
  },
};

type LayoutSignals = {
  readonly columns: number;
  readonly gutter: number;
  readonly measure: number;
  readonly rule: number;
  readonly copyRatio: number;
  readonly titleMeasure: number;
  readonly heroOffset: number;
  readonly mediaPosition: string;
};

const clamp = (min: number, value: number, max: number): number => Math.min(max, Math.max(min, value));
const snap = (value: number, step: number): number => Math.round(value / step) * step;

function readNumber(tokens: Map<string, string>, name: string, fallback: number): number {
  const raw = tokens.get(name);
  if (raw === undefined) return fallback;
  const match = /-?\d+(?:\.\d+)?/.exec(raw);
  return match === null ? fallback : Number(match[0]);
}

function layoutSignals(css: string): LayoutSignals {
  const tokens = new Map(
    [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--layout-[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)]
      .map((match) => [match[1]!.toLowerCase(), match[2]!.trim()] as const),
  );
  return {
    columns: readNumber(tokens, "--layout-columns", 12),
    gutter: readNumber(tokens, "--layout-gutter", 24),
    measure: readNumber(tokens, "--layout-measure", 60),
    rule: readNumber(tokens, "--layout-rule", 1),
    copyRatio: readNumber(tokens, "--layout-hero-copy-ratio", 60),
    titleMeasure: readNumber(tokens, "--layout-hero-title-measure", 18),
    heroOffset: readNumber(tokens, "--layout-hero-offset", 0),
    mediaPosition: (tokens.get("--layout-hero-media-position") ?? "below").toLowerCase(),
  };
}

const ANCHORS: Readonly<Record<string, string>> = {
  below: "bottom",
  left: "left",
  right: "right",
  background: "center",
};

/**
 * A type-led system (short hero measure, most of the opening given to copy) gets a larger display step
 * on a fixed frame; a dense, data-led system gets a smaller one and more room for the grid. Body and
 * caption move at half that rate so readability never follows the display size.
 */
function typeScale(signals: LayoutSignals): number {
  return clamp(0.85, 1 + (signals.copyRatio - 60) / 400 + (18 - signals.titleMeasure) / 120, 1.35);
}

function surfaceTokens(signals: LayoutSignals): Readonly<Record<DesignSurface, Readonly<Record<string, string>>>> {
  const scale = typeScale(signals);
  const bodyScale = 1 + (scale - 1) / 2;

  const padEdge = clamp(64, snap(72 + signals.heroOffset / 4, 4), 128);
  const slideBody = clamp(28, snap(32 * bodyScale, 2), 44);
  const slideRule = clamp(1, signals.rule, 4);
  const contentBody = clamp(28, snap(32 * bodyScale, 2), 44);
  const contentSafe = clamp(6, Math.round((padEdge / 1080) * 100), 10);
  const webHero = clamp(56, snap(88 * scale, 4), 120);
  const webHeading = clamp(36, snap(56 * scale, 4), 80);
  const webBody = signals.measure >= 66 ? 18 : signals.measure >= 58 ? 17 : 16;

  return {
    website: {
      "--web-type-hero": `clamp(${clamp(32, snap(webHero * 0.5, 2), 64)}px, ${Math.round((webHero / 1440) * 1000) / 10}vw, ${webHero}px)`,
      "--web-type-heading": `clamp(${clamp(24, snap(webHeading * 0.57, 2), 44)}px, ${Math.round((webHeading / 1440) * 1000) / 10}vw, ${webHeading}px)`,
      "--web-type-body": `${webBody}px`,
      "--web-type-caption": `${webBody >= 18 ? 14 : 13}px`,
      "--web-pad-block": `${clamp(16, snap(signals.gutter * 1.2, 4), 48)}px`,
    },
    slides: {
      "--slide-w": "1920px",
      "--slide-h": "1080px",
      "--slide-aspect": "16 / 9",
      "--slide-pad-edge": `${padEdge}px`,
      "--slide-pad-block": `${clamp(24, snap(padEdge / 2.25, 4), 56)}px`,
      "--slide-columns": `${clamp(6, signals.columns, 12)}`,
      "--slide-gutter": `${clamp(16, snap(signals.gutter * 1.6, 4), 64)}px`,
      "--slide-rule": `${slideRule}px`,
      "--slide-type-hero": `${clamp(64, snap(80 * scale, 4), 128)}px`,
      "--slide-type-heading": `${clamp(44, snap(52 * scale, 4), 84)}px`,
      "--slide-type-body": `${slideBody}px`,
      "--slide-type-caption": `${clamp(24, snap(slideBody * 0.75, 2), 32)}px`,
    },
    content: {
      "--content-base": "1080px",
      "--content-safe": `${(contentSafe / 100).toFixed(2)}`,
      "--content-columns": `${clamp(4, Math.round(clamp(6, signals.columns, 12) / 2), 8)}`,
      "--content-pad-block": `${clamp(24, snap(40 * bodyScale, 4), 72)}px`,
      "--content-rule": `${clamp(1, slideRule * 2, 4)}px`,
      "--content-figure": `${(clamp(0.35, Math.round((0.86 - signals.copyRatio / 200) * 100) / 100, 0.72)).toFixed(2)}`,
      "--content-bleed": signals.mediaPosition === "background" ? "1" : "0",
      "--content-anchor": ANCHORS[signals.mediaPosition] ?? "center",
      "--content-type-hero": `${clamp(88, snap(120 * scale, 4), 168)}px`,
      "--content-type-sub": `${clamp(40, snap(56 * scale, 4), 88)}px`,
      "--content-type-body": `${contentBody}px`,
      "--content-type-caption": `${clamp(24, snap(contentBody * 0.75, 2), 32)}px`,
    },
  };
}

const SURFACE_PURPOSE: Readonly<Record<DesignSurface, string>> = {
  website: "web type ramp and block padding; the grid, regions and family tokens stay in colors_and_type.css",
  slides: "fixed 1920x1080 slide geometry and projection type ramp",
  content: "fixed content artboards: card news, banners, product detail pages, thumbnails, posters",
};

function surfaceCss(name: string, surface: DesignSurface, tokens: Readonly<Record<string, string>>): string {
  const body = Object.entries(tokens).map(([token, value]) => `  ${token}: ${value};`).join("\n");
  return [
    `/* ${name} - ${surface} surface: ${SURFACE_PURPOSE[surface]}. */`,
    "/* Shared brand identity - colour, type families, spacing, radius, elevation, motion - stays in colors_and_type.css. */",
    "/* Generated by scripts/build-theme-surfaces.ts; regenerate with `bun run surfaces`. */",
    "",
    ":root {",
    body,
    "}",
    "",
  ].join("\n");
}

function readmeSections(
  tokens: Readonly<Record<DesignSurface, Readonly<Record<string, string>>>>,
  spec: SurfaceSpec,
  slug: string,
): string {
  const slide = tokens.slides;
  const content = tokens.content;
  const safePercent = `${Math.round(Number(content["--content-safe"]) * 100)}%`;
  const bleed = content["--content-bleed"] === "1"
    ? "one deliberate full-bleed figure may cross the safe area because `--content-bleed` is `1`"
    : "nothing crosses the safe area because `--content-bleed` is `0`";
  const reference = deckReferenceFor(slug);
  return [
    "## Surfaces",
    "",
    "This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.",
    "",
    "| Surface | File | Owns | Used by |",
    "|---|---|---|---|",
    "| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |",
    "| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |",
    "| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |",
    "",
    `Content values are authored for a \`--content-base\` shorter side. Per artboard set \`--content-short\` to that frame's shorter side and \`--content-scale: calc(var(--content-short) / var(--content-base))\`, then size type as \`max(${CONTENT_TYPE_FLOOR_PX}px, calc(var(--content-type-body) * var(--content-scale)))\`. \`--content-safe\` is a fraction of the shorter side, so the safe inset is \`calc(var(--content-short) * var(--content-safe))\` on every edge.`,
    "",
    "## Slide deck",
    "",
    ...(reference ? [deckReferenceSection(reference)] : [
    `Slides are fixed ${slide["--slide-w"]!.replace("px", "")} x ${slide["--slide-h"]!.replace("px", "")} CSS px artboards at ${slide["--slide-aspect"]}, not pages: no navigation bar, no footer, no reading measure, no breakpoint, no hover. Nothing required sits outside \`--slide-pad-edge\` (${slide["--slide-pad-edge"]}), and \`--slide-type-caption\` (${slide["--slide-type-caption"]}) is the smallest type on any slide.`,
    "",
    `- Ground: ${spec.ground}; ${spec.signal}.`,
    `- Cover: ${spec.cover}.`,
    `- Structure: ${spec.structure}. One takeaway per slide, titled at \`--slide-type-heading\` (${slide["--slide-type-heading"]}) with support at \`--slide-type-body\` (${slide["--slide-type-body"]}).`,
    `- Imagery: ${spec.figure}. At most one image per slide unless the request asks for a grid.`,
    `- Never: ${spec.never}.`,
    ]),
    "",
    "## Content artboards",
    "",
    `Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (${safePercent} of the shorter side), place the primary figure at \`--content-figure\` (${content["--content-figure"]}) of the shorter side anchored ${content["--content-anchor"]}, and ${bleed}.`,
    "",
    `- Frame: ${spec.ground}; ${spec.signal}.`,
    `- Composition: ${spec.structure}. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.`,
    `- Type: one claim per frame at \`--content-type-hero\` (${content["--content-type-hero"]} at a ${content["--content-base"]} shorter side, scaled by \`--content-scale\`), support at \`--content-type-sub\` (${content["--content-type-sub"]}), and nothing below \`--content-type-caption\` (${content["--content-type-caption"]}) or ${CONTENT_TYPE_FLOOR_PX}px once scaled.`,
    `- Figure: ${spec.figure}.`,
    `- Never: ${spec.never}.`,
    "",
  ].join("\n");
}

const SKILL_SECTION = [
  "## Surfaces",
  "",
  "Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.",
  "",
].join("\n");

/** Replaces everything from the generated `## Surfaces` heading onward, so reruns do not stack. */
function withGeneratedTail(document: string, tail: string): string {
  document = document.replace(/\r\n/g, "\n");
  const index = document.indexOf("\n## Surfaces\n");
  const head = (index === -1 ? document : document.slice(0, index + 1)).replace(/\s+$/, "");
  return `${head}\n\n${tail.replace(/\s+$/, "")}\n`;
}

type System = { readonly name: string; readonly dir: string };

async function registeredSystems(): Promise<readonly System[]> {
  const registry = await readFile(registryPath, "utf8");
  const themes = [...registry.matchAll(/\{ slug: "([a-z0-9-]+)", name: "([^"]+)" \}/g)]
    .map((match) => ({ name: match[2]!, dir: path.join(themesRoot, match[1]!), slug: match[1]! }));
  if (themes.length === 0) throw new Error("No themes found in the bundled registry");
  const samples = ["sonnel", "foliover", "oddward", "velune", "halide"].map((slug) => ({
    name: `${slug.toUpperCase()} sample system`,
    dir: path.join(repoRoot, "samples", "original", slug, "design-system"),
    slug,
  }));
  return [
    ...themes,
    ...samples,
    { name: "Northvale Capital", dir: path.join(repoRoot, "design system sample"), slug: "northvale-capital" },
  ].map(({ name, dir, slug }) => {
    if (!(slug in SPECS)) throw new Error(`No surface spec authored for "${slug}"`);
    return { name, dir, slug };
  });
}

async function build(): Promise<void> {
  const systems = await registeredSystems();
  for (const system of systems) {
    const slug = path.basename(system.dir) === "design-system"
      ? path.basename(path.dirname(system.dir))
      : path.basename(system.dir) === "design system sample" ? "northvale-capital" : path.basename(system.dir);
    const spec = SPECS[slug];
    if (spec === undefined) throw new Error(`No surface spec authored for "${slug}"`);

    const css = await readFile(path.join(system.dir, "colors_and_type.css"), "utf8");
    const tokens = surfaceTokens(layoutSignals(css));
    const reference = deckReferenceFor(slug);
    if (reference) Object.assign(tokens.slides, {
      "--slide-columns": String(reference.columns),
      "--slide-pad-edge": `${reference.edge}px`,
      "--slide-type-hero": `${reference.hero}px`,
    });
    for (const surface of DESIGN_SURFACES) {
      const unexpected = Object.keys(tokens[surface]).filter((token) => !REQUIRED_SURFACE_TOKENS[surface].includes(token));
      if (unexpected.length > 0) throw new Error(`${slug}: ${surface} surface declares unknown ${unexpected.join(", ")}`);
      // Parse what we are about to write, so an unusable value fails here instead of silently
      // falling back to a default at prompt time.
      const contract = parseDesignSystemSurface({
        schema_version: 1,
        surface,
        tokens: tokens[surface],
        sections: surface === "website" ? [] : [{ kind: surface, text: "generated" }],
        supplied: [],
      });
      const missing = missingDesignSystemSurface(contract);
      if (missing.length > 0) throw new Error(`${slug}: ${surface} surface is missing ${missing.join(", ")}`);
    }

    await mkdir(path.join(system.dir, "surfaces"), { recursive: true });
    for (const surface of DESIGN_SURFACES) {
      await writeFile(
        path.join(system.dir, DESIGN_SURFACE_FILES[surface].split("/").join(path.sep)),
        surfaceCss(system.name, surface, tokens[surface]),
        "utf8",
      );
    }

    const readmePath = path.join(system.dir, "README.md");
    await writeFile(readmePath, withGeneratedTail(await readFile(readmePath, "utf8"), readmeSections(tokens, spec, slug)), "utf8");
    const skillPath = path.join(system.dir, "SKILL.md");
    await writeFile(skillPath, withGeneratedTail(await readFile(skillPath, "utf8"), SKILL_SECTION), "utf8");
  }
  console.log(`Wrote ${systems.length * DESIGN_SURFACES.length} surface files and README sections for ${systems.length} design systems.`);
}

await build();
