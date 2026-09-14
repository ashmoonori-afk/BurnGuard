---
name: builtin-timber-hall-design
description: Use this bundled Timber Hall Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Copy fonts/
  with licenses into outputs and link fonts/fonts.css; no CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Build an evening interior. The ground is dark timber; the only colour in the system is lamplight amber, and it appears on links, focus and the single action. Rooms run full-bleed and panoramic, and the dark page continues out of the photograph so the seam is invisible. Statements are serif at a 54ch measure, set over the ground rather than over the image. Practical information — hours, address, the menu of the evening — sits beneath in quiet labelled columns with hairline rows. Radius is at most 2px and nothing is elevated, because lamplight already supplies all the depth the page needs.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `1.6` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-spatial-image-bleed` | `100%` | How far designated images extend from the content edge toward the viewport edge; 0% contained, 100% full-bleed. |

Full bleed at 100% with covered frames, so a lit room reaches the viewport edge and the dark page continues out of the photograph. The media track leads text at 1.6, as in the warm daylight system, because the place is still the argument.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An interior after dark — a dining room, a bar, a library, a hall lit by lamps. Empty of people, lit from within.

**Treatment.** Low-light interior photography with warm tungsten colour, deep timber and leather tones, and shadows falling to near-black at the frame edges so the image merges with the page ground.

**Light.** Practical lamps inside the frame as the only sources — table lamps, sconces, candles. Pools of warm light with real darkness between them. No fill light, no flash.

**Framing.** Panoramic 21:9 read along the length of the room, with the brightest pool of light off-centre and the frame edges falling dark.

**Relationship to the palette.** Near-black, dark timber, leather brown and a single warm amber from the lamps. No cool colour anywhere; no saturated accent objects.

**Never:**
- Bright or evenly lit interiors; the merge with the dark ground depends on falloff.
- Daylight, cool white bulbs, or mixed colour temperature.
- People, staff, or diners in frame.
- Edges that stay bright — the frame must fall dark at its borders.

**Prompt skeleton.** `low-light interior photograph of an empty dining room after dark, warm tungsten table lamps as the only light sources, pools of amber light with deep darkness between them, dark timber and leather tones, frame edges falling to near-black, panoramic 21:9, no people, no flash, no daylight`

## Reproducing this system

1. The ground is dark timber and lamplight amber is the only colour used.
2. Rooms run full-bleed and panoramic with edges falling dark into the page.
3. Statements are serif at a 54ch measure, set over the ground and not over the image.
4. Practical information sits beneath in quiet labelled columns with hairline rows.
5. Radius is at most 2px and nothing is elevated.
6. No image contains people or daylight.

## Local typography

- Display: Newsreader; body: Figtree; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Layout, Composition and Responsive in README.md and apply the --layout-* and --family-* tokens from colors_and_type.css before arranging content. Preserve the grid, reading measure, section rhythm, hero geometry and navigation placement; a palette/font swap on a generic layout is incomplete. Direction variants may change content emphasis, but must retain this structure unless the user explicitly overrides it. Check the rendered result at wide and narrow viewports and 200% zoom; fixed artboards retain their dimensions.
