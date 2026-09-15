# Cupcake Built-in Theme

A warm pastel system with rounded controls and soft aqua, pink, and apricot accents.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The donor palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Provenance

Derived from the daisyUI `cupcake` theme: https://github.com/saadeghi/daisyui/blob/master/packages/daisyui/src/themes/cupcake.css

Licensed under the MIT License, Copyright (c) 2020 Pouya Saadeghi. Source OKLCH values were converted offline to sRGB, gamut-clipped, and rounded to the nearest 8-bit channel. See the repository `NOTICE` file.

## Local typography

- Display: DM Serif Display; body: DM Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: Gowun Batang for serif headings, Pretendard; finish with generic serif/sans-serif/monospace.
- Body 16–18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32–64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Layout

Use the existing 12-column body grid, 1080px content maximum, 54ch reading measure and 24px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

Keep page margins and section rhythm from colors_and_type.css. The legacy --layout-hero ratio is a secondary-media fallback.

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `profile-popover` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `68px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `960px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `media-bottom` | Opening composition |
| `--layout-hero-copy-ratio` | `66%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `4 / 3` | Opening media aspect ratio |
| `--layout-hero-media-position` | `below` | Opening media placement |
| `--layout-hero-min-height` | `620px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `20ch` | Maximum title line measure |
| `--layout-hero-align` | `center` | Hero copy alignment |
| `--layout-hero-offset` | `40px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `ruled-community` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `400px` | Footer minimum height; content may grow |

## Composition

Navigation profile-popover → hero media-bottom (66% copy zone, below media, 4 / 3, 620px minimum) → retain the existing theme-specific body hierarchy → footer ruled-community.

Keep the friendly soft panels subordinate to the product, with welcoming benefit groups and calm story sections. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Responsive

Below the theme's existing compact breakpoint: Keep copy above the media; remove negative overlap when it would cover the heading and preserve the image's intended framing. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile stacks logo, actions and legal information into ruled horizontal sections; the decorative band remains at the bottom. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `profile-popover` at `top`, with `68px` minimum height and `960px` width (0px fills the available track). Use top navigation with a 960px maximum width and 68px header height. At compact widths, use the FAQ chip and a single-column FAQ card. Keep the anchored popover within viewport width and preserve direct CTA access.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [profile-popover](https://www.navbar.gallery/navbar/hosier-brown). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `media-bottom`: copy share `66%`, media at `below` in a `4 / 3` frame, minimum height `620px`, title measure `20ch`, alignment `center` and desktop offset `40px`. Allow the image to cross a rounded lower panel boundary; retain soft corners and a compact profile chip rather than dense top navigation. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Keep copy above the media; remove negative overlap when it would cover the heading and preserve the image's intended framing.

Structural reference: [media-bottom](https://supahero.io/hero/maggie-app). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `ruled-community` with `3` desktop groups and `400px` minimum height. Reserve 400px as the desktop minimum closing height with 3 information columns or groups. Use a three-part community directory with a separate decorative baseline. Preserve real semantic links and a clear primary join action; use original local artwork.

Mobile stacks logo, actions and legal information into ruled horizontal sections; the decorative band remains at the bottom. Allow links to wrap and let the closing region grow with content.

Structural reference: [ruled-community](https://www.footer.design/sites/harvest-hall). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.

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

- Ground: soft pastel panels on warm paper; pink or teal carries one friendly action.
- Cover: a welcoming title above a rounded media panel.
- Structure: benefit groups in soft panels and calm story sections; nothing is boxed twice. One takeaway per slide, titled at `--slide-type-heading` (52px) with support at `--slide-type-body` (32px).
- Imagery: a bright product or everyday scene, with soft corners applied in CSS rather than baked in. At most one image per slide unless the request asks for a grid.
- Never: hard shadows, dense tables, sharp corporate grids.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (8% of the shorter side), place the primary figure at `--content-figure` (0.53) of the shorter side anchored bottom, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: soft pastel panels on warm paper; pink or teal carries one friendly action.
- Composition: benefit groups in soft panels and calm story sections; nothing is boxed twice. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (120px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (56px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: a bright product or everyday scene, with soft corners applied in CSS rather than baked in.
- Never: hard shadows, dense tables, sharp corporate grids.
