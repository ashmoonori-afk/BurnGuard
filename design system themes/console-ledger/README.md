# Console Ledger Theme

An operations ledger: dark ground, mono numerals everywhere, and state carried by a narrow colour set that only ever appears on values.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1560px content maximum, 66ch reading measure and 12px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1560px` | Outer content width |
| `--layout-measure` | `66ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `12px` | Space between columns |
| `--layout-margin` | `clamp(12px, 2vw, 24px)` | Page side margin |
| `--layout-section-y` | `clamp(16px, 2vw, 32px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `4 / 1` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `segmented-pill` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `76px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1120px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `split-reverse` | Opening composition |
| `--layout-hero-copy-ratio` | `32%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `16 / 9` | Opening media aspect ratio |
| `--layout-hero-media-position` | `left` | Opening media placement |
| `--layout-hero-min-height` | `700px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `12ch` | Maximum title line measure |
| `--layout-hero-align` | `end` | Hero copy alignment |
| `--layout-hero-offset` | `48px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `retail-accordion` | Footer arrangement |
| `--layout-footer-columns` | `4` | Desktop footer groups |
| `--layout-footer-height` | `480px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `top` | `top` or `side` — whether embedded-workspace navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `0` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |
| `--family-data-table-layout` | `fixed` | `auto` or `fixed` — the width-allocation algorithm for full-width data tables. |

Within the embedded work surface, navigation sits on top so the full width belongs to the ledger; the side span is zero because no rail exists. Labels sit beside their values in the classic ledger arrangement. Fixed table layout keeps numeric columns from resizing as values update, which matters when a number changes every second.

## Composition

Navigation segmented-pill → hero split-reverse (32% copy zone, left media, 16 / 9, 700px minimum) → retain the existing theme-specific body hierarchy → footer retail-accordion.

Keep right-aligned tabular numbers, tight hairline rows and compact labelled figures. Health colours mark values, never filled rows; use mechanical corners and no elevation. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A plotted figure rather than a photograph: a sparkline, a time series, a distribution, a status matrix. The image carries data or it does not appear.

**Treatment.** Rendered as flat vector on the page ground with hairline axes and no chart junk — no gridlines beyond the minimum, no gradients, no shadow, no 3D.

**Light.** Not applicable; this is a rendered figure, not a captured scene. Value comes from line weight and the state colours alone.

**Framing.** For the website opening, place this theme's source art in the 16 / 9 frame at left specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Page ground with the state colours only — green, amber, red — plus the steel blue for a neutral series. No decorative palette, no more than four series.

**Never:**
- Photographs of any kind; this system has no photographic surface.
- Gradients, glows, drop shadows, or 3D chart effects.
- More than four series in one figure.
- Decorative colour that does not map to a defined state.

**Prompt skeleton.** `flat vector data figure on a dark ground, hairline axes, single-weight lines, state colours green amber red plus one steel blue series, no gridlines beyond the minimum, no gradient, no shadow, wide strip aspect, maximum four series`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep right-aligned tabular numbers, tight hairline rows and compact labelled figures. Health colours mark values, never filled rows; use mechanical corners and no elevation.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Geist; body: Geist; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Place the image and text in a single column with the visual lead preserved; remove the desktop offset and keep readable text order. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile replaces the three link columns with three ruled rows showing plus disclosure marks; locale/legal is centered beneath, above the cropped wordmark. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `segmented-pill` at `top`, with `76px` minimum height and `1120px` width (0px fills the available track). Use top navigation with a 1120px maximum width and 76px header height. Mobile screenshot has product CTA and close above large stacked product/ecosystem/company rows. Keep grouping and use stacked drill-down rows.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [segmented-pill](https://www.navbar.gallery/navbar/consensys). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `split-reverse`: copy share `32%`, media at `left` in a `16 / 9` frame, minimum height `700px`, title measure `12ch`, alignment `end` and desktop offset `48px`. Reserve the upper-right for a narrow heading and let the technical scene occupy the larger left field; keep the segmented header asymmetrical. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Place the image and text in a single column with the visual lead preserved; remove the desktop offset and keep readable text order.

Structural reference: [split-reverse](https://supahero.io/hero/madar). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `retail-accordion` with `4` desktop groups and `480px` minimum height. Reserve 480px as the desktop minimum closing height with 4 information columns or groups. Use native details/summary for the narrow-screen navigation groups if disclosure is needed. The desktop gallery screenshot does not establish a working subscription form, so provide one only when backed by a real flow.

Mobile replaces the three link columns with three ruled rows showing plus disclosure marks; locale/legal is centered beneath, above the cropped wordmark. Allow links to wrap and let the closing region grow with content.

Structural reference: [retail-accordion](https://www.footer.design/sites/outway). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.

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

- Ground: tight hairline rows of right-aligned tabular numbers; health colours mark values, never whole rows.
- Cover: a compact labelled figure beside the title.
- Structure: mechanical corners, no elevation, at most four series in a figure. One takeaway per slide, titled at `--slide-type-heading` (52px) with support at `--slide-type-body` (32px).
- Imagery: a plotted figure that carries data, or no image at all. At most one image per slide unless the request asks for a grid.
- Never: photographs of any kind, gradients or glows, colour that maps to no state.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (8% of the shorter side), place the primary figure at `--content-figure` (0.70) of the shorter side anchored left, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: tight hairline rows of right-aligned tabular numbers; health colours mark values, never whole rows.
- Composition: mechanical corners, no elevation, at most four series in a figure. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (116px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (56px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: a plotted figure that carries data, or no image at all.
- Never: photographs of any kind, gradients or glows, colour that maps to no state.
