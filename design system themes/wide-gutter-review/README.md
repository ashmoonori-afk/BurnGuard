# Wide Gutter Review Theme

A two-track review layout: a narrow text spine beside a wide image track, divided by a gutter treated as a design element.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1440px content maximum, 46ch reading measure and 64px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1440px` | Outer content width |
| `--layout-measure` | `46ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `64px` | Space between columns |
| `--layout-margin` | `clamp(20px, 3vw, 48px)` | Page side margin |
| `--layout-section-y` | `clamp(56px, 7vw, 112px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `4 / 5` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `editorial-overlay` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `84px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1440px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `split-left` | Opening composition |
| `--layout-hero-copy-ratio` | `54%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `4 / 3` | Opening media aspect ratio |
| `--layout-hero-media-position` | `right` | Opening media placement |
| `--layout-hero-min-height` | `660px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `9ch` | Maximum title line measure |
| `--layout-hero-align` | `start` | Hero copy alignment |
| `--layout-hero-offset` | `48px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `contact-ledger` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `500px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `2 / 1` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-editorial-paragraph-mode` | `spaced` | `spaced` (a `--sp-4` gap, no indent) or `indented` (1em first line, no gap, not after a heading). |

The image track is twice the text track, gutter excluded. Images cover their frame because in this system the image is a plate at a fixed proportion, and the crop is part of the edit. Paragraphs are spaced by `--sp-4` with no indent, matching the sans body.

## Composition

Navigation editorial-overlay → hero split-left (54% copy zone, right media, 4 / 3, 660px minimum) → retain the existing theme-specific body hierarchy → footer contact-ledger.

Keep a narrow sans reading spine, high-contrast serif titles, mono captions and the empty wide gutter. Blue marks one live item; the page stays flat and square. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single considered subject per plate — a garment, an interior, an artwork, a portrait. One idea per image, presented as a plate rather than a snapshot.

**Treatment.** Editorial photography with deliberate art direction. Clean, decisive, high resolution. The crop is part of the composition, so images are made to be cropped to a tall frame.

**Light.** Controlled and directional, with real shadow shape. Studio or strong window light. Shadows are allowed to be dark.

**Framing.** For the website opening, place this theme's source art in the 4 / 3 frame at right specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** White, black and one material colour per plate. The page is white, so images should not also be white-dominant or they will dissolve into the ground.

**Never:**
- Discarding the subject to force a different frame; preserve the complete editorial subject within the named Hero geometry.
- Busy multi-subject scenes that fight the narrow text track.
- Pale, low-contrast images that disappear against white paper.
- Adding a border or shadow to seat the image; it sits directly on the ground.

**Prompt skeleton.** `editorial photograph, single subject, portrait 4:5 orientation, controlled directional light with defined shadows, one strong material colour against neutral surroundings, decisive crop, high resolution, no border`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep a narrow sans reading spine, high-contrast serif titles, mono captions and the empty wide gutter. Blue marks one live item; the page stays flat and square.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Instrument Serif; body: Public Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Stack the copy above the image; retain a visible text/image boundary and allow actions to wrap. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile keeps small brand/company metadata in two columns, expands the signup rule across the width, stacks contact addresses, and shifts the large wordmark to the bottom. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `editorial-overlay` at `top`, with `84px` minimum height and `1440px` width (0px fills the available track). Use top navigation with a 1440px maximum width and 84px header height. At compact widths, use one vertical large-link list with close control. Stack links first; featured work and contact information follow.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [editorial-overlay](https://www.navbar.gallery/navbar/clonix). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `split-left`: copy share `54%`, media at `right` in a `4 / 3` frame, minimum height `660px`, title measure `9ch`, alignment `start` and desktop offset `48px`. Allow the giant left display and complete right subject to make one asymmetric spread; retain exceptionally broad gutters through the contact footer. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Stack the copy above the image; retain a visible text/image boundary and allow actions to wrap.

Structural reference: [split-left](https://supahero.io/hero/karo). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `contact-ledger` with `3` desktop groups and `500px` minimum height. Reserve 500px as the desktop minimum closing height with 3 information columns or groups. Use whitespace and a vertically organized address ledger rather than many equal navigation columns. Give contact details readable minimum type sizes.

Mobile keeps small brand/company metadata in two columns, expands the signup rule across the width, stacks contact addresses, and shifts the large wordmark to the bottom. Allow links to wrap and let the closing region grow with content.

Structural reference: [contact-ledger](https://www.footer.design/sites/esr). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.

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

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (8% of the shorter side), place the primary figure at `--content-figure` (0.59) of the shorter side anchored right, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: a narrow sans spine beside an empty wide gutter; blue marks one live item.
- Composition: mono captions on flat square surfaces; the wide gutter stays empty. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (128px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (60px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: one considered subject per plate, presented whole rather than snapped.
- Never: busy multi-subject scenes, pale low-contrast plates, filling the gutter.
