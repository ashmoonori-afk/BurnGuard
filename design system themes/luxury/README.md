# Luxury Built-in Theme

A near-black system with restrained gold, white, navy, and plum accents.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The donor palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Provenance

Derived from the daisyUI `luxury` theme: https://github.com/saadeghi/daisyui/blob/master/packages/daisyui/src/themes/luxury.css

Licensed under the MIT License, Copyright (c) 2020 Pouya Saadeghi. Source OKLCH values were converted offline to sRGB, gamut-clipped, and rounded to the nearest 8-bit channel. See the repository `NOTICE` file.

## Local typography

- Display: DM Serif Display; body: DM Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: Gowun Batang for serif headings, Pretendard; finish with generic serif/sans-serif/monospace.
- Body 16–18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32–64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Layout

Use the existing 12-column body grid, 1240px content maximum, 50ch reading measure and 32px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

Keep page margins and section rhythm from colors_and_type.css. The legacy --layout-hero ratio is a secondary-media fallback.

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `floating-island` | Website navigation arrangement |
| `--layout-nav-position` | `overlay` | Website navigation position |
| `--layout-nav-height` | `60px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `520px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `framed-cover` | Opening composition |
| `--layout-hero-copy-ratio` | `40%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `3 / 4` | Opening media aspect ratio |
| `--layout-hero-media-position` | `background` | Opening media placement |
| `--layout-hero-min-height` | `760px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `13ch` | Maximum title line measure |
| `--layout-hero-align` | `center` | Hero copy alignment |
| `--layout-hero-offset` | `88px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `photo-strip` | Footer arrangement |
| `--layout-footer-columns` | `2` | Desktop footer groups |
| `--layout-footer-height` | `540px` | Footer minimum height; content may grow |

## Composition

Navigation floating-island → hero framed-cover (40% copy zone, background media, 3 / 4, 760px minimum) → retain the existing theme-specific body hierarchy → footer photo-strip.

Keep restrained captions, generous open space and large product portraits. Avoid repeated boxed cards. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Responsive

Below the theme's existing compact breakpoint: Retain an inset frame but reduce its padding; stack side cells below the dominant cover so the main image remains usable. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile puts the logo first, keeps the two link columns side by side underneath, then shows a tighter photograph crop below the credit line. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `floating-island` at `overlay`, with `60px` minimum height and `520px` width (0px fills the available track). Use overlay navigation with a 520px maximum width and 60px header height. At compact widths, use an expanded dark vertical menu with brand and close control. Preserve compact header and expand links vertically.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [floating-island](https://www.navbar.gallery/navbar/supaste). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `framed-cover`: copy share `40%`, media at `background` in a `3 / 4` frame, minimum height `760px`, title measure `13ch`, alignment `center` and desktop offset `88px`. Treat the existing art as a tall editorial cover, with a narrow centered text axis and quiet photo colophon; avoid stock SaaS cards. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Retain an inset frame but reduce its padding; stack side cells below the dominant cover so the main image remains usable.

Structural reference: [framed-cover](https://supahero.io/hero/casa-lunara). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `photo-strip` with `2` desktop groups and `540px` minimum height. Reserve 540px as the desktop minimum closing height with 2 information columns or groups. Separate a useful navigation band from an original local photo strip. Decorative shapes must not obscure or intercept links. Do not copy the person's portrait or brand assets.

Mobile puts the logo first, keeps the two link columns side by side underneath, then shows a tighter photograph crop below the credit line. Allow links to wrap and let the closing region grow with content.

Structural reference: [photo-strip](https://www.footer.design/sites/carolyn-lee). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.
