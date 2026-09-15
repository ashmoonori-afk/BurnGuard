# Graphite Spec Theme

A graphite engineering ground where mono sets the body, figures are numbered, and one amber marks the value that matters.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1400px content maximum, 72ch reading measure and 16px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1400px` | Outer content width |
| `--layout-measure` | `72ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `16px` | Space between columns |
| `--layout-margin` | `clamp(16px, 2.5vw, 40px)` | Page side margin |
| `--layout-section-y` | `clamp(36px, 4vw, 64px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `2 / 1` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `segmented-pill` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `72px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1280px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `specimen-poster` | Opening composition |
| `--layout-hero-copy-ratio` | `34%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `5 / 4` | Opening media aspect ratio |
| `--layout-hero-media-position` | `background` | Opening media placement |
| `--layout-hero-min-height` | `760px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `12ch` | Maximum title line measure |
| `--layout-hero-align` | `end` | Hero copy alignment |
| `--layout-hero-offset` | `56px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `studio-address` | Footer arrangement |
| `--layout-footer-columns` | `4` | Desktop footer groups |
| `--layout-footer-height` | `540px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `top` | `top` or `side` — whether embedded-workspace navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `2` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |

Within the embedded work surface, navigation is a compact top row at 44px with a rule beneath. Labels sit beside their control, matching the document's two-track annotation structure so a form reads like a spec table.

## Composition

Navigation segmented-pill → hero specimen-poster (34% copy zone, background media, 5 / 4, 760px minimum) → retain the existing theme-specific body hierarchy → footer studio-address.

Keep a measured mono body, numbered figures, margin annotations and first-class tables. Amber marks the discussed value; graphite, bone, zero radius and rules do the rest. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Technical drawing and measured artifacts: an exploded view, a section drawing, a dimensioned component, a calibration surface. Line work rather than photography wherever possible.

**Treatment.** Flat vector line drawing on the graphite ground, hairline weight, no fills except where a part must be distinguished. Where photography is required, make it a flat frontal record shot with no styling.

**Light.** Not applicable to line work. For record photography, flat even illumination with no modelling — the goal is legibility of form, not atmosphere.

**Framing.** For the website opening, place this theme's source art in the 5 / 4 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Bone line work on graphite, with amber reserved for the single dimension or part being called out.

**Never:**
- Perspective renders, dramatic angles, or atmospheric lighting.
- Colour fills beyond the single amber callout.
- Decorative iconography standing in for a real diagram.
- Soft shadows or any suggestion of depth.

**Prompt skeleton.** `flat orthographic technical line drawing of a mechanical component, hairline bone-white strokes on dark graphite background, dimension lines and leader labels, one amber highlighted dimension, no shading, no perspective`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep a measured mono body, numbered figures, margin annotations and first-class tables. Amber marks the discussed value; graphite, bone, zero radius and rules do the rest.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: IBM Plex Mono; body: IBM Plex Mono; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for UI text; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Put useful labels in a normal-flow caption block below the complete specimen; decorative title size must not cause horizontal scroll. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile stacks the link groups, keeps the two office addresses side by side, and moves the large wordmark below them. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `segmented-pill` at `top`, with `72px` minimum height and `1280px` width (0px fills the available track). Use top navigation with a 1280px maximum width and 72px header height. Mobile screenshot has product CTA and close above large stacked product/ecosystem/company rows. Keep grouping and use stacked drill-down rows.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [segmented-pill](https://www.navbar.gallery/navbar/consensys). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `specimen-poster`: copy share `34%`, media at `background` in a `5 / 4` frame, minimum height `760px`, title measure `12ch`, alignment `end` and desktop offset `56px`. Present one complete specimen against a broad neutral field with a small inset detail and separated metadata; retain disciplined technical labeling. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Put useful labels in a normal-flow caption block below the complete specimen; decorative title size must not cause horizontal scroll.

Structural reference: [specimen-poster](https://supahero.io/hero/haptikos). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `studio-address` with `4` desktop groups and `540px` minimum height. Reserve 540px as the desktop minimum closing height with 4 information columns or groups. Use an asymmetrical studio directory whose location pair is a first-class structural feature. Do not collapse the whole footer to a generic four-column sitemap.

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

Slides are fixed 1920 x 1080 CSS px artboards at 16 / 9, not pages: no navigation bar, no footer, no reading measure, no breakpoint, no hover. Nothing required sits outside `--slide-pad-edge` (88px), and `--slide-type-caption` (24px) is the smallest type on any slide.

- Ground: graphite and bone at zero radius; amber marks the value under discussion.
- Cover: a measured specimen with the title set against the field edge.
- Structure: a measured mono body, numbered figures, margin annotation and first-class tables. One takeaway per slide, titled at `--slide-type-heading` (52px) with support at `--slide-type-body` (32px).
- Imagery: technical drawing and measured artifacts; line work rather than photography. At most one image per slide unless the request asks for a grid.
- Never: perspective renders, colour beyond the amber callout, soft shadows.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (8% of the shorter side), place the primary figure at `--content-figure` (0.69) of the shorter side anchored center, and one deliberate full-bleed figure may cross the safe area because `--content-bleed` is `1`.

- Frame: graphite and bone at zero radius; amber marks the value under discussion.
- Composition: a measured mono body, numbered figures, margin annotation and first-class tables. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (120px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (56px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: technical drawing and measured artifacts; line work rather than photography.
- Never: perspective renders, colour beyond the amber callout, soft shadows.
