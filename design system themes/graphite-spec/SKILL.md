---
name: builtin-graphite-spec-design
description: Use this bundled Graphite Spec Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation segmented-pill → hero specimen-poster (34% copy zone, background media, 5 / 4, 760px minimum) → retain the existing theme-specific body hierarchy → footer studio-address.

Keep a measured mono body, numbered figures, margin annotations and first-class tables. Amber marks the discussed value; graphite, bone, zero radius and rules do the rest. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

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
| `--family-ui-navigation-span` | `2` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |

Within the embedded work surface, navigation is a compact top row at 44px with a rule beneath. Labels sit beside their control, matching the document's two-track annotation structure so a form reads like a spec table.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Technical drawing and measured artifacts: an exploded view, a section drawing, a dimensioned component, a calibration surface. Line work rather than photography wherever possible.

**Treatment.** Flat vector line drawing on the graphite ground, hairline weight, no fills except where a part must be distinguished. Where photography is required, make it a flat frontal record shot with no styling.

**Light.** Not applicable to line work. For record photography, flat even illumination with no modelling — the goal is legibility of form, not atmosphere.

**Framing.** For the website opening, place this theme's source art in the 5 / 4 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Bone line work on graphite, with amber reserved for the single dimension or part being called out.

**Never:**
- Perspective renders, dramatic angles, or atmospheric lighting.
- Colour fills beyond the single amber callout.
- Decorative iconography standing in for a real diagram.
- Soft shadows or any suggestion of depth.

**Prompt skeleton.** `flat orthographic technical line drawing of a mechanical component, hairline bone-white strokes on dark graphite background, dimension lines and leader labels, one amber highlighted dimension, no shading, no perspective`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep a measured mono body, numbered figures, margin annotations and first-class tables. Amber marks the discussed value; graphite, bone, zero radius and rules do the rest.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: IBM Plex Mono; body: IBM Plex Mono; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for UI text; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1280px maximum width and 72px header height. Mobile screenshot has product CTA and close above large stacked product/ecosystem/company rows. Keep grouping and use stacked drill-down rows.

Reference: https://www.navbar.gallery/navbar/consensys

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Present one complete specimen against a broad neutral field with a small inset detail and separated metadata; retain disciplined technical labeling. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/haptikos

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 540px as the desktop minimum closing height with 4 information columns or groups. Use an asymmetrical studio directory whose location pair is a first-class structural feature. Do not collapse the whole footer to a generic four-column sitemap.

Reference: https://www.footer.design/sites/reality-is
