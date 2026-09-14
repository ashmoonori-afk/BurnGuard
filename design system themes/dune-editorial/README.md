# Dune Editorial Theme

Warm sand neutrals under an oversized grotesque wordmark, with a serif lede over full-bleed imagery.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Layout

Layout is part of this system, not a per-page decision. Build every artifact on these tokens rather than inventing a grid:

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | 1320px | Outer content width |
| `--layout-measure` | 56ch | Reading measure for body copy |
| `--layout-columns` | 12 | Base column count |
| `--layout-gutter` | 28px | Space between columns |
| `--layout-margin` | clamp(20px, 4vw, 56px) | Page side margin |
| `--layout-section-y` | clamp(80px, 11vw, 180px) | Vertical rhythm between sections |
| `--layout-rule` | 1px | Divider weight |
| `--layout-bp-md` / `--layout-bp-lg` | 800px / 1160px | Breakpoints |
| `--layout-hero` | 3 / 2 | Hero aspect ratio |

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

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, and shape rules were composed for this theme; no third-party theme, stylesheet, palette, or asset is included, and it carries no external license obligation.

## Local typography

- Display: Syne; body: Manrope; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Pretendard" for display and body, "Gowun Batang" for serif ledes; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
