---
name: builtin-facet-archive-design
description: Use this bundled Facet Archive Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation enterprise-columns → hero media-bottom (82% copy zone, below media, 16 / 9, 640px minimum) → retain the existing theme-specific body hierarchy → footer photo-strip.

Keep the light specimen grid inside dark chrome with a 1px ruling, named specimens and mono identifiers. Typed facets retain counts; steel marks active state and focus. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Secondary media defaults to `--layout-hero`; website opening media uses `--layout-hero-media-ratio` and the Hero section.

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `side` | `top` or `side` — whether embedded-workspace navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `3` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `above` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |
| `--family-data-table-layout` | `auto` | `auto` or `fixed` — the width-allocation algorithm for full-width data tables. |

A three-column facet rail, wider than a filter strip because facets here are typed categories with counts rather than simple switches. Labels sit above their controls so long category names are not truncated. Table layout is auto: the archive's occasional detail tables hold variable-length values and should size to their content.

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

## Local typography

- Display: Space Grotesk; body: Space Grotesk; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1360px maximum width and 104px header height. At compact widths, use category rows with chevrons under a compact brand/close bar. Collapse taxonomy columns into grouped disclosures.

Reference: https://www.navbar.gallery/navbar/cloudflare

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Set a broad heading over a scene that begins beneath it, while a compact top taxonomy and lower photo strip create three clear horizontal levels. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/eventbeds

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 540px as the desktop minimum closing height with 2 information columns or groups. Separate a useful navigation band from an original local photo strip. Decorative shapes must not obscure or intercept links. Do not copy the person's portrait or brand assets.

Reference: https://www.footer.design/sites/carolyn-lee

## Surfaces

Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.
