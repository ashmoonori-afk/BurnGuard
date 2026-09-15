---
name: builtin-quiet-runtime-design
description: Use this bundled Quiet Runtime Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation floating-island → hero centered-form (52% copy zone, background media, 1 / 1, 600px minimum) → retain the existing theme-specific body hierarchy → footer contact-ledger.

Keep the warm grey ground, soft edged surfaces, humanist sans and one violet for actions. Semantic colours stay in their chips, and motion stays brief. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

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
| `--family-ui-label-placement` | `above` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |

Within the embedded work surface, navigation occupies two of the twelve columns as a side track at expanded widths and collapses to a top row below `--layout-bp-md`. Labels stack above their control so the form stays scannable in a narrow content track.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Interface fragments and soft abstract forms: a rounded panel, a stacked card edge, a gently curved surface. Objects are implied rather than photographed literally.

**Treatment.** Soft-focus 3D render or diffuse photography with matte materials. Rounded geometry, no sharp corners, no reflective surfaces. Gentle gradient across the form.

**Light.** Large diffuse source, wraparound, almost no visible shadow edge. Overcast-window quality.

**Framing.** For the website opening, place this theme's source art in the 1 / 1 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Warm greys matching the page ground, with a single muted violet passage echoing `--primary-blue`. Saturation stays low throughout.

**Never:**
- High-contrast or neon renders — this system's whole point is low arousal.
- Sharp geometric edges or hard specular highlights.
- Literal screenshots of other products.
- Busy compositions with many competing forms.

**Prompt skeleton.** `soft matte 3D render of rounded abstract interface surfaces, warm grey palette with one muted violet passage, large diffuse light, no hard shadows, low saturation, generous margin, calm composition`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the warm grey ground, soft edged surfaces, humanist sans and one violet for actions. Semantic colours stay in their chips, and motion stays brief.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Manrope; body: Manrope; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use overlay navigation with a 760px maximum width and 64px header height. At compact widths, use an expanded dark vertical menu with brand and close control. Preserve compact header and expand links vertically.

Reference: https://www.navbar.gallery/navbar/supaste

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Keep the central proposition small enough to breathe, with scattered original accents rather than a dense screenshot; close with a thin contact ledger. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/uigraphic

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 400px as the desktop minimum closing height with 3 information columns or groups. Use whitespace and a vertically organized address ledger rather than many equal navigation columns. Give contact details readable minimum type sizes.

Reference: https://www.footer.design/sites/esr

## Surfaces

Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.
