# Facet Archive Theme

A faceted archive: dark chrome around an edge-to-edge grid of labelled specimens, with type filters and a sort toggle as the primary navigation.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1920px content maximum, 64ch reading measure and 1px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1920px` | Outer content width |
| `--layout-measure` | `64ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `1px` | Space between columns |
| `--layout-margin` | `0px` | Page side margin |
| `--layout-section-y` | `clamp(16px, 2vw, 32px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `4 / 3` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `enterprise-columns` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `104px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1360px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `media-bottom` | Opening composition |
| `--layout-hero-copy-ratio` | `82%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `16 / 9` | Opening media aspect ratio |
| `--layout-hero-media-position` | `below` | Opening media placement |
| `--layout-hero-min-height` | `640px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `13ch` | Maximum title line measure |
| `--layout-hero-align` | `center` | Hero copy alignment |
| `--layout-hero-offset` | `40px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `photo-strip` | Footer arrangement |
| `--layout-footer-columns` | `2` | Desktop footer groups |
| `--layout-footer-height` | `540px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `side` | `top` or `side` — whether embedded-workspace navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `3` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `above` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |
| `--family-data-table-layout` | `auto` | `auto` or `fixed` — the width-allocation algorithm for full-width data tables. |

A three-column facet rail, wider than a filter strip because facets here are typed categories with counts rather than simple switches. Labels sit above their controls so long category names are not truncated. Table layout is auto: the archive's occasional detail tables hold variable-length values and should size to their content.

## Composition

Navigation enterprise-columns → hero media-bottom (82% copy zone, below media, 16 / 9, 640px minimum) → retain the existing theme-specific body hierarchy → footer photo-strip.

Keep the light specimen grid inside dark chrome with a 1px ruling, named specimens and mono identifiers. Typed facets retain counts; steel marks active state and focus. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A specimen: a material sample, a surface, a swatch, a component, a single plant or mineral. One specimen per frame, identifiable and classifiable.

**Treatment.** Straight-on catalogue capture with the specimen filling most of the frame on a plain ground. Texture and surface must read clearly because the specimen is being classified by its material.

**Light.** Even, slightly raking light — flat enough to be comparable across specimens, angled just enough to reveal surface relief.

**Framing.** For the website opening, place this theme's source art in the 16 / 9 frame at below specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Neutral ground with the specimen's true colour. The ground should be light so the cells read as lit plates inside the dark chrome.

**Never:**
- Dark backgrounds inside cells; the contrast between light grid and dark chrome is the system.
- Styled or posed compositions with more than one specimen.
- Inconsistent camera distance or crop between specimens.
- Colour grading that changes the specimen's real material colour.

**Prompt skeleton.** `straight-on catalogue photograph of a single material specimen on a plain light neutral ground, even slightly raking light revealing surface relief, specimen centred with small even margin, true material colour, 4:3, consistent camera distance, no styling`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the light specimen grid inside dark chrome with a 1px ruling, named specimens and mono identifiers. Typed facets retain counts; steel marks active state and focus.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Space Grotesk; body: Space Grotesk; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Keep copy above the media; remove negative overlap when it would cover the heading and preserve the image's intended framing. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile puts the logo first, keeps the two link columns side by side underneath, then shows a tighter photograph crop below the credit line. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `enterprise-columns` at `top`, with `104px` minimum height and `1360px` width (0px fills the available track). Use top navigation with a 1360px maximum width and 104px header height. At compact widths, use category rows with chevrons under a compact brand/close bar. Collapse taxonomy columns into grouped disclosures.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [enterprise-columns](https://www.navbar.gallery/navbar/cloudflare). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `media-bottom`: copy share `82%`, media at `below` in a `16 / 9` frame, minimum height `640px`, title measure `13ch`, alignment `center` and desktop offset `40px`. Set a broad heading over a scene that begins beneath it, while a compact top taxonomy and lower photo strip create three clear horizontal levels. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Keep copy above the media; remove negative overlap when it would cover the heading and preserve the image's intended framing.

Structural reference: [media-bottom](https://supahero.io/hero/eventbeds). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `photo-strip` with `2` desktop groups and `540px` minimum height. Reserve 540px as the desktop minimum closing height with 2 information columns or groups. Separate a useful navigation band from an original local photo strip. Decorative shapes must not obscure or intercept links. Do not copy the person's portrait or brand assets.

Mobile puts the logo first, keeps the two link columns side by side underneath, then shows a tighter photograph crop below the credit line. Allow links to wrap and let the closing region grow with content.

Structural reference: [photo-strip](https://www.footer.design/sites/carolyn-lee). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.
