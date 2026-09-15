---
name: builtin-quarterly-folio-design
description: Use this bundled Quarterly Folio Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation mega-feature → hero filmstrip (68% copy zone, below media, 4 / 5, 620px minimum) → retain the existing theme-specific body hierarchy → footer photo-strip.

Keep letterspaced eyebrows, didone openings and warm serif body text with indents. Deep green stays sparse; wide margins and hairline rules make the folio feel bound. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Secondary media defaults to `--layout-hero`; website opening media uses `--layout-hero-media-ratio` and the Hero section.

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `contain` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `1 / 1` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-editorial-paragraph-mode` | `indented` | `spaced` (a `--sp-4` gap, no indent) or `indented` (1em first line, no gap, not after a heading). |

Media and text take equal tracks when paired, so neither dominates and the spread reads as a balanced opening. Images are contained. Paragraphs are indented with no gap, which is what lets long prose read as a single continuous body.

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

## Local typography

- Display: Bodoni Moda; body: Lora; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif text, "Pretendard" for eyebrows; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1220px maximum width and 104px header height. At compact widths, use brand plus close control and stacked product/service disclosures. Stack columns and move featured content below links.

Reference: https://www.navbar.gallery/navbar/chesapeake-plywood

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Keep portrait or document cards as whole visible figures in a horizontal editorial strip beneath the centered introduction; preserve publication margins. Retain object-fit: contain for the original artwork: the whole building, document or object must remain visible. Interpret oversized/cropped reference geometry through the frame and typography, not by clipping the artwork.

Reference: https://supahero.io/hero/dribbble

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 480px as the desktop minimum closing height with 2 information columns or groups. Separate a useful navigation band from an original local photo strip. Decorative shapes must not obscure or intercept links. Do not copy the person's portrait or brand assets.

Reference: https://www.footer.design/sites/carolyn-lee

## Surfaces

Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.
