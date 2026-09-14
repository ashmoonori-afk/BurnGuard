---
name: builtin-exhibit-wall-design
description: Use this bundled Exhibit Wall Theme theme to create token-driven interfaces and visual artifacts.
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

Treat the page as a hung room. The ground is warm plaster; works are contained with visible ground on every side and are never cropped or bled. Titles are set in the serif display face with each line stepped three characters further right, which gives a wall-text cadence without any rotation or overlap. Under each work sits a wall label: title, year, medium, dimensions, in small mono label-and-value rows separated by a hairline. The clay accent marks only links and the primary action. Radius is zero, elevation does not exist, and the eye moves between works by walking, not by scrolling through a grid.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-creative-type-rotation` | `0deg` | Rotation applied to a designated display composition about its own centre. |
| `--family-creative-line-step` | `3ch` | Successive display lines shift by `n x step` along the inline axis, starting at line zero. |
| `--family-creative-type-image-overlap` | `0%` | How far a display block translates over preceding imagery, as a share of its own block-size. |

Display lines step three characters further along the inline axis on each successive line, producing a staircase that reads as a hand-set wall text. Nothing rotates and nothing overlaps imagery: in this system the work is never touched by type.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single artwork or made object photographed as documentation — a painting, a sculpture, a ceramic, a textile piece. One work per frame, always complete.

**Treatment.** Gallery documentation photography: the work shown whole and square to the lens, on or against a warm off-white plaster wall that matches the page ground. Faithful colour, visible surface texture, no styling.

**Light.** Even diffused gallery light with a soft falloff toward the frame edges and a faint shadow where the work meets the wall. No spotlights, no hotspots.

**Framing.** Landscape 3:2 with the work centred and clear margin of wall on every side. The margin is part of the picture: the work must appear hung, not cropped.

**Relationship to the palette.** Warm off-white plaster surroundings with the work's own colours as the only chroma. Neutral to warm cast throughout; never cool or blue-white.

**Never:**
- Cropping into the work or bleeding it to the frame edge.
- Cool white or grey gallery walls that clash with the warm ground.
- Visitors, hands, plinth clutter, or reflections of a room.
- Dramatic spotlighting or heavy vignetting.

**Prompt skeleton.** `gallery documentation photograph of a single artwork hung on a warm off-white plaster wall, shown whole and square to the lens with clear wall margin on all sides, even diffused gallery light, faint contact shadow, faithful colour and visible surface texture, landscape 3:2, no people, no crop`

## Reproducing this system

1. Warm plaster ground is visible on all four sides of every work.
2. Display lines step three characters further right on each successive line.
3. No type ever overlaps or rotates over a work.
4. Each work carries a wall label of mono label-and-value rows under a hairline.
5. The clay accent appears only on links and the primary action.
6. Gutters are wide at 32px and nothing is rounded or elevated.

## Local typography

- Display: Fraunces; body: Manrope; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
