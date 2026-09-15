---
name: builtin-blueprint-manual-design
description: Use this bundled Blueprint Manual Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference color, type, spacing, radius, elevation, and motion tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation enterprise-columns → hero specimen-poster (92% copy zone, background media, 4 / 3, 720px minimum) → retain the existing theme-specific body hierarchy → footer contact-ledger.

Keep the paper ground, blueprint annotations, numbered figures, serif reading body and mono headings. Line work explains content; use near-square corners and no elevation. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max` with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by `--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Secondary media defaults to `--layout-hero`; website opening media uses `--layout-hero-media-ratio` and the Hero section.

A two-track manual: a narrow text track of 4 columns holding justified body at --layout-measure, beside a wide figure track of 8 columns. Figures are bordered panels with a rotated mono label in the outer margin; the rhythm is dense and continuous, not spaced out.

## Composition

Build the page as a technical manual. The ground is paper; the structure is blueprint line work — hairline rules, bounding boxes, leader lines and dimension marks drawn in the blue, never as decoration but always as annotation of something. Body copy is serif, justified, and runs to a long 66ch measure, because a manual is read in columns rather than scanned. Every figure carries a mono label in the form of a figure number and a short caption, placed outside the figure's frame. Headings are mono and letterspaced. Corners stay near-square at the 2-4px `--r-*` steps, nothing is elevated, and no colour is used except the blue line work.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A described object — a component, an assembly, a tool, a mechanism — shown as a figure that the surrounding text refers to.

**Treatment.** Either a clean orthographic line drawing or a flat record photograph on paper-white, in both cases free of styling. The image exists to be annotated.

**Light.** Even and shadowless. A manual figure has no atmosphere; any shadow that is not describing form is noise.

**Framing.** For the website opening, place this theme's source art in the 4 / 3 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the complete subject visible with contain or an inner figure; do not crop evidence, objects or architecture to fill the outer region. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Paper-white with graphite line weight and the blueprint blue for annotation. No other colour appears.

**Never:**
- Atmospheric or styled photography; this is a figure, not a picture.
- Coloured or gradient backgrounds.
- Annotation baked into the image; labels are typeset, not drawn in.
- Crops that leave no margin for leader lines.

**Prompt skeleton.** `clean orthographic technical figure of a mechanical component on paper-white, even shadowless lighting, graphite line weight, contained with clear margin around the object, no styling, no colour, no annotation in the image`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the paper ground, blueprint annotations, numbered figures, serif reading body and mono headings. Line work explains content; use near-square corners and no elevation.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: JetBrains Mono; body: Newsreader; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif body, "Pretendard" for UI; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1440px maximum width and 104px header height. At compact widths, use category rows with chevrons under a compact brand/close bar. Collapse taxonomy columns into grouped disclosures.

Reference: https://www.navbar.gallery/navbar/cloudflare

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Keep the technical specimen legible and dominant below an edge-wide title; metadata should remain small groups, never a second competing card grid. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/35mm

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 560px as the desktop minimum closing height with 3 information columns or groups. Use whitespace and a vertically organized address ledger rather than many equal navigation columns. Give contact details readable minimum type sizes.

Reference: https://www.footer.design/sites/esr

## Surfaces

Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.
