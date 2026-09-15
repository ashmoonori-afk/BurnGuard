# Dracula Built-in Theme

A dark violet-gray system with bright pink, purple, amber, cyan, and green accents.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The donor palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Provenance

Derived from the daisyUI `dracula` theme: https://github.com/saadeghi/daisyui/blob/master/packages/daisyui/src/themes/dracula.css

Licensed under the MIT License, Copyright (c) 2020 Pouya Saadeghi. Source OKLCH values were converted offline to sRGB, gamut-clipped, and rounded to the nearest 8-bit channel. See the repository `NOTICE` file.

## Local typography

- Display: Space Grotesk; body: DM Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: Pretendard; finish with generic serif/sans-serif/monospace.
- Body 16–18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32–64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Layout

Use the existing 12-column body grid, 1320px content maximum, 64ch reading measure and 24px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

Keep page margins and section rhythm from colors_and_type.css. The legacy --layout-hero ratio is a secondary-media fallback.

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `editorial-overlay` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `80px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1320px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `masthead-crop` | Opening composition |
| `--layout-hero-copy-ratio` | `88%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `16 / 9` | Opening media aspect ratio |
| `--layout-hero-media-position` | `background` | Opening media placement |
| `--layout-hero-min-height` | `720px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `11ch` | Maximum title line measure |
| `--layout-hero-align` | `center` | Hero copy alignment |
| `--layout-hero-offset` | `80px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `studio-address` | Footer arrangement |
| `--layout-footer-columns` | `4` | Desktop footer groups |
| `--layout-footer-height` | `520px` | Footer minimum height; content may grow |

## Composition

Navigation editorial-overlay → hero masthead-crop (88% copy zone, background media, 16 / 9, 720px minimum) → retain the existing theme-specific body hierarchy → footer studio-address.

Keep continuous documentation, inset code examples and contextual contents within the reading body; do not box every paragraph. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Responsive

Below the theme's existing compact breakpoint: Reduce the oversized display to fit the viewport; move useful metadata into normal flow and keep the subject recognizable. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile stacks the link groups, keeps the two office addresses side by side, and moves the large wordmark below them. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `editorial-overlay` at `top`, with `80px` minimum height and `1320px` width (0px fills the available track). Use top navigation with a 1320px maximum width and 80px header height. At compact widths, use one vertical large-link list with close control. Stack links first; featured work and contact information follow.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [editorial-overlay](https://www.navbar.gallery/navbar/clonix). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `masthead-crop`: copy share `88%`, media at `background` in a `16 / 9` frame, minimum height `720px`, title measure `11ch`, alignment `center` and desktop offset `80px`. Let the display masthead and lower product silhouette carry the first fold; retain dark negative space and an asymmetric studio address ending. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Reduce the oversized display to fit the viewport; move useful metadata into normal flow and keep the subject recognizable.

Structural reference: [masthead-crop](https://supahero.io/hero/shaga-odyssey). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `studio-address` with `4` desktop groups and `520px` minimum height. Reserve 520px as the desktop minimum closing height with 4 information columns or groups. Use an asymmetrical studio directory whose location pair is a first-class structural feature. Do not collapse the whole footer to a generic four-column sitemap.

Mobile stacks the link groups, keeps the two office addresses side by side, and moves the large wordmark below them. Allow links to wrap and let the closing region grow with content.

Structural reference: [studio-address](https://www.footer.design/sites/reality-is). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.

## Surfaces

This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.

| Surface | File | Owns | Used by |
|---|---|---|---|
| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |
| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |
| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |

Content values are authored for a `--content-base` shorter side. Per artboard set `--content-short` to that frame's shorter side and `--content-scale: calc(var(--content-short) / var(--content-base))`, then size type as `max(12px, calc(var(--content-type-body) * var(--content-scale)))`. `--content-safe` is a fraction of the shorter side, so the safe inset is `calc(var(--content-short) * var(--content-safe))` on every edge.

## Slide deck

Slides are fixed 1920 x 1080 CSS px artboards at 16 / 9, not pages: no navigation bar, no footer, no reading measure, no breakpoint, no hover. Nothing required sits outside `--slide-pad-edge` (92px), and `--slide-type-caption` (26px) is the smallest type on any slide.

- Ground: the dark documentation ground; purple or pink marks an active term.
- Cover: a display masthead with the subject silhouette below it.
- Structure: continuous prose blocks and inset code examples; do not box every line. One takeaway per slide, titled at `--slide-type-heading` (60px) with support at `--slide-type-body` (34px).
- Imagery: a cropped masthead image, or a code surface rendered as a real element. At most one image per slide unless the request asks for a grid.
- Never: boxing every paragraph, four-column sitemaps, bright fills.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (9% of the shorter side), place the primary figure at `--content-figure` (0.42) of the shorter side anchored center, and one deliberate full-bleed figure may cross the safe area because `--content-bleed` is `1`.

- Frame: the dark documentation ground; purple or pink marks an active term.
- Composition: continuous prose blocks and inset code examples; do not box every line. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (136px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (64px), and nothing below `--content-type-caption` (26px) or 12px once scaled.
- Figure: a cropped masthead image, or a code surface rendered as a real element.
- Never: boxing every paragraph, four-column sitemaps, bright fills.
