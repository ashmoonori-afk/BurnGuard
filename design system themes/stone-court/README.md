# Stone Court Theme

A cool masonry system: limestone ground, a didone statement, and images held contained so the architecture is read whole.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1240px content maximum, 60ch reading measure and 28px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1240px` | Outer content width |
| `--layout-measure` | `60ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `28px` | Space between columns |
| `--layout-margin` | `clamp(24px, 5vw, 80px)` | Page side margin |
| `--layout-section-y` | `clamp(64px, 9vw, 144px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `3 / 2` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `editorial-overlay` | Website navigation arrangement |
| `--layout-nav-position` | `overlay` | Website navigation position |
| `--layout-nav-height` | `88px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1320px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `fullbleed-top` | Opening composition |
| `--layout-hero-copy-ratio` | `28%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `16 / 9` | Opening media aspect ratio |
| `--layout-hero-media-position` | `background` | Opening media placement |
| `--layout-hero-min-height` | `800px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `14ch` | Maximum title line measure |
| `--layout-hero-align` | `start` | Hero copy alignment |
| `--layout-hero-offset` | `0px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `studio-address` | Footer arrangement |
| `--layout-footer-columns` | `4` | Desktop footer groups |
| `--layout-footer-height` | `560px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `contain` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `1.0` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-spatial-image-bleed` | `0%` | How far designated images extend from the content edge toward the viewport edge; 0% contained, 100% full-bleed. |

Images are contained and do not bleed at all, because this system documents architecture and a cropped building is an unreadable building. The media and text tracks are equal at 1.0, giving the writing the same standing as the photograph.

## Composition

Navigation editorial-overlay → hero fullbleed-top (28% copy zone, background media, 16 / 9, 800px minimum) → retain the existing theme-specific body hierarchy → footer studio-address.

Keep cool limestone, a didone statement voice and whole architectural plates with ground visible around them. Mono captions identify place, year and material; slate marks action. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An architectural exterior or a masonry detail — a courtyard, a facade, an arcade, a stair, a wall junction. Structure and material, not interiors.

**Treatment.** Formal architectural photography, square to the subject, with true verticals and no lens distortion. Cool neutral colour with stone, concrete, lime plaster and weathered metal reading accurately.

**Light.** Overcast or open-shade daylight with soft even shadows, or raking low sun where texture is the subject. Avoid harsh midday contrast.

**Framing.** For the website opening, place this theme's source art in the 16 / 9 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the complete subject visible with contain or an inner figure; do not crop evidence, objects or architecture to fill the outer region. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Limestone, concrete grey, slate and weathered bronze. Cool neutral overall — the warm end of the spectrum belongs to a different system.

**Never:**
- Cropping into the structure or bleeding it off the frame edge.
- Warm golden-hour grading; this system is deliberately cool.
- Tilted verticals, fisheye, or extreme wide-angle drama.
- People, vehicles, or signage dominating the frame.

**Prompt skeleton.** `formal architectural photograph of a stone courtyard facade, square to the subject with true verticals, overcast soft even daylight, cool neutral limestone and concrete palette, structure complete inside the frame with clear space around it, landscape 3:2, no people, no distortion`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep cool limestone, a didone statement voice and whole architectural plates with ground visible around them. Mono captions identify place, year and material; slate marks action.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: DM Serif Display; body: Manrope; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Separate text onto a readable ground when the crop removes its safe area; keep the scene and all essential links in normal flow. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile stacks the link groups, keeps the two office addresses side by side, and moves the large wordmark below them. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `editorial-overlay` at `overlay`, with `88px` minimum height and `1320px` width (0px fills the available track). Use overlay navigation with a 1320px maximum width and 88px header height. At compact widths, use one vertical large-link list with close control. Stack links first; featured work and contact information follow.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [editorial-overlay](https://www.navbar.gallery/navbar/clonix). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `fullbleed-top`: copy share `28%`, media at `background` in a `16 / 9` frame, minimum height `800px`, title measure `14ch`, alignment `start` and desktop offset `0px`. Keep the whole building or room contained inside an expansive scenic field; limit opening copy to a small corner and leave architecture unobstructed. Retain object-fit: contain for the original artwork: the whole building, document or object must remain visible. Interpret oversized/cropped reference geometry through the frame and typography, not by clipping the artwork.

Mobile: Below the theme's existing compact breakpoint: Separate text onto a readable ground when the crop removes its safe area; keep the scene and all essential links in normal flow.

Structural reference: [fullbleed-top](https://supahero.io/hero/dream-design-laboratory). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `studio-address` with `4` desktop groups and `560px` minimum height. Reserve 560px as the desktop minimum closing height with 4 information columns or groups. Use an asymmetrical studio directory whose location pair is a first-class structural feature. Do not collapse the whole footer to a generic four-column sitemap.

Mobile stacks the link groups, keeps the two office addresses side by side, and moves the large wordmark below them. Allow links to wrap and let the closing region grow with content.

Structural reference: [studio-address](https://www.footer.design/sites/reality-is). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.

## Surfaces

This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.

| Surface | File | Owns | Used by |
|---|---|---|---|
| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |
| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |
| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |

Content values are authored for a `--content-base` shorter side. Per artboard set `--content-short` to that frame's shorter side and `--content-scale: calc(var(--content-short) / var(--content-base))`, then size type as `max(12px, calc(var(--content-type-body) * var(--content-scale)))`. `--content-safe` is a fraction of the shorter side, so the safe inset is `calc(var(--content-short) * var(--content-safe))` on every edge.

## Slide deck

Reference adaptation: 101 - Building a brand like Patagonia (pp. 1, 2, 3, 4, 8, 15, 22, 29). Layout only; retain this system's own colours, fonts and image direction.

1920 x 1080; use --slide-* geometry and type. Keep required content inside --slide-pad-edge; captions at least 24px. No website navigation, hover or scrolling inside a slide.

- Cover: Material photograph in left 5/12, editorial title in right 7/12; a shallow accent band crosses the lower frame.

- Body: Framed image and argument in alternating unequal halves, connected by fine horizontal rules; chapter slides may use centred type on a dark ground.

- Evidence: A large quotation with a smaller contextual photograph anchored bottom-right, or a source column beside an example image.

- Closing: A quiet framed image, one commitment and a readable source rail; avoid decorative chart panels in an editorial story.

Sequence: cover > claim > evidence > implication > closing; repeat claim/evidence for longer decks, with a chapter after each topic. Do not repeat one body layout throughout. Use real supplied data and appropriate authored/generated images; capture actual app UI when demonstrating software. Split overflowing content instead of shrinking type.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (7% of the shorter side), place the primary figure at `--content-figure` (0.72) of the shorter side anchored center, and one deliberate full-bleed figure may cross the safe area because `--content-bleed` is `1`.

- Frame: cool limestone with ground visible around every plate; slate marks the action.
- Composition: mono captions identifying place, year and material; nothing bleeds off the frame. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (116px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (52px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: an architectural exterior or masonry detail: structure and material, not interiors.
- Never: cropping into the structure, warm golden-hour grading, dominant people or signage.
