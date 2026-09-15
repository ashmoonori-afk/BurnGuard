# Cyberpunk Built-in Theme

A high-energy yellow system with neon pink, cyan, and violet accents and square geometry.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The donor palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Provenance

Derived from the daisyUI `cyberpunk` theme: https://github.com/saadeghi/daisyui/blob/master/packages/daisyui/src/themes/cyberpunk.css

Licensed under the MIT License, Copyright (c) 2020 Pouya Saadeghi. Source OKLCH values were converted offline to sRGB, gamut-clipped, and rounded to the nearest 8-bit channel. See the repository `NOTICE` file.

## Local typography

- Display: Bebas Neue; body: DM Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: Pretendard; finish with generic serif/sans-serif/monospace.
- Body 16–18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32–64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Layout

Use the existing 12-column body grid, 1440px content maximum, 52ch reading measure and 16px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

Keep page margins and section rhythm from colors_and_type.css. The legacy --layout-hero ratio is a secondary-media fallback.

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `enterprise-columns` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `104px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1440px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `fullbleed-top` | Opening composition |
| `--layout-hero-copy-ratio` | `88%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `16 / 9` | Opening media aspect ratio |
| `--layout-hero-media-position` | `background` | Opening media placement |
| `--layout-hero-min-height` | `680px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `14ch` | Maximum title line measure |
| `--layout-hero-align` | `center` | Hero copy alignment |
| `--layout-hero-offset` | `0px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `scenic-overlay` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `520px` | Footer minimum height; content may grow |

## Composition

Navigation enterprise-columns → hero fullbleed-top (88% copy zone, background media, 16 / 9, 680px minimum) → retain the existing theme-specific body hierarchy → footer scenic-overlay.

Keep hard grid edges, compact status strips and supporting telemetry. Preserve a clear scan order despite the dense detail. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Responsive

Below the theme's existing compact breakpoint: Separate text onto a readable ground when the crop removes its safe area; keep the scene and all essential links in normal flow. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile gives the scene its own tall area above a dark information region. Navigation becomes a two-column grid; a row of three small marks and the tagline follow. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `enterprise-columns` at `top`, with `104px` minimum height and `1440px` width (0px fills the available track). Use top navigation with a 1440px maximum width and 104px header height. At compact widths, use category rows with chevrons under a compact brand/close bar. Collapse taxonomy columns into grouped disclosures.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [enterprise-columns](https://www.navbar.gallery/navbar/cloudflare). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `fullbleed-top`: copy share `88%`, media at `background` in a `16 / 9` frame, minimum height `680px`, title measure `14ch`, alignment `center` and desktop offset `0px`. Use a broad phone/product scene with headline in the top third and a pair of broad action bands; keep navigation in two clearly separated tiers. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Separate text onto a readable ground when the crop removes its safe area; keep the scene and all essential links in normal flow.

Structural reference: [fullbleed-top](https://supahero.io/hero/payy). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `scenic-overlay` with `3` desktop groups and `520px` minimum height. Reserve 520px as the desktop minimum closing height with 3 information columns or groups. Reserve a scenic field above a readable information zone on narrow screens. Use an original local background; do not depend on WebGL or video for access to navigation.

Mobile gives the scene its own tall area above a dark information region. Navigation becomes a two-column grid; a row of three small marks and the tagline follow. Allow links to wrap and let the closing region grow with content.

Structural reference: [scenic-overlay](https://www.footer.design/sites/eclipse-space). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.

## Surfaces

This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.

| Surface | File | Owns | Used by |
|---|---|---|---|
| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |
| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |
| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |

Content values are authored for a `--content-base` shorter side. Per artboard set `--content-short` to that frame's shorter side and `--content-scale: calc(var(--content-short) / var(--content-base))`, then size type as `max(12px, calc(var(--content-type-body) * var(--content-scale)))`. `--content-safe` is a fraction of the shorter side, so the safe inset is `calc(var(--content-short) * var(--content-safe))` on every edge.

## Slide deck

Reference adaptation: 199 - Figma CONFIG2025 Conference Deck (pp. 1, 2, 3, 4, 7, 10, 12). Layout only; retain this system's own colours, fonts and image direction.

1920 x 1080; use --slide-* geometry and type. Keep required content inside --slide-pad-edge; captions at least 24px. No website navigation, hover or scrolling inside a slide.

- Cover: Oversized left-aligned type in 8/12; cropped geometric forms occupy the opposite corner or bottom band.

- Body: Speaker/event content uses one horizontal portrait band with aligned labels. Alternate black, light and brand-accent chapter grounds.

- Evidence: Use a 7/5 split: three short statements left, a large example above a caption block right; geometric bands establish hierarchy.

- Closing: One oversized takeaway and one cropped geometric block; never repeat the speaker grid as a default body layout.

Sequence: cover > claim > evidence > implication > closing; repeat claim/evidence for longer decks, with a chapter after each topic. Do not repeat one body layout throughout. Use real supplied data and appropriate authored/generated images; capture actual app UI when demonstrating software. Split overflowing content instead of shrinking type.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (7% of the shorter side), place the primary figure at `--content-figure` (0.42) of the shorter side anchored center, and one deliberate full-bleed figure may cross the safe area because `--content-bleed` is `1`.

- Frame: hard grid edges on the dark field; the neon accent marks status, never decoration.
- Composition: compact status strips and supporting telemetry; the scan order stays obvious despite the density. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (132px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (60px), and nothing below `--content-type-caption` (26px) or 12px once scaled.
- Figure: a dense technical or product scene with one calm region for the headline.
- Never: soft rounded panels, pastel tints, glow that maps to no state.
