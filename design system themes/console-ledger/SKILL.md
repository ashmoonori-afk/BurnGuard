---
name: builtin-console-ledger-design
description: Use this bundled Console Ledger Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation segmented-pill → hero split-reverse (32% copy zone, left media, 16 / 9, 700px minimum) → retain the existing theme-specific body hierarchy → footer retail-accordion.

Keep right-aligned tabular numbers, tight hairline rows and compact labelled figures. Health colours mark values, never filled rows; use mechanical corners and no elevation. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Secondary media defaults to `--layout-hero`; website opening media uses `--layout-hero-media-ratio` and the Hero section.

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `top` | `top` or `side` — whether embedded-workspace navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `0` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |
| `--family-data-table-layout` | `fixed` | `auto` or `fixed` — the width-allocation algorithm for full-width data tables. |

Within the embedded work surface, navigation sits on top so the full width belongs to the ledger; the side span is zero because no rail exists. Labels sit beside their values in the classic ledger arrangement. Fixed table layout keeps numeric columns from resizing as values update, which matters when a number changes every second.

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

## Local typography

- Display: Geist; body: Geist; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1120px maximum width and 76px header height. Mobile screenshot has product CTA and close above large stacked product/ecosystem/company rows. Keep grouping and use stacked drill-down rows.

Reference: https://www.navbar.gallery/navbar/consensys

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Reserve the upper-right for a narrow heading and let the technical scene occupy the larger left field; keep the segmented header asymmetrical. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/madar

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 480px as the desktop minimum closing height with 4 information columns or groups. Use native details/summary for the narrow-screen navigation groups if disclosure is needed. The desktop gallery screenshot does not establish a working subscription form, so provide one only when backed by a real flow.

Reference: https://www.footer.design/sites/outway
