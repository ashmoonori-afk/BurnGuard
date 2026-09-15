# Press Riso Theme

A print-shop system: cream stock, flat spot colours, a condensed poster voice, and blocks set slightly off-square as if run through a press.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1200px content maximum, 54ch reading measure and 20px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1200px` | Outer content width |
| `--layout-measure` | `54ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `20px` | Space between columns |
| `--layout-margin` | `clamp(16px, 4vw, 40px)` | Page side margin |
| `--layout-section-y` | `clamp(48px, 6vw, 96px)` | Vertical rhythm between sections |
| `--layout-rule` | `2px` | Divider weight |
| `--layout-hero` | `3 / 4` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `icon-taxonomy` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `88px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1160px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `portfolio-peek` | Opening composition |
| `--layout-hero-copy-ratio` | `48%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `1 / 1` | Opening media aspect ratio |
| `--layout-hero-media-position` | `background` | Opening media placement |
| `--layout-hero-min-height` | `660px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `12ch` | Maximum title line measure |
| `--layout-hero-align` | `start` | Hero copy alignment |
| `--layout-hero-offset` | `36px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `window-stage` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `580px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-creative-type-rotation` | `-3deg` | Rotation applied to a designated display composition about its own centre. |
| `--family-creative-line-step` | `0px` | Successive display lines shift by `n x step` along the inline axis, starting at line zero. |
| `--family-creative-type-image-overlap` | `40%` | How far a display block translates over preceding imagery, as a share of its own block-size. |

The designated display composition is rotated three degrees off square — the misregistration of a hand-fed press, applied deliberately and only once per page. It also translates over the preceding image by 40% of its own height, so the rotated block and the print visibly overlap the way two runs of ink would.

## Composition

Navigation icon-taxonomy → hero portfolio-peek (48% copy zone, background media, 1 / 1, 660px minimum) → retain the existing theme-specific body hierarchy → footer window-stage.

Keep cream stock and flat vermilion, ultramarine and sun-yellow roles. Condensed large type, one three-degree display rotation, 2px rules and square corners retain the printed character. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A graphic print rather than a photograph: a bold illustrated figure, a symbol, a hand-drawn object, or a heavily abstracted photographic subject reduced to shapes.

**Treatment.** Two- or three-colour risograph print on cream uncoated stock. Visible halftone dot, slight ink misregistration between layers, uneven ink density, paper texture showing through the lighter areas.

**Light.** Not applicable as photographic light — the image is printed. Value comes from halftone density alone, so tonal range is short and stepped rather than smooth.

**Framing.** For the website opening, place this theme's source art in the 1 / 1 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Cream paper plus at most three flat inks — a vermilion, an ultramarine, and a sun yellow — overprinting to make secondary tones. No fourth colour, no black-and-white photography.

**Never:**
- Smooth photographic gradients or realistic lighting.
- Perfect registration; a small offset between ink layers is required.
- More than three inks, or muted desaturated inks.
- Glossy, digital, or 3D-rendered finishes.

**Prompt skeleton.** `three-colour risograph print on cream uncoated paper, bold graphic illustrated subject, visible halftone dot texture, slight ink misregistration between layers, uneven ink density, paper grain showing through, vermilion and ultramarine and yellow inks overprinting, portrait 3:4, unprinted cream margin`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep cream stock and flat vermilion, ultramarine and sun-yellow roles. Condensed large type, one three-degree display rotation, 2px rules and square corners retain the printed character.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Anton; body: DM Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Convert scattered or overlapping panels into a deliberate ordered list; preserve one dominant work and smaller supporting items. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile centers the title and one visible link window in a vertical stack, retaining the ticker and three equal bottom glyph cells. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `icon-taxonomy` at `top`, with `88px` minimum height and `1160px` width (0px fills the available track). Use top navigation with a 1160px maximum width and 88px header height. At compact widths, use product/use-case/enterprise disclosure rows. Use single-column disclosures; keep the promotional card secondary.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [icon-taxonomy](https://www.navbar.gallery/navbar/velt). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `portfolio-peek`: copy share `48%`, media at `background` in a `1 / 1` frame, minimum height `660px`, title measure `12ch`, alignment `start` and desktop offset `36px`. Use a sparse constellation of original work tiles around a dominant plane, retaining only the theme's existing single minus-three-degree display tilt. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Convert scattered or overlapping panels into a deliberate ordered list; preserve one dominant work and smaller supporting items.

Structural reference: [portfolio-peek](https://supahero.io/hero/bychudy). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `window-stage` with `3` desktop groups and `580px` minimum height. Reserve 580px as the desktop minimum closing height with 3 information columns or groups. Build the footer as title stage, compact link panels, then a three-cell brand band. Keep panels in normal document flow on narrow screens; animation is optional.

Mobile centers the title and one visible link window in a vertical stack, retaining the ticker and three equal bottom glyph cells. Allow links to wrap and let the closing region grow with content.

Structural reference: [window-stage](https://www.footer.design/sites/the-design-society). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.

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

- Ground: cream stock with flat riso inks; vermilion, ultramarine and sun-yellow hold fixed roles.
- Cover: condensed large type with one three-degree rotation.
- Structure: 2px rules and square corners, at most three inks on a frame. One takeaway per slide, titled at `--slide-type-heading` (52px) with support at `--slide-type-body` (32px).
- Imagery: a graphic print rather than a photograph, with a small deliberate ink misregistration. At most one image per slide unless the request asks for a grid.
- Never: smooth photographic gradients, perfect registration, glossy or 3D finishes.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (7% of the shorter side), place the primary figure at `--content-figure` (0.62) of the shorter side anchored center, and one deliberate full-bleed figure may cross the safe area because `--content-bleed` is `1`.

- Frame: cream stock with flat riso inks; vermilion, ultramarine and sun-yellow hold fixed roles.
- Composition: 2px rules and square corners, at most three inks on a frame. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (124px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (56px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: a graphic print rather than a photograph, with a small deliberate ink misregistration.
- Never: smooth photographic gradients, perfect registration, glossy or 3D finishes.
