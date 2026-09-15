# Quiet Runtime Theme

A soft warm-grey product ground with rounded surfaces and one violet action, tuned for interfaces that are looked at all day.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1180px content maximum, 60ch reading measure and 20px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1180px` | Outer content width |
| `--layout-measure` | `60ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `20px` | Space between columns |
| `--layout-margin` | `clamp(20px, 4vw, 56px)` | Page side margin |
| `--layout-section-y` | `clamp(48px, 6vw, 96px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `16 / 9` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `floating-island` | Website navigation arrangement |
| `--layout-nav-position` | `overlay` | Website navigation position |
| `--layout-nav-height` | `64px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `760px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `centered-form` | Opening composition |
| `--layout-hero-copy-ratio` | `52%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `1 / 1` | Opening media aspect ratio |
| `--layout-hero-media-position` | `background` | Opening media placement |
| `--layout-hero-min-height` | `600px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `22ch` | Maximum title line measure |
| `--layout-hero-align` | `center` | Hero copy alignment |
| `--layout-hero-offset` | `0px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `contact-ledger` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `400px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `side` | `top` or `side` — whether embedded-workspace navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `2` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `above` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |

Within the embedded work surface, navigation occupies two of the twelve columns as a side track at expanded widths and collapses to a top row below `--layout-bp-md`. Labels stack above their control so the form stays scannable in a narrow content track.

## Composition

Navigation floating-island → hero centered-form (52% copy zone, background media, 1 / 1, 600px minimum) → retain the existing theme-specific body hierarchy → footer contact-ledger.

Keep the warm grey ground, soft edged surfaces, humanist sans and one violet for actions. Semantic colours stay in their chips, and motion stays brief. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Interface fragments and soft abstract forms: a rounded panel, a stacked card edge, a gently curved surface. Objects are implied rather than photographed literally.

**Treatment.** Soft-focus 3D render or diffuse photography with matte materials. Rounded geometry, no sharp corners, no reflective surfaces. Gentle gradient across the form.

**Light.** Large diffuse source, wraparound, almost no visible shadow edge. Overcast-window quality.

**Framing.** For the website opening, place this theme's source art in the 1 / 1 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Warm greys matching the page ground, with a single muted violet passage echoing `--primary-blue`. Saturation stays low throughout.

**Never:**
- High-contrast or neon renders — this system's whole point is low arousal.
- Sharp geometric edges or hard specular highlights.
- Literal screenshots of other products.
- Busy compositions with many competing forms.

**Prompt skeleton.** `soft matte 3D render of rounded abstract interface surfaces, warm grey palette with one muted violet passage, large diffuse light, no hard shadows, low saturation, generous margin, calm composition`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the warm grey ground, soft edged surfaces, humanist sans and one violet for actions. Semantic colours stay in their chips, and motion stays brief.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Manrope; body: Manrope; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Keep a single central axis; stack paired actions when needed and reduce purely decorative accents before reducing text size. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile keeps small brand/company metadata in two columns, expands the signup rule across the width, stacks contact addresses, and shifts the large wordmark to the bottom. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `floating-island` at `overlay`, with `64px` minimum height and `760px` width (0px fills the available track). Use overlay navigation with a 760px maximum width and 64px header height. At compact widths, use an expanded dark vertical menu with brand and close control. Preserve compact header and expand links vertically.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [floating-island](https://www.navbar.gallery/navbar/supaste). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `centered-form`: copy share `52%`, media at `background` in a `1 / 1` frame, minimum height `600px`, title measure `22ch`, alignment `center` and desktop offset `0px`. Keep the central proposition small enough to breathe, with scattered original accents rather than a dense screenshot; close with a thin contact ledger. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Keep a single central axis; stack paired actions when needed and reduce purely decorative accents before reducing text size.

Structural reference: [centered-form](https://supahero.io/hero/uigraphic). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `contact-ledger` with `3` desktop groups and `400px` minimum height. Reserve 400px as the desktop minimum closing height with 3 information columns or groups. Use whitespace and a vertically organized address ledger rather than many equal navigation columns. Give contact details readable minimum type sizes.

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

Reference adaptation: 173 - IBM Cost of a Data Breach Report 2023 (pp. 1, 2, 3, 20, 40, 59). Layout only; retain this system's own colours, fonts and image direction.

1920 x 1080; use --slide-* geometry and type. Keep required content inside --slide-pad-edge; captions at least 24px. No website navigation, hover or scrolling inside a slide.

- Cover: Quiet title in left 6/12; one analytical line motif in right 6/12, with generous whitespace.

- Body: Research page: narrow finding column at left 3/12, one large chart at centre 6/12, methodology or comparison in right 3/12.

- Evidence: A single readable chart leads; direct labels, units, period and source below. Two charts only when they share a comparison question.

- Closing: A concise finding and a next-step column on a light ground. Printed footnotes become a dedicated appendix slide.

Sequence: cover > claim > evidence > implication > closing; repeat claim/evidence for longer decks, with a chapter after each topic. Do not repeat one body layout throughout. Use real supplied data and appropriate authored/generated images; capture actual app UI when demonstrating software. Split overflowing content instead of shrinking type.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (7% of the shorter side), place the primary figure at `--content-figure` (0.60) of the shorter side anchored center, and one deliberate full-bleed figure may cross the safe area because `--content-bleed` is `1`.

- Frame: the warm grey ground with soft edged surfaces; one violet marks the action; semantic colour stays inside its chips.
- Composition: a humanist voice at low arousal, brief motion, nothing shouting for attention. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (112px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (52px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: interface fragments and soft abstract forms, implied rather than photographed.
- Never: neon or high-contrast renders, sharp specular edges, literal screenshots of other products.
