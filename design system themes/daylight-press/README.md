# Daylight Press Theme

Warm off-white paper, one buttercup accent, soft lowercase display, and fully rounded actions.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Layout

Use the existing 8-column body grid, 1080px content maximum, 62ch reading measure and 32px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | 1080px | Outer content width |
| `--layout-measure` | 62ch | Reading measure for body copy |
| `--layout-columns` | 8 | Base column count |
| `--layout-gutter` | 32px | Space between columns |
| `--layout-margin` | clamp(24px, 6vw, 72px) | Page side margin |
| `--layout-section-y` | clamp(72px, 10vw, 160px) | Vertical rhythm between sections |
| `--layout-rule` | 1px | Divider weight |
| `--layout-bp-md` / `--layout-bp-lg` | 768px / 1024px | Breakpoints |
| `--layout-hero` | 4 / 3 | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `mega-feature` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `96px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1280px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `framed-cover` | Opening composition |
| `--layout-hero-copy-ratio` | `70%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `16 / 9` | Opening media aspect ratio |
| `--layout-hero-media-position` | `below` | Opening media placement |
| `--layout-hero-min-height` | `640px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `20ch` | Maximum title line measure |
| `--layout-hero-align` | `center` | Hero copy alignment |
| `--layout-hero-offset` | `24px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `contact-ledger` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `440px` | Footer minimum height; content may grow |

## Composition

Navigation mega-feature → hero framed-cover (70% copy zone, below media, 16 / 9, 640px minimum) → retain the existing theme-specific body hierarchy → footer contact-ledger.

Use warm off-white paper, soft lowercase display type, buttercup only for action and active state, pill actions and warm hairline dividers. Keep the body approachable and printed. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Everyday life at close range — hands at work, a table, a walk, an ordinary object in use. Warm and unremarkable by design.

**Treatment.** Natural photography with warm colour, gentle contrast, and film-like softness. Nothing clinical, nothing dramatic.

**Light.** Soft diffused daylight, slightly overexposed toward the highlights so the frame sits comfortably on the warm paper.

**Framing.** For the website opening, place this theme's source art in the 16 / 9 frame at below specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Warm off-white, buttercup, straw and soft neutrals. Any strong colour in frame should be warm.

**Never:**
- Cool or blue-grey grading; it turns the paper grey.
- Hard shadows, heavy contrast, or dramatic light.
- Corporate or stock-looking staged scenes.
- Baked-in rounded corners or borders in the image file.

**Prompt skeleton.** `natural photograph of an everyday close-range moment, soft diffused daylight lifted toward the highlights, warm gentle contrast, film-like softness, relaxed composition, warm straw and off-white palette, no drama`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Use warm off-white paper, soft lowercase display type, buttercup only for action and active state, pill actions and warm hairline dividers. Keep the body approachable and printed.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, and shape rules were composed for this theme; no third-party theme, stylesheet, palette, or asset is included, and it carries no external license obligation.

## Local typography

- Display: Outfit; body: DM Sans; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Pretendard" for display and body, "Gowun Batang" for serif; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Retain an inset frame but reduce its padding; stack side cells below the dominant cover so the main image remains usable. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile keeps small brand/company metadata in two columns, expands the signup rule across the width, stacks contact addresses, and shifts the large wordmark to the bottom. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `mega-feature` at `top`, with `96px` minimum height and `1280px` width (0px fills the available track). Use top navigation with a 1280px maximum width and 96px header height. At compact widths, use brand plus close control and stacked product/service disclosures. Stack columns and move featured content below links.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [mega-feature](https://www.navbar.gallery/navbar/chesapeake-plywood). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `framed-cover`: copy share `70%`, media at `below` in a `16 / 9` frame, minimum height `640px`, title measure `20ch`, alignment `center` and desktop offset `24px`. Build a publication-style masthead above a bounded cover panel, then transition through a ruled compact contact colophon. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Retain an inset frame but reduce its padding; stack side cells below the dominant cover so the main image remains usable.

Structural reference: [framed-cover](https://supahero.io/hero/spectrum-life). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `contact-ledger` with `3` desktop groups and `440px` minimum height. Reserve 440px as the desktop minimum closing height with 3 information columns or groups. Use whitespace and a vertically organized address ledger rather than many equal navigation columns. Give contact details readable minimum type sizes.

Mobile keeps small brand/company metadata in two columns, expands the signup rule across the width, stacks contact addresses, and shifts the large wordmark to the bottom. Allow links to wrap and let the closing region grow with content.

Structural reference: [contact-ledger](https://www.footer.design/sites/esr). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.

## Surfaces

This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.

| Surface | File | Owns | Used by |
|---|---|---|---|
| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |
| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |
| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |

Content values are authored for a `--content-base` shorter side. Per artboard set `--content-short` to that frame's shorter side and `--content-scale: calc(var(--content-short) / var(--content-base))`, then size type as `max(12px, calc(var(--content-type-body) * var(--content-scale)))`. `--content-safe` is a fraction of the shorter side, so the safe inset is `calc(var(--content-short) * var(--content-safe))` on every edge.

## Slide deck

Reference adaptation: 085 - Ace & Tate Responsibility Report 2020 (pp. 1, 2, 3, 4, 13, 25, 37, 49). Layout only; retain this system's own colours, fonts and image direction.

1920 x 1080; use --slide-* geometry and type. Keep required content inside --slide-pad-edge; captions at least 24px. No website navigation, hover or scrolling inside a slide.

- Cover: Large editorial title crosses a soft organic brand-colour field, leaving a clear reading zone.

- Body: Organic chapter shape occupies left 6/12; concise narrative in right 6/12. Alternate large quotations and restrained report pages.

- Evidence: Place one impact number in a clear negative-space island, with explanations in a separate column; never distort a chart with decorative blobs.

- Closing: Repeat the organic field with one brief commitment and a quiet signature; preserve the theme's own type families.

Sequence: cover > claim > evidence > implication > closing; repeat claim/evidence for longer decks, with a chapter after each topic. Do not repeat one body layout throughout. Use real supplied data and appropriate authored/generated images; capture actual app UI when demonstrating software. Split overflowing content instead of shrinking type.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (7% of the shorter side), place the primary figure at `--content-figure` (0.51) of the shorter side anchored bottom, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: warm off-white paper; buttercup marks the action or the active state.
- Composition: warm hairline dividers and printed, approachable body copy. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (120px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (56px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: everyday life at close range, warm and deliberately unremarkable.
- Never: cool blue-grey grading, hard shadows, staged corporate scenes.
