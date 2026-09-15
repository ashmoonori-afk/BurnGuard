---
name: builtin-press-riso-design
description: Use this bundled Press Riso Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation icon-taxonomy → hero portfolio-peek (48% copy zone, background media, 1 / 1, 660px minimum) → retain the existing theme-specific body hierarchy → footer window-stage.

Keep cream stock and flat vermilion, ultramarine and sun-yellow roles. Condensed large type, one three-degree display rotation, 2px rules and square corners retain the printed character. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Secondary media defaults to `--layout-hero`; website opening media uses `--layout-hero-media-ratio` and the Hero section.

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-creative-type-rotation` | `-3deg` | Rotation applied to a designated display composition about its own centre. |
| `--family-creative-line-step` | `0px` | Successive display lines shift by `n x step` along the inline axis, starting at line zero. |
| `--family-creative-type-image-overlap` | `40%` | How far a display block translates over preceding imagery, as a share of its own block-size. |

The designated display composition is rotated three degrees off square — the misregistration of a hand-fed press, applied deliberately and only once per page. It also translates over the preceding image by 40% of its own height, so the rotated block and the print visibly overlap the way two runs of ink would.

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

## Local typography

- Display: Anton; body: DM Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1160px maximum width and 88px header height. At compact widths, use product/use-case/enterprise disclosure rows. Use single-column disclosures; keep the promotional card secondary.

Reference: https://www.navbar.gallery/navbar/velt

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Use a sparse constellation of original work tiles around a dominant plane, retaining only the theme's existing single minus-three-degree display tilt. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/bychudy

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 580px as the desktop minimum closing height with 3 information columns or groups. Build the footer as title stage, compact link panels, then a three-cell brand band. Keep panels in normal document flow on narrow screens; animation is optional.

Reference: https://www.footer.design/sites/the-design-society

## Surfaces

Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.
