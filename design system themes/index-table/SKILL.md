---
name: builtin-index-table-design
description: Use this bundled Index Table Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation side-rail → hero framed-cover (28% copy zone, left media, 5 / 4, 620px minimum) → retain the existing theme-specific body hierarchy → footer contact-ledger.

Keep fixed-width data columns, compact hairline rows and tabular mono numbers. Neutral tags carry coloured text; blue is reserved for links, focus and the active filter. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

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
| `--family-ui-navigation-span` | `2` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |
| `--family-data-table-layout` | `fixed` | `auto` or `fixed` — the width-allocation algorithm for full-width data tables. |

Within the embedded work surface, navigation sits beside the content in a two-column track, because filters are navigation here and must stay visible while rows scroll. Labels sit beside their controls so a filter panel stays short. The table layout is fixed: column widths must not jump as rows load, since a moving column is worse than a narrow one.

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

## Local typography

- Display: Urbanist; body: Urbanist; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use side navigation with a 232px maximum width and 88px header height. At compact widths, use compact icon/hamburger top bar and large vertical text menu. Convert the desktop rail to an overlay so content retains width.

Reference: https://www.navbar.gallery/navbar/big-dirty-agency

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Combine a dominant image zone and narrow stacked side cells, with a small caption tab touching the media edge; keep the sidebar separate from this internal grid. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/colabs

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 520px as the desktop minimum closing height with 3 information columns or groups. Use whitespace and a vertically organized address ledger rather than many equal navigation columns. Give contact details readable minimum type sizes.

Reference: https://www.footer.design/sites/esr

## Surfaces

Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.
