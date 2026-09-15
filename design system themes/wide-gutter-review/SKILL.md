---
name: builtin-wide-gutter-review-design
description: Use this bundled Wide Gutter Review Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation editorial-overlay → hero split-left (54% copy zone, right media, 4 / 3, 660px minimum) → retain the existing theme-specific body hierarchy → footer contact-ledger.

Keep a narrow sans reading spine, high-contrast serif titles, mono captions and the empty wide gutter. Blue marks one live item; the page stays flat and square. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Secondary media defaults to `--layout-hero`; website opening media uses `--layout-hero-media-ratio` and the Hero section.

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `2 / 1` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-editorial-paragraph-mode` | `spaced` | `spaced` (a `--sp-4` gap, no indent) or `indented` (1em first line, no gap, not after a heading). |

The image track is twice the text track, gutter excluded. Images cover their frame because in this system the image is a plate at a fixed proportion, and the crop is part of the edit. Paragraphs are spaced by `--sp-4` with no indent, matching the sans body.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single considered subject per plate — a garment, an interior, an artwork, a portrait. One idea per image, presented as a plate rather than a snapshot.

**Treatment.** Editorial photography with deliberate art direction. Clean, decisive, high resolution. The crop is part of the composition, so images are made to be cropped to a tall frame.

**Light.** Controlled and directional, with real shadow shape. Studio or strong window light. Shadows are allowed to be dark.

**Framing.** For the website opening, place this theme's source art in the 4 / 3 frame at right specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** White, black and one material colour per plate. The page is white, so images should not also be white-dominant or they will dissolve into the ground.

**Never:**
- Discarding the subject to force a different frame; preserve the complete editorial subject within the named Hero geometry.
- Busy multi-subject scenes that fight the narrow text track.
- Pale, low-contrast images that disappear against white paper.
- Adding a border or shadow to seat the image; it sits directly on the ground.

**Prompt skeleton.** `editorial photograph, single subject, portrait 4:5 orientation, controlled directional light with defined shadows, one strong material colour against neutral surroundings, decisive crop, high resolution, no border`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep a narrow sans reading spine, high-contrast serif titles, mono captions and the empty wide gutter. Blue marks one live item; the page stays flat and square.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Instrument Serif; body: Public Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1440px maximum width and 84px header height. At compact widths, use one vertical large-link list with close control. Stack links first; featured work and contact information follow.

Reference: https://www.navbar.gallery/navbar/clonix

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Allow the giant left display and complete right subject to make one asymmetric spread; retain exceptionally broad gutters through the contact footer. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/karo

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 500px as the desktop minimum closing height with 3 information columns or groups. Use whitespace and a vertically organized address ledger rather than many equal navigation columns. Give contact details readable minimum type sizes.

Reference: https://www.footer.design/sites/esr

## Surfaces

Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.
