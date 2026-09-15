---
name: builtin-cobalt-atelier-design
description: Use this bundled Cobalt Atelier Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference color, type, spacing, radius, elevation, and motion tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation profile-popover → hero split-left (42% copy zone, right media, 4 / 3, 640px minimum) → retain the existing theme-specific body hierarchy → footer studio-address.

Cobalt is the ground, not an accent. Keep the light serif voice, mono labels, near-square unraised controls and visible cobalt around inset imagery. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max` with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by `--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Secondary media defaults to `--layout-hero`; website opening media uses `--layout-hero-media-ratio` and the Hero section.

Hold a single wide column for the headline and let supporting blocks occupy 5 of the 12 columns, offset rather than centred. Hairline rules at --layout-rule mark section boundaries; never box a section in a card.

## Composition

Flood the page with the cobalt field and let it carry the whole composition — it is the ground, not an accent, and no second large colour is introduced. A light serif display sits directly on the field at generous size with tight leading, and body copy holds to a 58ch measure so the field stays visible around it. Every label, caption and figure mark is mono, small, and uppercase, which is the only texture the page gets. Interactive elements are near-square blocks — the small `--r-*` steps, never a pill — and carry no shadow, so they read as cut apertures in the field rather than as raised controls. Imagery is inset into the field with a visible border of cobalt on all sides.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single subject isolated against a plain ground — an object, a figure, a material study. One idea per frame, no scene.

**Treatment.** High-contrast photography with the subject cleanly separated from its background, so it can be inset into a saturated field without the two fighting. Cool colour bias throughout.

**Light.** Directional light with a firm shadow edge. Contrast is high, midtones are few, and the result reads graphic rather than atmospheric.

**Framing.** For the website opening, place this theme's source art in the 4 / 3 frame at right specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Cool neutrals and steel tones so the image sits inside the cobalt field rather than clashing with it. Warm subjects must be graded cool.

**Never:**
- Warm golden or amber grading; it fights the field.
- Busy backgrounds that break the inset border's rhythm.
- Soft, low-contrast, or hazy treatments.
- Removing the cobalt field from body inset figures; the website opening follows its named Hero arrangement.

**Prompt skeleton.** `high-contrast photograph of a single isolated subject on a plain cool ground, directional light with a firm shadow edge, cool steel colour bias, subject centred with even margin, graphic rather than atmospheric, portrait crop`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Cobalt is the ground, not an accent. Keep the light serif voice, mono labels, near-square unraised controls and visible cobalt around inset imagery.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Instrument Serif; body: Instrument Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Gowun Batang", "Pretendard" for serif headings, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1260px maximum width and 72px header height. At compact widths, use the FAQ chip and a single-column FAQ card. Keep the anchored popover within viewport width and preserve direct CTA access.

Reference: https://www.navbar.gallery/navbar/hosier-brown

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Use a short stacked display at left, a large isolated figure at right and a low horizontal selection strip; preserve the original cobalt emphasis. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/anubi

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 560px as the desktop minimum closing height with 4 information columns or groups. Use an asymmetrical studio directory whose location pair is a first-class structural feature. Do not collapse the whole footer to a generic four-column sitemap.

Reference: https://www.footer.design/sites/reality-is

## Surfaces

Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.
