---
name: builtin-ledger-index-design
description: Use this bundled Ledger Index Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference color, type, spacing, radius, elevation, and motion tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation side-rail → hero product-panel (64% copy zone, below media, 16 / 10, 580px minimum) → retain the existing theme-specific body hierarchy → footer retail-accordion.

Keep the ruled index body: shared-edge cells, mono labels, monochrome imagery and emphasis by cell size and rule weight. No radius or shadow. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max` with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by `--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Secondary media defaults to `--layout-hero`; website opening media uses `--layout-hero-media-ratio` and the Hero section.

Everything is a ruled cell. Columns touch with zero gutter and share 1px borders that meet exactly, so the page reads as one table. Sections do not use vertical spacing - the rule between rows is the separation.

## Composition

The page is a ruled index. Every item lives in a boxed cell bounded by hairlines, and the boxes share edges so the sheet reads as one continuous ruling rather than as separate cards. Type is small and all-caps for labels, with a short 48ch measure for any running text — this system is built for scanning, not reading. Imagery is monochrome so it never outweighs the ruling. There is no radius and no shadow anywhere; a raised surface would contradict the sheet. Emphasis is achieved by cell size and rule weight, never by colour fill.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An indexed item shown plainly — an artefact, a document, a building, a specimen. It identifies an entry rather than illustrating a story.

**Treatment.** Converted to monochrome with a full but gentle tonal range, so a page of them reads as one consistent set. No colour survives.

**Light.** Even and documentary. Contrast should be moderate; crushed blacks or blown highlights break the uniformity of the sheet.

**Framing.** For the website opening, place this theme's source art in the 16 / 10 frame at below specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Monochrome only, on the paper ground. The interface supplies no colour to compete with.

**Never:**
- Colour images of any kind.
- Inconsistent tonal treatment between cells.
- Drop shadows, rounded corners, or borders baked into the file.
- Dramatic contrast that makes one cell dominate the sheet.

**Prompt skeleton.** `monochrome documentary photograph of a single indexed item, even documentary lighting, moderate contrast with a full gentle tonal range, cropped to fill the frame, consistent treatment, no colour, no shadow effects`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the ruled index body: shared-edge cells, mono labels, monochrome imagery and emphasis by cell size and rule weight. No radius or shadow.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Public Sans; body: Public Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for all UI text, "Nanum Myeongjo" for serif; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use side navigation with a 220px maximum width and 72px header height. At compact widths, use compact icon/hamburger top bar and large vertical text menu. Convert the desktop rail to an overlay so content retains width.

Reference: https://www.navbar.gallery/navbar/big-dirty-agency

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Offset the main page by a real navigation rail, then center a concise introduction above overlapping interface/device panels. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/easlo

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 480px as the desktop minimum closing height with 4 information columns or groups. Use native details/summary for the narrow-screen navigation groups if disclosure is needed. The desktop gallery screenshot does not establish a working subscription form, so provide one only when backed by a real flow.

Reference: https://www.footer.design/sites/outway

## Surfaces

Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.
