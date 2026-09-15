# Light Built-in Theme

A crisp neutral canvas with saturated violet, pink, and teal accents.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The donor palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Provenance

Derived from the daisyUI `light` theme: https://github.com/saadeghi/daisyui/blob/master/packages/daisyui/src/themes/light.css

Licensed under the MIT License, Copyright (c) 2020 Pouya Saadeghi. Source OKLCH values were converted offline to sRGB, gamut-clipped, and rounded to the nearest 8-bit channel. See the repository `NOTICE` file.

## Local typography

- Display: Space Grotesk; body: DM Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: Pretendard; finish with generic serif/sans-serif/monospace.
- Body 16–18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32–64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Layout

Use the existing 12-column body grid, 1200px content maximum, 60ch reading measure and 24px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

Keep page margins and section rhythm from colors_and_type.css. The legacy --layout-hero ratio is a secondary-media fallback.

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `floating-island` | Website navigation arrangement |
| `--layout-nav-position` | `overlay` | Website navigation position |
| `--layout-nav-height` | `64px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `680px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `media-bottom` | Opening composition |
| `--layout-hero-copy-ratio` | `58%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `16 / 9` | Opening media aspect ratio |
| `--layout-hero-media-position` | `below` | Opening media placement |
| `--layout-hero-min-height` | `580px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `22ch` | Maximum title line measure |
| `--layout-hero-align` | `center` | Hero copy alignment |
| `--layout-hero-offset` | `0px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `centered-cta` | Footer arrangement |
| `--layout-footer-columns` | `1` | Desktop footer groups |
| `--layout-footer-height` | `360px` | Footer minimum height; content may grow |

## Composition

Navigation floating-island → hero media-bottom (58% copy zone, below media, 16 / 9, 580px minimum) → retain the existing theme-specific body hierarchy → footer centered-cta.

Keep the neutral canvas crisp; violet, pink and teal provide accents while aligned feature rows carry evidence beneath the opening. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Responsive

Below the theme's existing compact breakpoint: Keep copy above the media; remove negative overlap when it would cover the heading and preserve the image's intended framing. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile retains the same central axis and horizontal social row, reducing the bottom wordmark height. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `floating-island` at `overlay`, with `64px` minimum height and `680px` width (0px fills the available track). Use overlay navigation with a 680px maximum width and 64px header height. At compact widths, use an expanded dark vertical menu with brand and close control. Preserve compact header and expand links vertically.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [floating-island](https://www.navbar.gallery/navbar/supaste). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `media-bottom`: copy share `58%`, media at `below` in a `16 / 9` frame, minimum height `580px`, title measure `22ch`, alignment `center` and desktop offset `0px`. Center a modest introduction above one uninterrupted wide local scene; let a small floating island leave generous outer whitespace. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Keep copy above the media; remove negative overlap when it would cover the heading and preserve the image's intended framing.

Structural reference: [media-bottom](https://supahero.io/hero/eddie). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `centered-cta` with `1` desktop groups and `360px` minimum height. Reserve 360px as the desktop minimum closing height with one information group. Use a conversion-focused footer with one primary action and a small secondary link row. Keep decorative wordmarks separate from accessible link labels.

Mobile retains the same central axis and horizontal social row, reducing the bottom wordmark height. Allow links to wrap and let the closing region grow with content.

Structural reference: [centered-cta](https://www.footer.design/sites/cronicle). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.
