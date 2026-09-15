# Ledger Index Theme

A hairline-ruled index: boxed cells, all-caps micro type, monochrome imagery, no radius and no shadow.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1400px content maximum, 48ch reading measure and 0px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | 1400px | Outer content width |
| `--layout-measure` | 48ch | Reading measure for body copy |
| `--layout-columns` | 12 | Base column count |
| `--layout-gutter` | 0px | Space between columns |
| `--layout-margin` | 24px | Page side margin |
| `--layout-section-y` | 0px | Vertical rhythm between sections |
| `--layout-rule` | 1px | Divider weight |
| `--layout-bp-md` / `--layout-bp-lg` | 800px / 1180px | Breakpoints |
| `--layout-hero` | 1 / 1 | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `side-rail` | Website navigation arrangement |
| `--layout-nav-position` | `side` | Website navigation position |
| `--layout-nav-height` | `72px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `220px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `product-panel` | Opening composition |
| `--layout-hero-copy-ratio` | `64%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `16 / 10` | Opening media aspect ratio |
| `--layout-hero-media-position` | `below` | Opening media placement |
| `--layout-hero-min-height` | `580px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `23ch` | Maximum title line measure |
| `--layout-hero-align` | `center` | Hero copy alignment |
| `--layout-hero-offset` | `0px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `retail-accordion` | Footer arrangement |
| `--layout-footer-columns` | `4` | Desktop footer groups |
| `--layout-footer-height` | `480px` | Footer minimum height; content may grow |

## Composition

Navigation side-rail → hero product-panel (64% copy zone, below media, 16 / 10, 580px minimum) → retain the existing theme-specific body hierarchy → footer retail-accordion.

Keep the ruled index body: shared-edge cells, mono labels, monochrome imagery and emphasis by cell size and rule weight. No radius or shadow. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An indexed item shown plainly — an artefact, a document, a building, a specimen. It identifies an entry rather than illustrating a story.

**Treatment.** Converted to monochrome with a full but gentle tonal range, so a page of them reads as one consistent set. No colour survives.

**Light.** Even and documentary. Contrast should be moderate; crushed blacks or blown highlights break the uniformity of the sheet.

**Framing.** For the website opening, place this theme's source art in the 16 / 10 frame at below specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Monochrome only, on the paper ground. The interface supplies no colour to compete with.

**Never:**
- Colour images of any kind.
- Inconsistent tonal treatment between cells.
- Drop shadows, rounded corners, or borders baked into the file.
- Dramatic contrast that makes one cell dominate the sheet.

**Prompt skeleton.** `monochrome documentary photograph of a single indexed item, even documentary lighting, moderate contrast with a full gentle tonal range, cropped to fill the frame, consistent treatment, no colour, no shadow effects`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the ruled index body: shared-edge cells, mono labels, monochrome imagery and emphasis by cell size and rule weight. No radius or shadow.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, and shape rules were composed for this theme; no third-party theme, stylesheet, palette, or asset is included, and it carries no external license obligation.

## Local typography

- Display: Public Sans; body: Public Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for all UI text, "Nanum Myeongjo" for serif; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Keep title, actions and interface panel in document order; allow the panel to scale proportionally rather than forcing desktop width. Convert the side rail into a compact top control with a native expandable navigation; release its desktop width. Mobile replaces the three link columns with three ruled rows showing plus disclosure marks; locale/legal is centered beneath, above the cropped wordmark. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `side-rail` at `side`, with `72px` minimum height and `220px` width (0px fills the available track). Use side navigation with a 220px maximum width and 72px header height. At compact widths, use compact icon/hamburger top bar and large vertical text menu. Convert the desktop rail to an overlay so content retains width.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [side-rail](https://www.navbar.gallery/navbar/big-dirty-agency). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `product-panel`: copy share `64%`, media at `below` in a `16 / 10` frame, minimum height `580px`, title measure `23ch`, alignment `center` and desktop offset `0px`. Offset the main page by a real navigation rail, then center a concise introduction above overlapping interface/device panels. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Keep title, actions and interface panel in document order; allow the panel to scale proportionally rather than forcing desktop width. Convert the side rail into a compact top control with a native expandable navigation; release its desktop width. Mobile replaces the three link columns with three ruled rows showing plus disclosure marks; locale/legal is centered beneath, above the cropped wordmark.

Structural reference: [product-panel](https://supahero.io/hero/easlo). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `retail-accordion` with `4` desktop groups and `480px` minimum height. Reserve 480px as the desktop minimum closing height with 4 information columns or groups. Use native details/summary for the narrow-screen navigation groups if disclosure is needed. The desktop gallery screenshot does not establish a working subscription form, so provide one only when backed by a real flow.

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

Slides are fixed 1920 x 1080 CSS px artboards at 16 / 9, not pages: no navigation bar, no footer, no reading measure, no breakpoint, no hover. Nothing required sits outside `--slide-pad-edge` (72px), and `--slide-type-caption` (24px) is the smallest type on any slide.

- Ground: the ruled index sheet; emphasis comes from cell size and rule weight, not colour.
- Cover: a concise title above one product panel, shared edges throughout.
- Structure: shared-edge cells and mono labels, with no radius and no shadow. One takeaway per slide, titled at `--slide-type-heading` (52px) with support at `--slide-type-body` (32px).
- Imagery: an indexed item shown plainly, monochrome and consistently toned. At most one image per slide unless the request asks for a grid.
- Never: colour images, inconsistent tone between cells, one cell dominating the sheet.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (7% of the shorter side), place the primary figure at `--content-figure` (0.54) of the shorter side anchored bottom, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: the ruled index sheet; emphasis comes from cell size and rule weight, not colour.
- Composition: shared-edge cells and mono labels, with no radius and no shadow. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (116px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (56px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: an indexed item shown plainly, monochrome and consistently toned.
- Never: colour images, inconsistent tone between cells, one cell dominating the sheet.
