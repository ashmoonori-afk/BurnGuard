---
name: builtin-field-register-design
description: Use this bundled Field Register Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation enterprise-columns → hero split-left (40% copy zone, right media, 1 / 1, 600px minimum) → retain the existing theme-specific body hierarchy → footer ruled-community.

Keep the warm paper ground, white fields, label/value rows and explicit required and validation text. Teal is for focus or action; retain the stationery character. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

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
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |
| `--family-data-table-layout` | `fixed` | `auto` or `fixed` — the width-allocation algorithm for full-width data tables. |

A three-column rail carries section progress through a long record, so the operator always knows what remains. Labels sit beside their fields in a fixed track, which keeps a long form scannable as a list of answered and unanswered questions. Fixed table layout applies to the review tables that summarise a completed record.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Documentary reference attached to a record — a site photograph, a scanned form, a condition shot. Evidence, not illustration.

**Treatment.** Plain documentary capture with no styling or grading. It should look like it was taken to prove something, because that is its role in the record.

**Light.** Available light, even and honest. Correct exposure matters; atmosphere does not.

**Framing.** For the website opening, place this theme's source art in the 1 / 1 frame at right specified by Hero; keep its subject, medium, light and grading. Keep the complete subject visible with contain or an inner figure; do not crop evidence, objects or architecture to fill the outer region. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Muted and natural, with the warm paper ground surrounding it. Nothing saturated enough to compete with the validation colours.

**Never:**
- Stylised, graded, or staged photography — it undermines the evidentiary role.
- Evidence without a containing hairline frame; the outer Hero region may expand while the record itself remains bounded.
- Saturated colour that could be mistaken for a validation state.
- Decorative stock imagery with no relationship to the record.

**Prompt skeleton.** `plain documentary photograph as record evidence, available even light, correct honest exposure, muted natural colour, contained framing with clear subject, no styling, no grading, no staging`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the warm paper ground, white fields, label/value rows and explicit required and validation text. Teal is for focus or action; retain the stationery character.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: IBM Plex Sans KR; body: IBM Plex Sans KR; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "IBM Plex Sans KR" natively, then "Pretendard"; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1400px maximum width and 112px header height. At compact widths, use category rows with chevrons under a compact brand/close bar. Collapse taxonomy columns into grouped disclosures.

Reference: https://www.navbar.gallery/navbar/cloudflare

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Balance a short left statement against one strong right specimen, separated by open space; reinforce field-note order with a ruled closing directory. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/dialweb

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 460px as the desktop minimum closing height with 3 information columns or groups. Use a three-part community directory with a separate decorative baseline. Preserve real semantic links and a clear primary join action; use original local artwork.

Reference: https://www.footer.design/sites/harvest-hall

## Surfaces

Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.
