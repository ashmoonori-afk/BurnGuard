---
name: builtin-warm-vestibule-design
description: Use this bundled Warm Vestibule Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation floating-island → hero fullbleed-top (62% copy zone, background media, 16 / 9, 760px minimum) → retain the existing theme-specific body hierarchy → footer scenic-overlay.

Keep putty, timber, clay and olive from the interior, plain practical lists and unraised square surfaces. The place leads; no cart, price or promotional offer. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

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
| `--family-media-text-ratio` | `1.6` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-spatial-image-bleed` | `100%` | How far designated images extend from the content edge toward the viewport edge; 0% contained, 100% full-bleed. |

Imagery covers its frame and bleeds the full 100% to the viewport edge, because a room has no margin. In side-by-side sections the media track is 1.6 times the text track: the place leads and the writing accompanies it.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An interior or an architectural space with no people in it — a room, a corridor, a courtyard, a corner with furniture and light. The space is the subject.

**Treatment.** Natural architectural photography with true verticals, warm neutral colour, and visible material texture: timber grain, brick, plaster, textile, worn floor. Unstyled and lived-in rather than staged.

**Light.** Daylight from a window or an opening, warm and directional, with soft shadows describing depth. Time of day should read as late morning or afternoon.

**Framing.** For the website opening, place this theme's source art in the 16 / 9 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Putty, timber, clay, charcoal and olive drawn from the real materials in frame. The interface palette is taken from the photograph, so the photograph must be warm and neutral.

**Never:**
- People in frame; this system shows places, not occupants.
- Cool blue-white or fluorescent colour casts that fight the warm ground.
- Tilted verticals or wide-angle distortion.
- Over-styled staging — a magazine set with props arranged for the camera.

**Prompt skeleton.** `architectural interior photograph of an empty lived-in room, warm directional daylight from a window, true straight verticals, visible timber brick and plaster texture, warm neutral colour, clear depth cue through a doorway, wide 16:9, no people, no staging`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep putty, timber, clay and olive from the interior, plain practical lists and unraised square surfaces. The place leads; no cart, price or promotional offer.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Public Sans; body: Public Sans; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use overlay navigation with a 840px maximum width and 72px header height. At compact widths, use an expanded dark vertical menu with brand and close control. Preserve compact header and expand links vertically.

Reference: https://www.navbar.gallery/navbar/supaste

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Give the existing warm room photograph the full first fold, placing the introduction near the upper-left with readable ground-backed text. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/integratedbio

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 600px as the desktop minimum closing height with 3 information columns or groups. Reserve a scenic field above a readable information zone on narrow screens. Use an original local background; do not depend on WebGL or video for access to navigation.

Reference: https://www.footer.design/sites/eclipse-space

## Surfaces

Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.
