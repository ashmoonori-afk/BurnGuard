# Retro Built-in Theme

A warm paper-like system with muted coral, mint, amber, and sturdy geometry.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The donor palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Provenance

Derived from the daisyUI `retro` theme: https://github.com/saadeghi/daisyui/blob/master/packages/daisyui/src/themes/retro.css

Licensed under the MIT License, Copyright (c) 2020 Pouya Saadeghi. Source OKLCH values were converted offline to sRGB, gamut-clipped, and rounded to the nearest 8-bit channel. See the repository `NOTICE` file.

## Local typography

- Display: DM Serif Display; body: DM Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: Gowun Batang for serif headings, Pretendard; finish with generic serif/sans-serif/monospace.
- Body 16–18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32–64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Layout

Use the existing 12-column body grid, 1180px content maximum, 58ch reading measure and 28px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

Keep page margins and section rhythm from colors_and_type.css. The legacy --layout-hero ratio is a secondary-media fallback.

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `editorial-overlay` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `84px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1240px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `specimen-poster` | Opening composition |
| `--layout-hero-copy-ratio` | `78%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `4 / 3` | Opening media aspect ratio |
| `--layout-hero-media-position` | `background` | Opening media placement |
| `--layout-hero-min-height` | `700px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `12ch` | Maximum title line measure |
| `--layout-hero-align` | `center` | Hero copy alignment |
| `--layout-hero-offset` | `48px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `window-stage` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `620px` | Footer minimum height; content may grow |

## Composition

Navigation editorial-overlay → hero specimen-poster (78% copy zone, background media, 4 / 3, 700px minimum) → retain the existing theme-specific body hierarchy → footer window-stage.

Keep the printed editorial character, broad bands and small supporting figures; avoid uniform card rows. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Responsive

Below the theme's existing compact breakpoint: Put useful labels in a normal-flow caption block below the complete specimen; decorative title size must not cause horizontal scroll. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile centers the title and one visible link window in a vertical stack, retaining the ticker and three equal bottom glyph cells. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `editorial-overlay` at `top`, with `84px` minimum height and `1240px` width (0px fills the available track). Use top navigation with a 1240px maximum width and 84px header height. At compact widths, use one vertical large-link list with close control. Stack links first; featured work and contact information follow.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [editorial-overlay](https://www.navbar.gallery/navbar/clonix). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `specimen-poster`: copy share `78%`, media at `background` in a `4 / 3` frame, minimum height `700px`, title measure `12ch`, alignment `center` and desktop offset `48px`. Place the beverage or original object in front of an enormous wordmark, then close with an intentionally playful three-cell window stage. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Put useful labels in a normal-flow caption block below the complete specimen; decorative title size must not cause horizontal scroll.

Structural reference: [specimen-poster](https://supahero.io/hero/royal-beverage). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `window-stage` with `3` desktop groups and `620px` minimum height. Reserve 620px as the desktop minimum closing height with 3 information columns or groups. Build the footer as title stage, compact link panels, then a three-cell brand band. Keep panels in normal document flow on narrow screens; animation is optional.

Mobile centers the title and one visible link window in a vertical stack, retaining the ticker and three equal bottom glyph cells. Allow links to wrap and let the closing region grow with content.

Structural reference: [window-stage](https://www.footer.design/sites/the-design-society). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.

## Surfaces

This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.

| Surface | File | Owns | Used by |
|---|---|---|---|
| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |
| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |
| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |

Content values are authored for a `--content-base` shorter side. Per artboard set `--content-short` to that frame's shorter side and `--content-scale: calc(var(--content-short) / var(--content-base))`, then size type as `max(12px, calc(var(--content-type-body) * var(--content-scale)))`. `--content-safe` is a fraction of the shorter side, so the safe inset is `calc(var(--content-short) * var(--content-safe))` on every edge.

## Slide deck

Reference adaptation: 068 - Burger King Brand Guidelines (pp. 1, 3, 4, 33, 65, 97). Layout only; retain this system's own colours, fonts and image direction.

1920 x 1080; use --slide-* geometry and type. Keep required content inside --slide-pad-edge; captions at least 24px. No website navigation, hover or scrolling inside a slide.

- Cover: Stacked oversized display title on a flat warm brand ground; deliberate colour changes between title lines.

- Body: Guideline page: left 4/12 explanatory rail and right 8/12 large product or mark specimen; no extra containers.

- Evidence: A clearly labelled correct/incorrect pair or a sparse application sheet at consistent scale; keep examples large enough for projection.

- Closing: One warm colour field and a short bold action. Borrow hierarchy and composition, never the source brand's logo, font or illustrations.

Sequence: cover > claim > evidence > implication > closing; repeat claim/evidence for longer decks, with a chapter after each topic. Do not repeat one body layout throughout. Use real supplied data and appropriate authored/generated images; capture actual app UI when demonstrating software. Split overflowing content instead of shrinking type.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (8% of the shorter side), place the primary figure at `--content-figure` (0.47) of the shorter side anchored center, and one deliberate full-bleed figure may cross the safe area because `--content-bleed` is `1`.

- Frame: printed editorial bands on aged paper; the print palette colours a band or a heading, not small parts.
- Composition: broad bands with small supporting figures; avoid uniform card rows. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (132px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (60px), and nothing below `--content-type-caption` (26px) or 12px once scaled.
- Figure: an object photographed as a print specimen, matte and unglossed.
- Never: uniform card rows, digital gradients, thin modern grids.
