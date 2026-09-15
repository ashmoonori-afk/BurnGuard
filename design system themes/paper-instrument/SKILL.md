---
name: builtin-paper-instrument-design
description: Use this bundled Paper Instrument Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation mega-feature → hero framed-cover (80% copy zone, right media, 3 / 2, 640px minimum) → retain the existing theme-specific body hierarchy → footer window-stage.

Keep bright paper, generous emptiness and ink-blue actions. Scale, position and full-width hairline rules provide hierarchy; no filled panels or elevation. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

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

Within the embedded work surface, navigation is a quiet top row with a hairline beneath it. Labels sit beside their control in a second track, which suits specification-style forms where the label is read as a field name rather than a prompt.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single manufactured object or instrument on a plain seamless surface — a measuring tool, a component, a clean product form. One object, centred or on a clear axis.

**Treatment.** Bright, even, near-shadowless product photography. Pure white or bone seamless background that merges with the page ground. Crisp edges, true colour, no texture overlay.

**Light.** Broad soft daylight from the front-top, almost flat, with only the faintest contact shadow to seat the object. No dramatic modelling.

**Framing.** For the website opening, place this theme's source art in the 3 / 2 frame at right specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Achromatic: paper white, light greys, the object's own neutral material. If one accent appears it is the same ink-blue as `--primary-blue`, and only as a small detail.

**Never:**
- Dark or coloured backdrops — the image must merge into the paper ground.
- Hard directional shadows, dramatic contrast, or moody grading.
- Cluttered arrangements, props, hands, or lifestyle staging.
- Gradient meshes or abstract 3D blobs.

**Prompt skeleton.** `product photograph of a single precision instrument on a seamless white background, soft even frontal daylight, minimal contact shadow, generous empty space around the subject, achromatic palette, sharp edges, no props`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep bright paper, generous emptiness and ink-blue actions. Scale, position and full-width hairline rules provide hierarchy; no filled panels or elevation.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Instrument Sans; body: Instrument Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1200px maximum width and 96px header height. At compact widths, use brand plus close control and stacked product/service disclosures. Stack columns and move featured content below links.

Reference: https://www.navbar.gallery/navbar/chesapeake-plywood

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Place a left-aligned statement within an inset paper-like cover and expose the outer field; preserve the instrument-like rule and annotation language. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/easyfast

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 580px as the desktop minimum closing height with 3 information columns or groups. Build the footer as title stage, compact link panels, then a three-cell brand band. Keep panels in normal document flow on narrow screens; animation is optional.

Reference: https://www.footer.design/sites/the-design-society
