---
name: builtin-market-stack-design
description: Use this bundled Market Stack Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation mega-feature → hero portfolio-peek (38% copy zone, background media, 1 / 1, 640px minimum) → retain the existing theme-specific body hierarchy → footer retail-accordion.

Keep the bright ground, soft large shapes, square product plates and prices as headlines. Orange carries action, blue links and focus, and yellow badge fills only. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Secondary media defaults to `--layout-hero`; website opening media uses `--layout-hero-media-ratio` and the Hero section.

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-commerce-gallery-layout` | `stacked` | `stacked`, `paired`, or `lead-and-pairs` — the repeating placement pattern of a product gallery. |
| `--family-commerce-purchase-position` | `sticky` | `flow` or `sticky` — whether the purchase panel scrolls with content or pins inside its section. |

A stacked gallery keeps one product in view at a time at full attention. The purchase panel sticks within its section so price and action stay reachable through a long scroll, dropping back to flow below `--layout-bp-md`.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** One product, straight on, filling its square frame. Everyday desirable goods rather than luxury objects — food, tools, homeware, apparel shot cheerfully.

**Treatment.** Bright saturated product photography with clean edges and a coloured or warm-white backdrop. Punchy but true colour; the image should feel energetic rather than precious.

**Light.** Even and bright with a soft shadow under the object. High key overall; no deep shadows anywhere in frame.

**Framing.** For the website opening, place this theme's source art in the 1 / 1 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Warm white or a single flat saturated backdrop drawn from the accent set. One product colour plus the backdrop; avoid multi-colour clutter.

**Never:**
- Dark, moody, or low-key treatments — they kill the system's energy.
- Inconsistent crops within body product stacks; the website opening uses its separate Hero ratio.
- Busy scenes with multiple products fighting for attention.
- Muted or desaturated grading.

**Prompt skeleton.** `bright product photograph, single everyday object centred and filling a square 1:1 frame, flat warm-white or saturated backdrop, even high-key lighting with a soft contact shadow, punchy true colour, small consistent margin, no clutter`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the bright ground, soft large shapes, square product plates and prices as headlines. Orange carries action, blue links and focus, and yellow badge fills only.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Outfit; body: Plus Jakarta Sans; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1400px maximum width and 112px header height. At compact widths, use brand plus close control and stacked product/service disclosures. Stack columns and move featured content below links.

Reference: https://www.navbar.gallery/navbar/chesapeake-plywood

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Make the invitation a small center while original product figures form an asymmetric orbit; the retail directory must remain a distinct lower band. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/superpower

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 560px as the desktop minimum closing height with 4 information columns or groups. Use native details/summary for the narrow-screen navigation groups if disclosure is needed. The desktop gallery screenshot does not establish a working subscription form, so provide one only when backed by a real flow.

Reference: https://www.footer.design/sites/outway

## Surfaces

Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.
