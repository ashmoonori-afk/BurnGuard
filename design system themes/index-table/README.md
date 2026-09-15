# Index Table Theme

A directory system: the page is one long sortable table, columns are the layout, and tags carry every piece of emphasis.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1680px content maximum, 70ch reading measure and 16px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1680px` | Outer content width |
| `--layout-measure` | `70ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `16px` | Space between columns |
| `--layout-margin` | `clamp(12px, 2vw, 28px)` | Page side margin |
| `--layout-section-y` | `clamp(20px, 2.5vw, 40px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `3 / 1` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `side-rail` | Website navigation arrangement |
| `--layout-nav-position` | `side` | Website navigation position |
| `--layout-nav-height` | `88px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `232px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `framed-cover` | Opening composition |
| `--layout-hero-copy-ratio` | `28%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `5 / 4` | Opening media aspect ratio |
| `--layout-hero-media-position` | `left` | Opening media placement |
| `--layout-hero-min-height` | `620px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `18ch` | Maximum title line measure |
| `--layout-hero-align` | `start` | Hero copy alignment |
| `--layout-hero-offset` | `0px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `contact-ledger` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `520px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `side` | `top` or `side` — whether embedded-workspace navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `2` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |
| `--family-data-table-layout` | `fixed` | `auto` or `fixed` — the width-allocation algorithm for full-width data tables. |

Within the embedded work surface, navigation sits beside the content in a two-column track, because filters are navigation here and must stay visible while rows scroll. Labels sit beside their controls so a filter panel stays short. The table layout is fixed: column widths must not jump as rows load, since a moving column is worse than a narrow one.

## Composition

Navigation side-rail → hero framed-cover (28% copy zone, left media, 5 / 4, 620px minimum) → retain the existing theme-specific body hierarchy → footer contact-ledger.

Keep fixed-width data columns, compact hairline rows and tabular mono numbers. Neutral tags carry coloured text; blue is reserved for links, focus and the active filter. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A small square thumbnail representing a row entry — a specimen, a sample, a cover, a screenshot. It identifies a row; it is never decorative.

**Treatment.** Flat, uniform, high-key capture on a light neutral ground, processed identically across every row so a column of thumbnails reads as one consistent strip.

**Light.** Completely even, no directional shadow, no depth. Anything that suggests a scene will break the column.

**Framing.** For the website opening, place this theme's source art in the 5 / 4 frame at left specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Light neutral ground with one dominant subject colour. Every thumbnail in a table must share the same ground so the column looks uniform.

**Never:**
- Decorative photography replacing the working data surface; an opening specimen must retain its identifier and relation to the dataset.
- Varied backgrounds between rows — the column must look machine-produced.
- Fine detail or small text inside the thumbnail.
- Drop shadows, rounded photo corners baked into the file, or borders in the image.

**Prompt skeleton.** `flat uniform thumbnail image of a single subject on a light neutral ground, completely even shadowless lighting, one clear dominant shape readable at 64px, square 1:1, no fine detail, no scene, consistent background`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep fixed-width data columns, compact hairline rows and tabular mono numbers. Neutral tags carry coloured text; blue is reserved for links, focus and the active filter.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Urbanist; body: Urbanist; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Retain an inset frame but reduce its padding; stack side cells below the dominant cover so the main image remains usable. Convert the side rail into a compact top control with a native expandable navigation; release its desktop width. Mobile keeps small brand/company metadata in two columns, expands the signup rule across the width, stacks contact addresses, and shifts the large wordmark to the bottom. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `side-rail` at `side`, with `88px` minimum height and `232px` width (0px fills the available track). Use side navigation with a 232px maximum width and 88px header height. At compact widths, use compact icon/hamburger top bar and large vertical text menu. Convert the desktop rail to an overlay so content retains width.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [side-rail](https://www.navbar.gallery/navbar/big-dirty-agency). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `framed-cover`: copy share `28%`, media at `left` in a `5 / 4` frame, minimum height `620px`, title measure `18ch`, alignment `start` and desktop offset `0px`. Combine a dominant image zone and narrow stacked side cells, with a small caption tab touching the media edge; keep the sidebar separate from this internal grid. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Retain an inset frame but reduce its padding; stack side cells below the dominant cover so the main image remains usable. Convert the side rail into a compact top control with a native expandable navigation; release its desktop width. Mobile keeps small brand/company metadata in two columns, expands the signup rule across the width, stacks contact addresses, and shifts the large wordmark to the bottom.

Structural reference: [framed-cover](https://supahero.io/hero/colabs). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `contact-ledger` with `3` desktop groups and `520px` minimum height. Reserve 520px as the desktop minimum closing height with 3 information columns or groups. Use whitespace and a vertically organized address ledger rather than many equal navigation columns. Give contact details readable minimum type sizes.

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

Reference adaptation: 173 - IBM Cost of a Data Breach Report 2023 (pp. 1, 2, 3, 20, 40, 59). Layout only; retain this system's own colours, fonts and image direction.

1920 x 1080; use --slide-* geometry and type. Keep required content inside --slide-pad-edge; captions at least 24px. No website navigation, hover or scrolling inside a slide.

- Cover: Quiet title in left 6/12; one analytical line motif in right 6/12, with generous whitespace.

- Body: Research page: narrow finding column at left 3/12, one large chart at centre 6/12, methodology or comparison in right 3/12.

- Evidence: A single readable chart leads; direct labels, units, period and source below. Two charts only when they share a comparison question.

- Closing: A concise finding and a next-step column on a light ground. Printed footnotes become a dedicated appendix slide.

Sequence: cover > claim > evidence > implication > closing; repeat claim/evidence for longer decks, with a chapter after each topic. Do not repeat one body layout throughout. Use real supplied data and appropriate authored/generated images; capture actual app UI when demonstrating software. Split overflowing content instead of shrinking type.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (7% of the shorter side), place the primary figure at `--content-figure` (0.72) of the shorter side anchored left, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: the machine-produced data sheet; blue is reserved for links, focus and the active filter.
- Composition: fixed-width columns, compact hairline rows and tabular mono numbers. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (112px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (52px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: a small square thumbnail that identifies a row; it is never decoration.
- Never: decorative photography replacing the data surface, varied backgrounds between rows, coloured tag fills.
