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

## Local typography

- Display: Syne; body: Manrope; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Pretendard" for display and body, "Gowun Batang" for serif ledes; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
