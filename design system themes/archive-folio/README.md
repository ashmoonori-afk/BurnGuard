# Archive Folio Theme

A dense archival index on white: small serif throughout, hairline dividers, and a running information column.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1440px content maximum, 64ch reading measure and 20px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | 1440px | Outer content width |
| `--layout-measure` | 64ch | Reading measure for body copy |
| `--layout-columns` | 12 | Base column count |
| `--layout-gutter` | 20px | Space between columns |
| `--layout-margin` | 16px | Page side margin |
| `--layout-section-y` | clamp(28px, 3vw, 48px) | Vertical rhythm between sections |
| `--layout-rule` | 1px | Divider weight |
| `--layout-bp-md` / `--layout-bp-lg` | 840px / 1200px | Breakpoints |
| `--layout-hero` | 4 / 5 | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `profile-popover` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `64px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1080px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `portfolio-peek` | Opening composition |
| `--layout-hero-copy-ratio` | `44%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `4 / 3` | Opening media aspect ratio |
| `--layout-hero-media-position` | `below` | Opening media placement |
| `--layout-hero-min-height` | `640px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `21ch` | Maximum title line measure |
| `--layout-hero-align` | `center` | Hero copy alignment |
| `--layout-hero-offset` | `44px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `studio-address` | Footer arrangement |
| `--layout-footer-columns` | `4` | Desktop footer groups |
| `--layout-footer-height` | `500px` | Footer minimum height; content may grow |

## Composition

Navigation profile-popover → hero portfolio-peek (44% copy zone, below media, 4 / 3, 640px minimum) → retain the existing theme-specific body hierarchy → footer studio-address.

Keep dense serif entries, dates and notes alongside their records, hairline dividers and tight rhythm. Hierarchy comes from position and weight, with no radius or elevation. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An archival item — a document, a photograph, a print, a page — reproduced as a record of the thing rather than as a picture.

**Treatment.** Flat reproduction photography on white, square to the item, with the item's own edges, age and surface visible. No cleanup, no enhancement.

**Light.** Even copy-stand lighting with no glare and no directional shadow. Colour accurate to the original.

**Framing.** For the website opening, place this theme's source art in the 4 / 3 frame at below specified by Hero; keep its subject, medium, light and grading. Keep the complete subject visible with contain or an inner figure; do not crop evidence, objects or architecture to fill the outer region. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** White ground with the item's own aged tones — paper yellowing, ink fade, emulsion shift. The interface adds nothing.

**Never:**
- Styled or angled photography of the item.
- Digital cleanup that removes age, creases or edge wear.
- Enlarging an archive item without its identifying caption; keep body entries compact.
- Added borders, shadows, or textures in the file.

**Prompt skeleton.** `flat archival reproduction photograph of a document square to the camera on white, even copy-stand lighting with no glare, item complete with small white margin, accurate aged paper and ink tones, no retouching, no styling`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep dense serif entries, dates and notes alongside their records, hairline dividers and tight rhythm. Hierarchy comes from position and weight, with no radius or elevation.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, and shape rules were composed for this theme; no third-party theme, stylesheet, palette, or asset is included, and it carries no external license obligation.

## Local typography

- Display: Newsreader; body: Newsreader; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif text, "Pretendard" for UI labels; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Convert scattered or overlapping panels into a deliberate ordered list; preserve one dominant work and smaller supporting items. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile stacks the link groups, keeps the two office addresses side by side, and moves the large wordmark below them. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `profile-popover` at `top`, with `64px` minimum height and `1080px` width (0px fills the available track). Use top navigation with a 1080px maximum width and 64px header height. At compact widths, use the FAQ chip and a single-column FAQ card. Keep the anchored popover within viewport width and preserve direct CTA access.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [profile-popover](https://www.navbar.gallery/navbar/hosier-brown). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `portfolio-peek`: copy share `44%`, media at `below` in a `4 / 3` frame, minimum height `640px`, title measure `21ch`, alignment `center` and desktop offset `44px`. Keep the biographical statement narrow and centered, with a larger central work card and partially revealed neighboring work cards below. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Convert scattered or overlapping panels into a deliberate ordered list; preserve one dominant work and smaller supporting items.

Structural reference: [portfolio-peek](https://supahero.io/hero/eric-jordan). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `studio-address` with `4` desktop groups and `500px` minimum height. Reserve 500px as the desktop minimum closing height with 4 information columns or groups. Use an asymmetrical studio directory whose location pair is a first-class structural feature. Do not collapse the whole footer to a generic four-column sitemap.

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

Slides are fixed 1920 x 1080 CSS px artboards at 16 / 9, not pages: no navigation bar, no footer, no reading measure, no breakpoint, no hover. Nothing required sits outside `--slide-pad-edge` (84px), and `--slide-type-caption` (24px) is the smallest type on any slide.

- Ground: dense serif entries on the archive sheet; position and weight carry hierarchy; colour does not.
- Cover: a compact title block with the record itself beneath it.
- Structure: dates and notes beside their records, hairline dividers, tight rhythm. One takeaway per slide, titled at `--slide-type-heading` (48px) with support at `--slide-type-body` (30px).
- Imagery: an archival item reproduced as a record, keeping its identifying caption. At most one image per slide unless the request asks for a grid.
- Never: styled angled photography, cleaning away age and creases, added borders or shadows.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (8% of the shorter side), place the primary figure at `--content-figure` (0.64) of the shorter side anchored bottom, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: dense serif entries on the archive sheet; position and weight carry hierarchy; colour does not.
- Composition: dates and notes beside their records, hairline dividers, tight rhythm. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (112px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (52px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: an archival item reproduced as a record, keeping its identifying caption.
- Never: styled angled photography, cleaning away age and creases, added borders or shadows.
