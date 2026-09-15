# Business Built-in Theme

A sober charcoal system with muted blue, steel, orange, and compact geometry.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The donor palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Provenance

Derived from the daisyUI `business` theme: https://github.com/saadeghi/daisyui/blob/master/packages/daisyui/src/themes/business.css

Licensed under the MIT License, Copyright (c) 2020 Pouya Saadeghi. Source OKLCH values were converted offline to sRGB, gamut-clipped, and rounded to the nearest 8-bit channel. See the repository `NOTICE` file.

## Local typography

- Display: Space Grotesk; body: DM Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: Pretendard; finish with generic serif/sans-serif/monospace.
- Body 16–18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32–64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Layout

Use the existing 12-column body grid, 1440px content maximum, 60ch reading measure and 20px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

Keep page margins and section rhythm from colors_and_type.css. The legacy --layout-hero ratio is a secondary-media fallback.

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `enterprise-columns` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `112px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1360px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `split-left` | Opening composition |
| `--layout-hero-copy-ratio` | `74%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `21 / 9` | Opening media aspect ratio |
| `--layout-hero-media-position` | `below` | Opening media placement |
| `--layout-hero-min-height` | `580px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `17ch` | Maximum title line measure |
| `--layout-hero-align` | `start` | Hero copy alignment |
| `--layout-hero-offset` | `32px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `retail-accordion` | Footer arrangement |
| `--layout-footer-columns` | `4` | Desktop footer groups |
| `--layout-footer-height` | `500px` | Footer minimum height; content may grow |

## Composition

Navigation enterprise-columns → hero split-left (74% copy zone, below media, 21 / 9, 580px minimum) → retain the existing theme-specific body hierarchy → footer retail-accordion.

Keep metrics, filters and the primary table in decision order. Align numeric columns and place secondary activity beneath the work. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Responsive

Below the theme's existing compact breakpoint: Stack the copy above the image; retain a visible text/image boundary and allow actions to wrap. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile replaces the three link columns with three ruled rows showing plus disclosure marks; locale/legal is centered beneath, above the cropped wordmark. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `enterprise-columns` at `top`, with `112px` minimum height and `1360px` width (0px fills the available track). Use top navigation with a 1360px maximum width and 112px header height. At compact widths, use category rows with chevrons under a compact brand/close bar. Collapse taxonomy columns into grouped disclosures.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [enterprise-columns](https://www.navbar.gallery/navbar/cloudflare). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `split-left`: copy share `74%`, media at `below` in a `21 / 9` frame, minimum height `580px`, title measure `17ch`, alignment `start` and desktop offset `32px`. Set the main statement across the top, then split the review evidence left from a narrow action stack right before the media baseline. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Stack the copy above the image; retain a visible text/image boundary and allow actions to wrap.

Structural reference: [split-left](https://supahero.io/hero/fourseven). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `retail-accordion` with `4` desktop groups and `500px` minimum height. Reserve 500px as the desktop minimum closing height with 4 information columns or groups. Use native details/summary for the narrow-screen navigation groups if disclosure is needed. The desktop gallery screenshot does not establish a working subscription form, so provide one only when backed by a real flow.

Mobile replaces the three link columns with three ruled rows showing plus disclosure marks; locale/legal is centered beneath, above the cropped wordmark. Allow links to wrap and let the closing region grow with content.

Structural reference: [retail-accordion](https://www.footer.design/sites/outway). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.

## Surfaces

This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.

| Surface | File | Owns | Used by |
|---|---|---|---|
| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |
| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |
| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |

Content values are authored for a `--content-base` shorter side. Per artboard set `--content-short` to that frame's shorter side and `--content-scale: calc(var(--content-short) / var(--content-base))`, then size type as `max(12px, calc(var(--content-type-body) * var(--content-scale)))`. `--content-safe` is a fraction of the shorter side, so the safe inset is `calc(var(--content-short) * var(--content-safe))` on every edge.

## Slide deck

Slides are fixed 1920 x 1080 CSS px artboards at 16 / 9, not pages: no navigation bar, no footer, no reading measure, no breakpoint, no hover. Nothing required sits outside `--slide-pad-edge` (80px), and `--slide-type-caption` (24px) is the smallest type on any slide.

- Ground: the sober charcoal ground; muted blue marks the decision value.
- Cover: the main statement across the top with evidence left and the action stack right.
- Structure: metrics, filters and one table in decision order, with numeric columns aligned. One takeaway per slide, titled at `--slide-type-heading` (56px) with support at `--slide-type-body` (32px).
- Imagery: a wide evidence panel or chart; stay text-first so PPTX export survives. At most one image per slide unless the request asks for a grid.
- Never: decorative photography, misaligned numeric columns, effects that only survive raster capture.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (7% of the shorter side), place the primary figure at `--content-figure` (0.49) of the shorter side anchored bottom, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: the sober charcoal ground; muted blue marks the decision value.
- Composition: metrics, filters and one table in decision order, with numeric columns aligned. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (124px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (60px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: a wide evidence panel or chart; stay text-first so PPTX export survives.
- Never: decorative photography, misaligned numeric columns, effects that only survive raster capture.
