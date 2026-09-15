---
name: builtin-archive-folio-design
description: Use this bundled Archive Folio Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference color, type, spacing, radius, elevation, and motion tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation profile-popover → hero portfolio-peek (44% copy zone, below media, 4 / 3, 640px minimum) → retain the existing theme-specific body hierarchy → footer studio-address.

Keep dense serif entries, dates and notes alongside their records, hairline dividers and tight rhythm. Hierarchy comes from position and weight, with no radius or elevation. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max` with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by `--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Secondary media defaults to `--layout-hero`; website opening media uses `--layout-hero-media-ratio` and the Hero section.

An asymmetric catalogue: an 8-column image track beside a 4-column information column of definition pairs, divided by a hairline rule that runs the full height. Captions sit directly beneath their image at body size; density is high and spacing is tight.

## Composition

Set a dense archival index on white, with a small serif used for everything — headings, entries and notes alike — so hierarchy comes from position and weight rather than from a second typeface. Entries are separated by hairline dividers with tight vertical rhythm. A running information column holds dates, references and notes alongside the entries and stays with them down the page; it is the system's defining structure and must not collapse into the main column except at the smallest width. Running text holds to a 64ch measure. Radius is zero on every surface and elevation is absent; colour is reserved for links and the single action.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An archival item — a document, a photograph, a print, a page — reproduced as a record of the thing rather than as a picture.

**Treatment.** Flat reproduction photography on white, square to the item, with the item's own edges, age and surface visible. No cleanup, no enhancement.

**Light.** Even copy-stand lighting with no glare and no directional shadow. Colour accurate to the original.

**Framing.** For the website opening, place this theme's source art in the 4 / 3 frame at below specified by Hero; keep its subject, medium, light and grading. Keep the complete subject visible with contain or an inner figure; do not crop evidence, objects or architecture to fill the outer region. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** White ground with the item's own aged tones — paper yellowing, ink fade, emulsion shift. The interface adds nothing.

**Never:**
- Styled or angled photography of the item.
- Digital cleanup that removes age, creases or edge wear.
- Enlarging an archive item without its identifying caption; keep body entries compact.
- Added borders, shadows, or textures in the file.

**Prompt skeleton.** `flat archival reproduction photograph of a document square to the camera on white, even copy-stand lighting with no glare, item complete with small white margin, accurate aged paper and ink tones, no retouching, no styling`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep dense serif entries, dates and notes alongside their records, hairline dividers and tight rhythm. Hierarchy comes from position and weight, with no radius or elevation.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Newsreader; body: Newsreader; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif text, "Pretendard" for UI labels; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1080px maximum width and 64px header height. At compact widths, use the FAQ chip and a single-column FAQ card. Keep the anchored popover within viewport width and preserve direct CTA access.

Reference: https://www.navbar.gallery/navbar/hosier-brown

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Keep the biographical statement narrow and centered, with a larger central work card and partially revealed neighboring work cards below. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/eric-jordan

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 500px as the desktop minimum closing height with 4 information columns or groups. Use an asymmetrical studio directory whose location pair is a first-class structural feature. Do not collapse the whole footer to a generic four-column sitemap.

Reference: https://www.footer.design/sites/reality-is

## Surfaces

Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.
