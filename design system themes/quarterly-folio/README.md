# Quarterly Folio Theme

A quarterly-journal system with a warm bone page, a high-contrast didone display, and rules that behave like printed folio marks.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1080px content maximum, 64ch reading measure and 32px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1080px` | Outer content width |
| `--layout-measure` | `64ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `32px` | Space between columns |
| `--layout-margin` | `clamp(24px, 6vw, 96px)` | Page side margin |
| `--layout-section-y` | `clamp(72px, 9vw, 152px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `5 / 4` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `mega-feature` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `104px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1220px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `filmstrip` | Opening composition |
| `--layout-hero-copy-ratio` | `68%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `4 / 5` | Opening media aspect ratio |
| `--layout-hero-media-position` | `below` | Opening media placement |
| `--layout-hero-min-height` | `620px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `20ch` | Maximum title line measure |
| `--layout-hero-align` | `center` | Hero copy alignment |
| `--layout-hero-offset` | `20px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `photo-strip` | Footer arrangement |
| `--layout-footer-columns` | `2` | Desktop footer groups |
| `--layout-footer-height` | `480px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `contain` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `1 / 1` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-editorial-paragraph-mode` | `indented` | `spaced` (a `--sp-4` gap, no indent) or `indented` (1em first line, no gap, not after a heading). |

Media and text take equal tracks when paired, so neither dominates and the spread reads as a balanced opening. Images are contained. Paragraphs are indented with no gap, which is what lets long prose read as a single continuous body.

## Composition

Navigation mega-feature → hero filmstrip (68% copy zone, below media, 4 / 5, 620px minimum) → retain the existing theme-specific body hierarchy → footer photo-strip.

Keep letterspaced eyebrows, didone openings and warm serif body text with indents. Deep green stays sparse; wide margins and hairline rules make the folio feel bound. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Still life and considered arrangement: objects on a surface, a detail of a material, a composed grouping. Quiet subjects that reward a long look.

**Treatment.** Large-format-feeling photography with fine tonal gradation and a slightly warm cast that sits on bone paper. Matte finish, no digital sharpening halo.

**Light.** Soft directional daylight with a long gentle falloff, as from a tall window. Shadows are present but soft-edged and warm rather than neutral.

**Framing.** For the website opening, place this theme's source art in the 4 / 5 frame at below specified by Hero; keep its subject, medium, light and grading. Keep the complete subject visible with contain or an inner figure; do not crop evidence, objects or architecture to fill the outer region. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Warm neutrals — bone, clay, oat, faded olive — with at most one deeper note. The image should look at home on the bone page rather than pasted onto it.

**Never:**
- Cool or blue-cast images; they will fight the warm paper.
- Cropping documentary content to fill an opening frame; use a contained inner figure and retain the page margins in the reading body.
- High-energy or motion-blurred subjects.
- Any drop shadow or frame added to the image.

**Prompt skeleton.** `large format still life photograph, objects arranged on a warm neutral surface, soft directional window light with long gentle falloff, bone and clay palette, fine tonal gradation, matte finish, centred calm composition`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep letterspaced eyebrows, didone openings and warm serif body text with indents. Deep green stays sparse; wide margins and hairline rules make the folio feel bound.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Bodoni Moda; body: Lora; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif text, "Pretendard" for eyebrows; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Keep a clearly grouped strip; use a finite two-column or single-column selection instead of body-level horizontal overflow. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile puts the logo first, keeps the two link columns side by side underneath, then shows a tighter photograph crop below the credit line. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `mega-feature` at `top`, with `104px` minimum height and `1220px` width (0px fills the available track). Use top navigation with a 1220px maximum width and 104px header height. At compact widths, use brand plus close control and stacked product/service disclosures. Stack columns and move featured content below links.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [mega-feature](https://www.navbar.gallery/navbar/chesapeake-plywood). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `filmstrip`: copy share `68%`, media at `below` in a `4 / 5` frame, minimum height `620px`, title measure `20ch`, alignment `center` and desktop offset `20px`. Keep portrait or document cards as whole visible figures in a horizontal editorial strip beneath the centered introduction; preserve publication margins. Retain object-fit: contain for the original artwork: the whole building, document or object must remain visible. Interpret oversized/cropped reference geometry through the frame and typography, not by clipping the artwork.

Mobile: Below the theme's existing compact breakpoint: Keep a clearly grouped strip; use a finite two-column or single-column selection instead of body-level horizontal overflow.

Structural reference: [filmstrip](https://supahero.io/hero/dribbble). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `photo-strip` with `2` desktop groups and `480px` minimum height. Reserve 480px as the desktop minimum closing height with 2 information columns or groups. Separate a useful navigation band from an original local photo strip. Decorative shapes must not obscure or intercept links. Do not copy the person's portrait or brand assets.

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

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (7% of the shorter side), place the primary figure at `--content-figure` (0.52) of the shorter side anchored bottom, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: warm bound paper with wide margins; deep green stays sparse.
- Composition: letterspaced eyebrows, a warm serif body with indents, hairline rules. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (120px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (56px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: still life and considered arrangement; quiet subjects that reward a long look.
- Never: cool blue-cast images, high-energy motion, margins filled to the edge.
