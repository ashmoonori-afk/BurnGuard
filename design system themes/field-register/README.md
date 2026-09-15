# Field Register Theme

A record-entry system: paper-like ground, two-track label-and-field rows, and validation states that read without colour alone.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1200px content maximum, 68ch reading measure and 16px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1200px` | Outer content width |
| `--layout-measure` | `68ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `16px` | Space between columns |
| `--layout-margin` | `clamp(16px, 3vw, 32px)` | Page side margin |
| `--layout-section-y` | `clamp(24px, 3vw, 48px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `5 / 1` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `enterprise-columns` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `112px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1400px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `split-left` | Opening composition |
| `--layout-hero-copy-ratio` | `40%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `1 / 1` | Opening media aspect ratio |
| `--layout-hero-media-position` | `right` | Opening media placement |
| `--layout-hero-min-height` | `600px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `18ch` | Maximum title line measure |
| `--layout-hero-align` | `start` | Hero copy alignment |
| `--layout-hero-offset` | `0px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `ruled-community` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `460px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `side` | `top` or `side` — whether embedded-workspace navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `3` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |
| `--family-data-table-layout` | `fixed` | `auto` or `fixed` — the width-allocation algorithm for full-width data tables. |

A three-column rail carries section progress through a long record, so the operator always knows what remains. Labels sit beside their fields in a fixed track, which keeps a long form scannable as a list of answered and unanswered questions. Fixed table layout applies to the review tables that summarise a completed record.

## Composition

Navigation enterprise-columns → hero split-left (40% copy zone, right media, 1 / 1, 600px minimum) → retain the existing theme-specific body hierarchy → footer ruled-community.

Keep the warm paper ground, white fields, label/value rows and explicit required and validation text. Teal is for focus or action; retain the stationery character. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Documentary reference attached to a record — a site photograph, a scanned form, a condition shot. Evidence, not illustration.

**Treatment.** Plain documentary capture with no styling or grading. It should look like it was taken to prove something, because that is its role in the record.

**Light.** Available light, even and honest. Correct exposure matters; atmosphere does not.

**Framing.** For the website opening, place this theme's source art in the 1 / 1 frame at right specified by Hero; keep its subject, medium, light and grading. Keep the complete subject visible with contain or an inner figure; do not crop evidence, objects or architecture to fill the outer region. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Muted and natural, with the warm paper ground surrounding it. Nothing saturated enough to compete with the validation colours.

**Never:**
- Stylised, graded, or staged photography — it undermines the evidentiary role.
- Evidence without a containing hairline frame; the outer Hero region may expand while the record itself remains bounded.
- Saturated colour that could be mistaken for a validation state.
- Decorative stock imagery with no relationship to the record.

**Prompt skeleton.** `plain documentary photograph as record evidence, available even light, correct honest exposure, muted natural colour, contained framing with clear subject, no styling, no grading, no staging`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the warm paper ground, white fields, label/value rows and explicit required and validation text. Teal is for focus or action; retain the stationery character.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: IBM Plex Sans KR; body: IBM Plex Sans KR; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "IBM Plex Sans KR" natively, then "Pretendard"; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Stack the copy above the image; retain a visible text/image boundary and allow actions to wrap. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile stacks logo, actions and legal information into ruled horizontal sections; the decorative band remains at the bottom. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `enterprise-columns` at `top`, with `112px` minimum height and `1400px` width (0px fills the available track). Use top navigation with a 1400px maximum width and 112px header height. At compact widths, use category rows with chevrons under a compact brand/close bar. Collapse taxonomy columns into grouped disclosures.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [enterprise-columns](https://www.navbar.gallery/navbar/cloudflare). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `split-left`: copy share `40%`, media at `right` in a `1 / 1` frame, minimum height `600px`, title measure `18ch`, alignment `start` and desktop offset `0px`. Balance a short left statement against one strong right specimen, separated by open space; reinforce field-note order with a ruled closing directory. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Stack the copy above the image; retain a visible text/image boundary and allow actions to wrap.

Structural reference: [split-left](https://supahero.io/hero/dialweb). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `ruled-community` with `3` desktop groups and `460px` minimum height. Reserve 460px as the desktop minimum closing height with 3 information columns or groups. Use a three-part community directory with a separate decorative baseline. Preserve real semantic links and a clear primary join action; use original local artwork.

Mobile stacks logo, actions and legal information into ruled horizontal sections; the decorative band remains at the bottom. Allow links to wrap and let the closing region grow with content.

Structural reference: [ruled-community](https://www.footer.design/sites/harvest-hall). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.

## Surfaces

This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.

| Surface | File | Owns | Used by |
|---|---|---|---|
| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |
| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |
| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |

Content values are authored for a `--content-base` shorter side. Per artboard set `--content-short` to that frame's shorter side and `--content-scale: calc(var(--content-short) / var(--content-base))`, then size type as `max(12px, calc(var(--content-type-body) * var(--content-scale)))`. `--content-safe` is a fraction of the shorter side, so the safe inset is `calc(var(--content-short) * var(--content-safe))` on every edge.

## Slide deck

Reference adaptation: 181 - FREITAG Impact Report 2023 (pp. 1, 2, 4, 25, 49, 73). Layout only; retain this system's own colours, fonts and image direction.

1920 x 1080; use --slide-* geometry and type. Keep required content inside --slide-pad-edge; captions at least 24px. No website navigation, hover or scrolling inside a slide.

- Cover: Visible construction grid with a two-line title crossing its central cells; one flat brand-accent ground.

- Body: Ruled report sheet: a full-width title rail above unequal text, photograph and annotation cells. Keep grid lines continuous.

- Evidence: Process photograph spans 8/12; left 4/12 carries the claim and a small data table; one accent note aligns to a grid intersection.

- Closing: An open construction grid with one action cell. Split dense printed report pages into several slides, never miniaturise them.

Sequence: cover > claim > evidence > implication > closing; repeat claim/evidence for longer decks, with a chapter after each topic. Do not repeat one body layout throughout. Use real supplied data and appropriate authored/generated images; capture actual app UI when demonstrating software. Split overflowing content instead of shrinking type.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (7% of the shorter side), place the primary figure at `--content-figure` (0.66) of the shorter side anchored right, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: the warm paper ground with white fields; teal is for focus or action.
- Composition: label/value rows with explicit required and validation text, keeping the stationery character. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (116px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (52px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: documentary evidence inside a containing hairline frame.
- Never: stylised or graded photography, evidence without its frame, saturated colour fills.
