---
name: builtin-stone-court-design
description: Use this bundled Stone Court Theme theme to create token-driven interfaces and visual artifacts.
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

Work on cool limestone with a didone statement voice and a neutral sans for everything read at length. Images are contained plates with real margin on all sides and never bleed; the ground must be visible around every one. Two-track sections split evenly between photograph and description. Captions sit under plates in 12px mono: location, year, material. The slate accent marks links and the primary action only. Rules are hairline, radius is zero, and the page is quiet enough that the only contrast is between stone and shadow.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `contain` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `1.0` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-spatial-image-bleed` | `0%` | How far designated images extend from the content edge toward the viewport edge; 0% contained, 100% full-bleed. |

Images are contained and do not bleed at all, because this system documents architecture and a cropped building is an unreadable building. The media and text tracks are equal at 1.0, giving the writing the same standing as the photograph.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An architectural exterior or a masonry detail — a courtyard, a facade, an arcade, a stair, a wall junction. Structure and material, not interiors.

**Treatment.** Formal architectural photography, square to the subject, with true verticals and no lens distortion. Cool neutral colour with stone, concrete, lime plaster and weathered metal reading accurately.

**Light.** Overcast or open-shade daylight with soft even shadows, or raking low sun where texture is the subject. Avoid harsh midday contrast.

**Framing.** Landscape 3:2 with the structure fully inside the frame and clear space around it. The subject must be complete: no cropped corners, no cut-off roofline.

**Relationship to the palette.** Limestone, concrete grey, slate and weathered bronze. Cool neutral overall — the warm end of the spectrum belongs to a different system.

**Never:**
- Cropping into the structure or bleeding it off the frame edge.
- Warm golden-hour grading; this system is deliberately cool.
- Tilted verticals, fisheye, or extreme wide-angle drama.
- People, vehicles, or signage dominating the frame.

**Prompt skeleton.** `formal architectural photograph of a stone courtyard facade, square to the subject with true verticals, overcast soft even daylight, cool neutral limestone and concrete palette, structure complete inside the frame with clear space around it, landscape 3:2, no people, no distortion`

## Reproducing this system

1. The ground is cool limestone and no warm cast appears anywhere.
2. Every image is a contained plate with visible ground on all sides; nothing bleeds.
3. Sections split evenly between photograph and description.
4. Captions are 12px mono giving location, year and material.
5. The slate accent marks only links and the primary action.
6. Radius is zero, rules are hairline, and nothing is elevated.

## Local typography

- Display: DM Serif Display; body: Manrope; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
