# Dune Editorial Theme

Warm sand neutrals under an oversized grotesque wordmark, with a serif lede over full-bleed imagery.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1320px content maximum, 56ch reading measure and 28px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | 1320px | Outer content width |
| `--layout-measure` | 56ch | Reading measure for body copy |
| `--layout-columns` | 12 | Base column count |
| `--layout-gutter` | 28px | Space between columns |
| `--layout-margin` | clamp(20px, 4vw, 56px) | Page side margin |
| `--layout-section-y` | clamp(80px, 11vw, 180px) | Vertical rhythm between sections |
| `--layout-rule` | 1px | Divider weight |
| `--layout-bp-md` / `--layout-bp-lg` | 800px / 1160px | Breakpoints |
| `--layout-hero` | 3 / 2 | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `editorial-overlay` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `88px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1160px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `split-reverse` | Opening composition |
| `--layout-hero-copy-ratio` | `36%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `4 / 5` | Opening media aspect ratio |
| `--layout-hero-media-position` | `left` | Opening media placement |
| `--layout-hero-min-height` | `740px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `11ch` | Maximum title line measure |
| `--layout-hero-align` | `start` | Hero copy alignment |
| `--layout-hero-offset` | `64px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `photo-strip` | Footer arrangement |
| `--layout-footer-columns` | `2` | Desktop footer groups |
| `--layout-footer-height` | `600px` | Footer minimum height; content may grow |

## Composition

Navigation editorial-overlay → hero split-reverse (36% copy zone, left media, 4 / 5, 740px minimum) → retain the existing theme-specific body hierarchy → footer photo-strip.

Keep sand neutrals, the grotesque name and serif speaking voice. Terracotta carries actions; use hairline rules, small radii and wide editorial rhythm. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Landscape and natural surface at scale — dune, escarpment, dry riverbed, weathered wall. Human-free and horizon-led.

**Treatment.** Wide natural photography with warm sand, ochre and clay tones, fine surface texture, and soft atmospheric haze in the distance.

**Light.** Low warm sun raking across the surface so texture reads, with long soft shadows. Midday flatness defeats the image.

**Framing.** For the website opening, place this theme's source art in the 4 / 5 frame at left specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Sand, ochre, clay and warm shadow, matching the page ground closely enough that the bleed edge is invisible.

**Never:**
- Cool, green, or blue-dominant landscapes.
- People, vehicles, or built structures dominating the frame.
- Busy frames with no calm region for the lede.
- Harsh midday light that flattens the surface texture.

**Prompt skeleton.** `wide natural landscape photograph of a warm sand dune surface, low raking sun with long soft shadows, fine surface texture, ochre and clay palette, soft atmospheric haze in the distance, calm open region in the upper frame, no people`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep sand neutrals, the grotesque name and serif speaking voice. Terracotta carries actions; use hairline rules, small radii and wide editorial rhythm.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, and shape rules were composed for this theme; no third-party theme, stylesheet, palette, or asset is included, and it carries no external license obligation.

## Local typography

- Display: Syne; body: Manrope; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Pretendard" for display and body, "Gowun Batang" for serif ledes; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Place the image and text in a single column with the visual lead preserved; remove the desktop offset and keep readable text order. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile puts the logo first, keeps the two link columns side by side underneath, then shows a tighter photograph crop below the credit line. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `editorial-overlay` at `top`, with `88px` minimum height and `1160px` width (0px fills the available track). Use top navigation with a 1160px maximum width and 88px header height. At compact widths, use one vertical large-link list with close control. Stack links first; featured work and contact information follow.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [editorial-overlay](https://www.navbar.gallery/navbar/clonix). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `split-reverse`: copy share `36%`, media at `left` in a `4 / 5` frame, minimum height `740px`, title measure `11ch`, alignment `start` and desktop offset `64px`. Give most of the width to a tall left image and reserve a narrow right serif column; continue the generous margin into a photographic closing strip. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Place the image and text in a single column with the visual lead preserved; remove the desktop offset and keep readable text order.

Structural reference: [split-reverse](https://supahero.io/hero/treize-grammes). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `photo-strip` with `2` desktop groups and `600px` minimum height. Reserve 600px as the desktop minimum closing height with 2 information columns or groups. Separate a useful navigation band from an original local photo strip. Decorative shapes must not obscure or intercept links. Do not copy the person's portrait or brand assets.

Mobile puts the logo first, keeps the two link columns side by side underneath, then shows a tighter photograph crop below the credit line. Allow links to wrap and let the closing region grow with content.

Structural reference: [photo-strip](https://www.footer.design/sites/carolyn-lee). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.

## Surfaces

This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.

| Surface | File | Owns | Used by |
|---|---|---|---|
| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |
| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |
| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |

Content values are authored for a `--content-base` shorter side. Per artboard set `--content-short` to that frame's shorter side and `--content-scale: calc(var(--content-short) / var(--content-base))`, then size type as `max(12px, calc(var(--content-type-body) * var(--content-scale)))`. `--content-safe` is a fraction of the shorter side, so the safe inset is `calc(var(--content-short) * var(--content-safe))` on every edge.

## Slide deck

Reference adaptation: 127 - The RealReal Resale Report 2024 (pp. 1, 2, 3, 4, 6, 11, 16, 21). Layout only; retain this system's own colours, fonts and image direction.

1920 x 1080; use --slide-* geometry and type. Keep required content inside --slide-pad-edge; captions at least 24px. No website navigation, hover or scrolling inside a slide.

- Cover: Editorial portrait or product image fills the frame; a restrained title sits in the image's quiet region.

- Body: Fashion spread: full-height image in left 6/12 and concise editorial narrative in right 6/12; alternate the image side.

- Evidence: One isolated product at large scale with edge annotations, or two unequal images with a compact factual comparison below.

- Closing: Full-frame editorial image and one short takeaway. Crop around the subject; never put long copy over a face.

Sequence: cover > claim > evidence > implication > closing; repeat claim/evidence for longer decks, with a chapter after each topic. Do not repeat one body layout throughout. Use real supplied data and appropriate authored/generated images; capture actual app UI when demonstrating software. Split overflowing content instead of shrinking type.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (8% of the shorter side), place the primary figure at `--content-figure` (0.68) of the shorter side anchored left, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: sand neutrals at a wide editorial rhythm; terracotta carries one action or rule.
- Composition: a grotesque name with a serif speaking voice, hairline rules and wide margins. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (120px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (56px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: landscape and natural surface at scale, horizon-led and free of people.
- Never: cool or blue-dominant landscapes, dominant figures, harsh midday light.
