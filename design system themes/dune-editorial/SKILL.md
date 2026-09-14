---
name: builtin-dune-editorial-design
description: Use this bundled Dune Editorial Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference color, type, spacing, radius, elevation, and motion tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Copy fonts/ with licenses into outputs and link fonts/fonts.css; no CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Anchor the page on a full-bleed warm landscape and let an oversized grotesque wordmark cross the bottom edge, cropped rather than contained. The opening statement is serif, set over the image at a comfortable measure. Navigation is tiny all-caps at the extreme corners. Keep the palette to sand, bone and a muted sky so the photography carries the colour.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max` with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by `--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

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

**Framing.** Full-bleed wide crop with a calm region — sky, flat sand, plain wall — where the serif lede can sit legibly over the image.

**Relationship to the palette.** Sand, ochre, clay and warm shadow, matching the page ground closely enough that the bleed edge is invisible.

**Never:**
- Cool, green, or blue-dominant landscapes.
- People, vehicles, or built structures dominating the frame.
- Busy frames with no calm region for the lede.
- Harsh midday light that flattens the surface texture.

**Prompt skeleton.** `wide natural landscape photograph of a warm sand dune surface, low raking sun with long soft shadows, fine surface texture, ochre and clay palette, soft atmospheric haze in the distance, calm open region in the upper frame, no people`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the
design. Check the result against all of these:

1. An oversized grotesque wordmark anchors the top of the page.
2. A serif lede is set over full-bleed imagery at a 56ch measure.
3. Body sections return to the sand ground with wide vertical rhythm.
4. Colour stays in the sand range plus one deeper terracotta for actions.
5. Rules are hairline and radius stays small.
6. Imagery matches the ground closely enough that the bleed edge is invisible.

## Local typography

- Display: Syne; body: Manrope; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Pretendard" for display and body, "Gowun Batang" for serif ledes; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Layout, Composition and Responsive in README.md and apply the --layout-* and --family-* tokens from colors_and_type.css before arranging content. Preserve the grid, reading measure, section rhythm, hero geometry and navigation placement; a palette/font swap on a generic layout is incomplete. Direction variants may change content emphasis, but must retain this structure unless the user explicitly overrides it. Check the rendered result at wide and narrow viewports and 200% zoom; fixed artboards retain their dimensions.
