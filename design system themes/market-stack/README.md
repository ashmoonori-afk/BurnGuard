# Market Stack Theme

A high-energy stacked shop: saturated ground, chunky grotesque pricing, and a sticky purchase panel that follows the scroll.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1240px content maximum, 56ch reading measure and 20px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1240px` | Outer content width |
| `--layout-measure` | `56ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `20px` | Space between columns |
| `--layout-margin` | `clamp(16px, 4vw, 48px)` | Page side margin |
| `--layout-section-y` | `clamp(40px, 5vw, 80px)` | Vertical rhythm between sections |
| `--layout-rule` | `2px` | Divider weight |
| `--layout-hero` | `1 / 1` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `mega-feature` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `112px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1400px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `portfolio-peek` | Opening composition |
| `--layout-hero-copy-ratio` | `38%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `1 / 1` | Opening media aspect ratio |
| `--layout-hero-media-position` | `background` | Opening media placement |
| `--layout-hero-min-height` | `640px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `17ch` | Maximum title line measure |
| `--layout-hero-align` | `center` | Hero copy alignment |
| `--layout-hero-offset` | `40px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `retail-accordion` | Footer arrangement |
| `--layout-footer-columns` | `4` | Desktop footer groups |
| `--layout-footer-height` | `560px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-commerce-gallery-layout` | `stacked` | `stacked`, `paired`, or `lead-and-pairs` — the repeating placement pattern of a product gallery. |
| `--family-commerce-purchase-position` | `sticky` | `flow` or `sticky` — whether the purchase panel scrolls with content or pins inside its section. |

A stacked gallery keeps one product in view at a time at full attention. The purchase panel sticks within its section so price and action stay reachable through a long scroll, dropping back to flow below `--layout-bp-md`.

## Composition

Navigation mega-feature → hero portfolio-peek (38% copy zone, background media, 1 / 1, 640px minimum) → retain the existing theme-specific body hierarchy → footer retail-accordion.

Keep the bright ground, soft large shapes, square product plates and prices as headlines. Orange carries action, blue links and focus, and yellow badge fills only. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** One product, straight on, filling its square frame. Everyday desirable goods rather than luxury objects — food, tools, homeware, apparel shot cheerfully.

**Treatment.** Bright saturated product photography with clean edges and a coloured or warm-white backdrop. Punchy but true colour; the image should feel energetic rather than precious.

**Light.** Even and bright with a soft shadow under the object. High key overall; no deep shadows anywhere in frame.

**Framing.** For the website opening, place this theme's source art in the 1 / 1 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Warm white or a single flat saturated backdrop drawn from the accent set. One product colour plus the backdrop; avoid multi-colour clutter.

**Never:**
- Dark, moody, or low-key treatments — they kill the system's energy.
- Inconsistent crops within body product stacks; the website opening uses its separate Hero ratio.
- Busy scenes with multiple products fighting for attention.
- Muted or desaturated grading.

**Prompt skeleton.** `bright product photograph, single everyday object centred and filling a square 1:1 frame, flat warm-white or saturated backdrop, even high-key lighting with a soft contact shadow, punchy true colour, small consistent margin, no clutter`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the bright ground, soft large shapes, square product plates and prices as headlines. Orange carries action, blue links and focus, and yellow badge fills only.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Outfit; body: Plus Jakarta Sans; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Convert scattered or overlapping panels into a deliberate ordered list; preserve one dominant work and smaller supporting items. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile replaces the three link columns with three ruled rows showing plus disclosure marks; locale/legal is centered beneath, above the cropped wordmark. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `mega-feature` at `top`, with `112px` minimum height and `1400px` width (0px fills the available track). Use top navigation with a 1400px maximum width and 112px header height. At compact widths, use brand plus close control and stacked product/service disclosures. Stack columns and move featured content below links.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [mega-feature](https://www.navbar.gallery/navbar/chesapeake-plywood). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `portfolio-peek`: copy share `38%`, media at `background` in a `1 / 1` frame, minimum height `640px`, title measure `17ch`, alignment `center` and desktop offset `40px`. Make the invitation a small center while original product figures form an asymmetric orbit; the retail directory must remain a distinct lower band. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Convert scattered or overlapping panels into a deliberate ordered list; preserve one dominant work and smaller supporting items.

Structural reference: [portfolio-peek](https://supahero.io/hero/superpower). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `retail-accordion` with `4` desktop groups and `560px` minimum height. Reserve 560px as the desktop minimum closing height with 4 information columns or groups. Use native details/summary for the narrow-screen navigation groups if disclosure is needed. The desktop gallery screenshot does not establish a working subscription form, so provide one only when backed by a real flow.

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

Reference adaptation: 172 - Zip Brand Guidelines (pp. 1, 2, 3, 4, 5, 9, 13, 17). Layout only; retain this system's own colours, fonts and image direction.

1920 x 1080; use --slide-* geometry and type. Keep required content inside --slide-pad-edge; captions at least 24px. No website navigation, hover or scrolling inside a slide.

- Cover: Large title in left 8/12, opposite brand-ground panel in right 4/12 with a gently slanted boundary.

- Body: Merchant specimen: short explanation in left third and an isolated product or checkout example in the remaining two thirds.

- Evidence: Compare actual product applications in a vertical specimen stack; maintain common scale and labels, not decorative dashboards.

- Closing: Two unequal brand-colour planes with one clear action on the larger plane; alternate title, human image and specimen frames.

Sequence: cover > claim > evidence > implication > closing; repeat claim/evidence for longer decks, with a chapter after each topic. Do not repeat one body layout throughout. Use real supplied data and appropriate authored/generated images; capture actual app UI when demonstrating software. Split overflowing content instead of shrinking type.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (8% of the shorter side), place the primary figure at `--content-figure` (0.67) of the shorter side anchored center, and one deliberate full-bleed figure may cross the safe area because `--content-bleed` is `1`.

- Frame: the bright ground with soft large shapes; orange carries the action, blue the link, yellow only a badge fill.
- Composition: square plates and prices as headlines, with crops consistent across the set. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (116px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (52px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: one product straight on filling its square frame: cheerful everyday goods.
- Never: dark moody treatments, inconsistent crops within a set, multi-product scenes.
