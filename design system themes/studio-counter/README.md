# Studio Counter Theme

A near-black studio where product photography is the page and the buying chrome is deliberately the smallest type on it.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1600px content maximum, 52ch reading measure and 8px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1600px` | Outer content width |
| `--layout-measure` | `52ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `8px` | Space between columns |
| `--layout-margin` | `12px` | Page side margin |
| `--layout-section-y` | `clamp(32px, 4vw, 64px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `4 / 5` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `icon-taxonomy` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `80px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1180px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `framed-cover` | Opening composition |
| `--layout-hero-copy-ratio` | `66%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `4 / 3` | Opening media aspect ratio |
| `--layout-hero-media-position` | `background` | Opening media placement |
| `--layout-hero-min-height` | `660px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `12ch` | Maximum title line measure |
| `--layout-hero-align` | `center` | Hero copy alignment |
| `--layout-hero-offset` | `44px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `retail-accordion` | Footer arrangement |
| `--layout-footer-columns` | `4` | Desktop footer groups |
| `--layout-footer-height` | `500px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-commerce-gallery-layout` | `paired` | `stacked`, `paired`, or `lead-and-pairs` — the repeating placement pattern of a product gallery. |
| `--family-commerce-purchase-position` | `sticky` | `flow` or `sticky` — whether the purchase panel scrolls with content or pins inside its section. |

Products run in equal pairs so the eye compares rather than scans. Images cover their frame; the crop is part of the merchandising. The purchase panel pins within its product section and returns to flow below `--layout-bp-md` — it never becomes a floating duplicate bar.

## Composition

Navigation icon-taxonomy → hero framed-cover (66% copy zone, background media, 4 / 3, 660px minimum) → retain the existing theme-specific body hierarchy → footer retail-accordion.

Keep photography dominant and chrome compact. Paired product rows retain tight gaps; bone-on-black or black-on-bone actions and large scale differences replace coloured emphasis. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single garment or object on a body or a form, shot in a studio. The product is the whole subject; no environment, no narrative scene.

**Treatment.** Studio product photography on a mid-grey or charcoal seamless, matching the page ground closely enough that the frame edge is the only boundary. Matte, true-to-material colour, fine fabric or surface detail preserved.

**Light.** Controlled studio light with soft modelling — enough shadow to describe form and material, never flat, never dramatic. Keep the background falling darker than the subject.

**Framing.** For the website opening, place this theme's source art in the 4 / 3 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Charcoal to near-black surroundings with the product's own material colour as the only chroma. Consecutive images in a pair should agree tonally so the row reads as one field.

**Never:**
- White or bright seamless backgrounds; they tear a hole in the dark page.
- Lifestyle scenes, locations, or props competing with the product.
- Visible logos, tags, or readable brand marks.
- Heavy retouching gloss or plastic-looking skin and fabric.

**Prompt skeleton.** `studio product photograph on charcoal seamless background, single garment on a form, soft controlled modelling light, matte true-to-material colour, fine fabric detail, vertical 4:5 crop, background darker than subject, no logos, no props`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep photography dominant and chrome compact. Paired product rows retain tight gaps; bone-on-black or black-on-bone actions and large scale differences replace coloured emphasis.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Public Sans; body: Public Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Retain an inset frame but reduce its padding; stack side cells below the dominant cover so the main image remains usable. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile replaces the three link columns with three ruled rows showing plus disclosure marks; locale/legal is centered beneath, above the cropped wordmark. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `icon-taxonomy` at `top`, with `80px` minimum height and `1180px` width (0px fills the available track). Use top navigation with a 1180px maximum width and 80px header height. At compact widths, use product/use-case/enterprise disclosure rows. Use single-column disclosures; keep the promotional card secondary.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [icon-taxonomy](https://www.navbar.gallery/navbar/velt). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `framed-cover`: copy share `66%`, media at `background` in a `4 / 3` frame, minimum height `660px`, title measure `12ch`, alignment `center` and desktop offset `44px`. Enclose the original product scene in a strong framed campaign panel; concentrate the text and object around one central axis before a retail directory. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Retain an inset frame but reduce its padding; stack side cells below the dominant cover so the main image remains usable.

Structural reference: [framed-cover](https://supahero.io/hero/grink). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `retail-accordion` with `4` desktop groups and `500px` minimum height. Reserve 500px as the desktop minimum closing height with 4 information columns or groups. Use native details/summary for the narrow-screen navigation groups if disclosure is needed. The desktop gallery screenshot does not establish a working subscription form, so provide one only when backed by a real flow.

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

Slides are fixed 1920 x 1080 CSS px artboards at 16 / 9, not pages: no navigation bar, no footer, no reading measure, no breakpoint, no hover. Nothing required sits outside `--slide-pad-edge` (84px), and `--slide-type-caption` (26px) is the smallest type on any slide.

- Ground: photography dominant with compact chrome; bone-on-black or black-on-bone actions replace coloured emphasis.
- Cover: a framed cover where the product photograph is the whole subject.
- Structure: paired product rows at tight gaps, with large scale differences doing the emphasis. One takeaway per slide, titled at `--slide-type-heading` (56px) with support at `--slide-type-body` (34px).
- Imagery: a single garment or object on a form, studio-shot, with no environment. At most one image per slide unless the request asks for a grid.
- Never: bright seamless backgrounds, lifestyle props, readable brand marks.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (8% of the shorter side), place the primary figure at `--content-figure` (0.53) of the shorter side anchored center, and one deliberate full-bleed figure may cross the safe area because `--content-bleed` is `1`.

- Frame: photography dominant with compact chrome; bone-on-black or black-on-bone actions replace coloured emphasis.
- Composition: paired product rows at tight gaps, with large scale differences doing the emphasis. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (128px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (60px), and nothing below `--content-type-caption` (26px) or 12px once scaled.
- Figure: a single garment or object on a form, studio-shot, with no environment.
- Never: bright seamless backgrounds, lifestyle props, readable brand marks.
