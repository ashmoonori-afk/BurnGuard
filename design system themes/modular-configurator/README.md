# Modular Configurator Theme

A precision modular-system and ergonomic furniture configurator: high-key gallery paper, anodized graphite framing, orthographic dimension ladders, finish swatch matrices, and sticky specification rails.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1440px content maximum, 58ch reading measure and 16px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1440px` | Outer content width |
| `--layout-measure` | `58ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `16px` | Space between columns |
| `--layout-margin` | `clamp(20px, 3vw, 48px)` | Page side margin |
| `--layout-section-y` | `clamp(48px, 6vw, 96px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `16 / 10` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `enterprise-columns` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `84px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1360px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `product-panel` | Opening composition |
| `--layout-hero-copy-ratio` | `46%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `16 / 10` | Opening media aspect ratio |
| `--layout-hero-media-position` | `below` | Opening media placement |
| `--layout-hero-min-height` | `640px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `16ch` | Maximum title line measure |
| `--layout-hero-align` | `start` | Hero copy alignment |
| `--layout-hero-offset` | `24px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `contact-ledger` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `480px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `contain` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-commerce-gallery-layout` | `lead-and-pairs` | `stacked`, `paired`, or `lead-and-pairs` — the repeating placement pattern of a product gallery. |
| `--family-commerce-purchase-position` | `sticky` | `flow` or `sticky` — whether the purchase panel scrolls with content or pins inside its section. |

The gallery opens with one wide system elevation and continues in paired detail views (joint close-up, bay configuration, surface load, wall-mounting guide). Images stay contained so modular bays, ball joints and dimension callouts are never cropped. On detail pages, the right-hand configuration rail pins while the user steps through bay width, height ladder, finish swatches, ergonomic size class (A / B / C), and mounting surface assessment.

## Composition

Navigation enterprise-columns → hero product-panel (46% copy zone, below media, 16 / 10, 640px minimum) → retain the existing theme-specific body hierarchy → footer contact-ledger.

Structure product detail pages around system adaptability: open with designer credit and longevity claim, present a live configuration matrix (module bay dimensions, finish swatches with exact colour codes, surface/wall compatibility checklist), follow with an orthographic dimension diagram and tabular spec sheet, and close with planner consultation or direct modular checkout. Keep 1px hairline borders, tabular mono dimensions and zero elevation.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A modular shelving, storage, or ergonomic seating system photographed straight-on in an architectural gallery space, or an orthographic assembly elevation showing tubes, joints, and panels.

**Treatment.** High-key architectural product photography on a cool gallery-white ground matching `--bg`. Crisp chrome, powder-coated steel, and anodized aluminum edges with zero motion blur or atmospheric haze.

**Light.** Cool north-light studio illumination: even across the full bay width with clean specular highlights along structural joints and a soft floor contact shadow.

**Framing.** For the website opening, place this theme's source art in the 16 / 10 frame at below specified by Hero; keep its subject, medium, light and grading. Keep the complete subject visible with contain or an inner figure; do not crop evidence, objects or architecture to fill the outer region. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Gallery paper and graphite structure with one cobalt-chrome or powder-coated primary accent panel echoing `--primary-blue`.

**Never:**
- Warm lifestyle clutter, scattered domestic props, or people posing on furniture.
- Tilted Dutch angles or wide-angle lens distortion that bends vertical upright tubes.
- Heavy drop shadows, dark moody vignetting, or unlabelled decorative renders.
- Visible third-party logos or watermarks.

**Prompt skeleton.** `orthographic front elevation photograph of a modular chrome-and-steel shelving system in a plain white gallery room, crisp ball joints and powder-coated cobalt and graphite panels, cool even north daylight, clean floor shadow, 16:10, no props, no people`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Structure detail pages with a lead system view, paired joint/finish macro plates, a sticky configuration rail (dimensions, finish swatches, ergonomic sizes, wall-mount guide), and a tabular specification sheet.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Space Grotesk; body: Public Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Keep title, actions and interface panel in document order; allow the panel to scale proportionally rather than forcing desktop width. Release the sticky configuration rail into normal document flow below the lead gallery plate, and keep dimension tables inside a horizontal scroll wrapper. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile keeps small brand/company metadata in two columns, expands the signup rule across the width, stacks contact addresses, and shifts the large wordmark to the bottom. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `enterprise-columns` at `top`, with `84px` minimum height and `1360px` width (0px fills the available track). Use top navigation with a 1360px maximum width and 84px header height, pairing a utility specification strip above system family links (Systems, Tables, Panels, Ergonomics, Planner). At compact widths, collapse groups into semantic native disclosures.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

## Hero

Use `product-panel`: copy share `46%`, media at `below` in a `16 / 10` frame, minimum height `640px`, title measure `16ch`, alignment `start` and desktop offset `24px`. Open with a system longevity claim and quicklinks (3D Configurator, Materials, Dimensions, Wall Guide) above a full-width contained system panel with live bay/dimension status readouts.

Mobile: Below the theme's existing compact breakpoint: Keep title, actions and interface panel in document order; allow the panel to scale proportionally rather than forcing desktop width.

## Footer

Use `contact-ledger` with `3` desktop groups and `480px` minimum height. Reserve 480px as the desktop minimum closing height with 3 information columns or groups (System families, Technical downloads & CAD sheets, Showroom & Planner ledger). Give contact details and specification download links readable minimum type sizes.

Mobile keeps small brand/company metadata in two columns, expands the signup rule across the width, stacks contact addresses, and shifts the large wordmark to the bottom. Allow links to wrap and let the closing region grow with content.

## Surfaces

This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.

| Surface | File | Owns | Used by |
|---|---|---|---|
| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |
| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |
| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |

Content values are authored for a `--content-base` shorter side. Per artboard set `--content-short` to that frame's shorter side and `--content-scale: calc(var(--content-short) / var(--content-base))`, then size type as `max(12px, calc(var(--content-type-body) * var(--content-scale)))`. `--content-safe` is a fraction of the shorter side, so the safe inset is `calc(var(--content-short) * var(--content-safe))` on every edge.

## Slide deck

Slide composition: layout only; retain this system's own colours, fonts and image direction.

1920 x 1080; use --slide-* geometry and type. Keep required content inside --slide-pad-edge; captions at least 24px. No website navigation, hover or scrolling inside a slide.

- Cover: Huge two-line title in upper-left 9/12; thin rules divide a shallow lower specimen strip and a narrow image column.

- Body: Manual spread: label and short instructions occupy left 3/12, one large specimen occupies right 9/12. Use continuous fine rules, no rounded card grid.

- Evidence: Show colour as differently sized circular swatches, type as one oversized specimen plus a baseline strip, images as a deliberate contact sheet.

- Closing: Sparse ruled frame with the next action at upper left. Carry the same indexed rail-and-specimen hierarchy into the system overview.

Sequence: cover > claim > evidence > implication > closing; repeat claim/evidence for longer decks, with a chapter after each topic. Do not repeat one body layout throughout. Use real supplied data and appropriate authored/generated images; capture actual app UI when demonstrating software. Split overflowing content instead of shrinking type.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (7% of the shorter side), place the primary figure at `--content-figure` (0.63) of the shorter side anchored bottom, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: gallery-white paper with anodized graphite framing and 1px rules; cobalt-chrome marks the selected bay, swatch, or configuration action.
- Composition: contained bay elevations, finish swatch matrices, and tabular dimension ladders. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (116px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (56px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: a modular shelving or ergonomic furniture system photographed straight on in a gallery.
- Never: domestic clutter, wide-angle distortion, cropping into structural bays or dimension lines.
