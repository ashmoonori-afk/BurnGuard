# Cupcake Built-in Theme

A warm pastel system with rounded controls and soft aqua, pink, and apricot accents.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The donor palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Provenance

Derived from the daisyUI `cupcake` theme: https://github.com/saadeghi/daisyui/blob/master/packages/daisyui/src/themes/cupcake.css

Licensed under the MIT License, Copyright (c) 2020 Pouya Saadeghi. Source OKLCH values were converted offline to sRGB, gamut-clipped, and rounded to the nearest 8-bit channel. See the repository `NOTICE` file.

## Local typography

- Display: DM Serif Display; body: DM Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: Gowun Batang for serif headings, Pretendard; finish with generic serif/sans-serif/monospace.
- Body 16–18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32–64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Layout

The 12-column grid, 1080px maximum width, 54ch reading measure and 24px gutters are mandatory. Use the page margins, vertical section rhythm and 1 / 1 hero ratio from colors_and_type.css. Layout belongs to this system alongside palette and typography.

## Composition

Center the introduction and primary action above a square product stage. Follow with three friendly benefit columns and alternating story sections; keep soft panels subordinate to the main visual.


## Responsive

Below --layout-bp-md, collapse content to one column in reading order, place message before media and move any side navigation into a compact top row. Remove decorative offsets and keep tables in their own horizontal scroll region. Between medium and large breakpoints, reduce spans without changing the hierarchy. Above --layout-bp-lg, retain the full grid within --layout-max. At 200% zoom, allow labels and actions to wrap without clipping. Slides and graphics keep their fixed artboard dimensions; adapt content inside that canvas rather than applying website breakpoints to its size.
