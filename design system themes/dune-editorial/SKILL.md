---
name: builtin-dune-editorial-design
description: Use this bundled Dune Editorial Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference color, type, spacing, radius, elevation, and motion tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation editorial-overlay → hero split-reverse (36% copy zone, left media, 4 / 5, 740px minimum) → retain the existing theme-specific body hierarchy → footer photo-strip.

Keep sand neutrals, the grotesque name and serif speaking voice. Terracotta carries actions; use hairline rules, small radii and wide editorial rhythm. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max` with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by `--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Secondary media defaults to `--layout-hero`; website opening media uses `--layout-hero-media-ratio` and the Hero section.

The hero is full-bleed and the display line crosses its lower edge, cropped by the viewport rather than contained. Below it, editorial content returns to a centred measure with very large section rhythm.

## Composition

Work in warm sand neutrals with an oversized grotesque wordmark anchoring the top of the page. Beneath it, a serif lede is set over full-bleed imagery at a 56ch measure, which is the system's central move: the sans states the name, the serif speaks. Body sections return to the sand ground with wide vertical rhythm. Colour is held to the sand range plus a single deeper terracotta for actions; nothing brighter enters. Rules are hairline and radius stays small, so the warmth comes from the palette rather than from soft shapes.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Landscape and natural surface at scale — dune, escarpment, dry riverbed, weathered wall. Human-free and horizon-led.

**Treatment.** Wide natural photography with warm sand, ochre and clay tones, fine surface texture, and soft atmospheric haze in the distance.

**Light.** Low warm sun raking across the surface so texture reads, with long soft shadows. Midday flatness defeats the image.

**Framing.** For the website opening, place this theme's source art in the 4 / 5 frame at left specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Sand, ochre, clay and warm shadow, matching the page ground closely enough that the bleed edge is invisible.

**Never:**
- Cool, green, or blue-dominant landscapes.
- People, vehicles, or built structures dominating the frame.
- Busy frames with no calm region for the lede.
- Harsh midday light that flattens the surface texture.

**Prompt skeleton.** `wide natural landscape photograph of a warm sand dune surface, low raking sun with long soft shadows, fine surface texture, ochre and clay palette, soft atmospheric haze in the distance, calm open region in the upper frame, no people`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep sand neutrals, the grotesque name and serif speaking voice. Terracotta carries actions; use hairline rules, small radii and wide editorial rhythm.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Syne; body: Manrope; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Pretendard" for display and body, "Gowun Batang" for serif ledes; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1160px maximum width and 88px header height. At compact widths, use one vertical large-link list with close control. Stack links first; featured work and contact information follow.

Reference: https://www.navbar.gallery/navbar/clonix

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Give most of the width to a tall left image and reserve a narrow right serif column; continue the generous margin into a photographic closing strip. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/treize-grammes

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 600px as the desktop minimum closing height with 2 information columns or groups. Separate a useful navigation band from an original local photo strip. Decorative shapes must not obscure or intercept links. Do not copy the person's portrait or brand assets.

Reference: https://www.footer.design/sites/carolyn-lee

## Surfaces

Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.
