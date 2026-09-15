# Timber Hall Theme

An evening-interior system: dark timber ground, warm lamplight as the only colour, and full-bleed rooms with practical information set quietly beneath.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1440px content maximum, 54ch reading measure and 20px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1440px` | Outer content width |
| `--layout-measure` | `54ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `20px` | Space between columns |
| `--layout-margin` | `clamp(16px, 3vw, 48px)` | Page side margin |
| `--layout-section-y` | `clamp(64px, 9vw, 144px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `21 / 9` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `mega-feature` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `96px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1240px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `split-left` | Opening composition |
| `--layout-hero-copy-ratio` | `44%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `21 / 9` | Opening media aspect ratio |
| `--layout-hero-media-position` | `right` | Opening media placement |
| `--layout-hero-min-height` | `680px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `18ch` | Maximum title line measure |
| `--layout-hero-align` | `start` | Hero copy alignment |
| `--layout-hero-offset` | `52px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `ruled-community` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `480px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `1.6` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-spatial-image-bleed` | `100%` | How far designated images extend from the content edge toward the viewport edge; 0% contained, 100% full-bleed. |

Full bleed at 100% with covered frames, so a lit room reaches the viewport edge and the dark page continues out of the photograph. The media track leads text at 1.6, as in the warm daylight system, because the place is still the argument.

## Composition

Navigation mega-feature → hero split-left (44% copy zone, right media, 21 / 9, 680px minimum) → retain the existing theme-specific body hierarchy → footer ruled-community.

Keep dark timber and warm lamplight, low-light rooms with dark edges, serif statements and quiet practical information. Amber marks action, radii stay at most 2px and nothing is elevated. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An interior after dark — a dining room, a bar, a library, a hall lit by lamps. Empty of people, lit from within.

**Treatment.** Low-light interior photography with warm tungsten colour, deep timber and leather tones, and shadows falling to near-black at the frame edges so the image merges with the page ground.

**Light.** Practical lamps inside the frame as the only sources — table lamps, sconces, candles. Pools of warm light with real darkness between them. No fill light, no flash.

**Framing.** For the website opening, place this theme's source art in the 21 / 9 frame at right specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Near-black, dark timber, leather brown and a single warm amber from the lamps. No cool colour anywhere; no saturated accent objects.

**Never:**
- Bright or evenly lit interiors; the merge with the dark ground depends on falloff.
- Daylight, cool white bulbs, or mixed colour temperature.
- People, staff, or diners in frame.
- Edges that stay bright — the frame must fall dark at its borders.

**Prompt skeleton.** `low-light interior photograph of an empty dining room after dark, warm tungsten table lamps as the only light sources, pools of amber light with deep darkness between them, dark timber and leather tones, frame edges falling to near-black, panoramic 21:9, no people, no flash, no daylight`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep dark timber and warm lamplight, low-light rooms with dark edges, serif statements and quiet practical information. Amber marks action, radii stay at most 2px and nothing is elevated.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Newsreader; body: Figtree; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Stack the copy above the image; retain a visible text/image boundary and allow actions to wrap. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile stacks logo, actions and legal information into ruled horizontal sections; the decorative band remains at the bottom. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `mega-feature` at `top`, with `96px` minimum height and `1240px` width (0px fills the available track). Use top navigation with a 1240px maximum width and 96px header height. At compact widths, use brand plus close control and stacked product/service disclosures. Stack columns and move featured content below links.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [mega-feature](https://www.navbar.gallery/navbar/chesapeake-plywood). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `split-left`: copy share `44%`, media at `right` in a `21 / 9` frame, minimum height `680px`, title measure `18ch`, alignment `start` and desktop offset `52px`. Retain the serif statement on solid ground at left and a dark-edged panoramic room scene at right; do not float the statement directly over the photograph. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Stack the copy above the image; retain a visible text/image boundary and allow actions to wrap.

Structural reference: [split-left](https://supahero.io/hero/yucca-packing). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `ruled-community` with `3` desktop groups and `480px` minimum height. Reserve 480px as the desktop minimum closing height with 3 information columns or groups. Use a three-part community directory with a separate decorative baseline. Preserve real semantic links and a clear primary join action; use original local artwork.

Mobile stacks logo, actions and legal information into ruled horizontal sections; the decorative band remains at the bottom. Allow links to wrap and let the closing region grow with content.

Structural reference: [ruled-community](https://www.footer.design/sites/harvest-hall). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.

## Surfaces

This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.

| Surface | File | Owns | Used by |
|---|---|---|---|
| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |
| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |
| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |

Content values are authored for a `--content-base` shorter side. Per artboard set `--content-short` to that frame's shorter side and `--content-scale: calc(var(--content-short) / var(--content-base))`, then size type as `max(12px, calc(var(--content-type-body) * var(--content-scale)))`. `--content-safe` is a fraction of the shorter side, so the safe inset is `calc(var(--content-short) * var(--content-safe))` on every edge.

## Slide deck

Reference adaptation: 068 - Burger King Brand Guidelines (pp. 1, 3, 4, 33, 65, 97). Layout only; retain this system's own colours, fonts and image direction.

1920 x 1080; use --slide-* geometry and type. Keep required content inside --slide-pad-edge; captions at least 24px. No website navigation, hover or scrolling inside a slide.

- Cover: Stacked oversized display title on a flat warm brand ground; deliberate colour changes between title lines.

- Body: Guideline page: left 4/12 explanatory rail and right 8/12 large product or mark specimen; no extra containers.

- Evidence: A clearly labelled correct/incorrect pair or a sparse application sheet at consistent scale; keep examples large enough for projection.

- Closing: One warm colour field and a short bold action. Borrow hierarchy and composition, never the source brand's logo, font or illustrations.

Sequence: cover > claim > evidence > implication > closing; repeat claim/evidence for longer decks, with a chapter after each topic. Do not repeat one body layout throughout. Use real supplied data and appropriate authored/generated images; capture actual app UI when demonstrating software. Split overflowing content instead of shrinking type.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (8% of the shorter side), place the primary figure at `--content-figure` (0.64) of the shorter side anchored right, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: dark timber and warm lamplight with dark edges; amber marks the action; radii stay at or below 2px.
- Composition: quiet practical information, nothing elevated. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (116px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (52px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: an interior after dark, empty of people and lit from within.
- Never: bright evenly lit interiors, daylight or cool bulbs, edges that stay bright.
