---
name: builtin-graphite-spec-design
description: Use this bundled Graphite Spec Theme theme to create token-driven interfaces and visual artifacts.
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

Set body in mono and accept the density that follows — this system is for material that is measured, not persuaded. Number every figure and put the number in the margin track. Amber marks the value under discussion: a highlighted row, a callout figure, a threshold. Everything else is graphite and bone. Radius is zero everywhere and elevation is never used; structure comes entirely from rules and alignment. Tables are first-class, not an afterthought.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `top` | `top` or `side` — whether primary navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `2` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |

Navigation is a compact top row at 44px with a rule beneath. Labels sit beside their control, matching the document's two-track annotation structure so a form reads like a spec table.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Technical drawing and measured artifacts: an exploded view, a section drawing, a dimensioned component, a calibration surface. Line work rather than photography wherever possible.

**Treatment.** Flat vector line drawing on the graphite ground, hairline weight, no fills except where a part must be distinguished. Where photography is required, make it a flat frontal record shot with no styling.

**Light.** Not applicable to line work. For record photography, flat even illumination with no modelling — the goal is legibility of form, not atmosphere.

**Framing.** Orthographic and squared to the frame. Include dimension lines, leader lines and figure labels as part of the image.

**Relationship to the palette.** Bone line work on graphite, with amber reserved for the single dimension or part being called out.

**Never:**
- Perspective renders, dramatic angles, or atmospheric lighting.
- Colour fills beyond the single amber callout.
- Decorative iconography standing in for a real diagram.
- Soft shadows or any suggestion of depth.

**Prompt skeleton.** `flat orthographic technical line drawing of a mechanical component, hairline bone-white strokes on dark graphite background, dimension lines and leader labels, one amber highlighted dimension, no shading, no perspective`

## Reproducing this system

1. Body copy is set in mono and the density is noticeably higher than a marketing page.
2. Every figure carries a number, and the number sits in the margin track.
3. Amber appears only on the value being called out — never as general decoration.
4. Radius is zero on every element and no element has a shadow.
5. Structure is legible from rules and alignment alone.
6. A data table looks native to the system rather than bolted on.

## Local typography

- Display: IBM Plex Mono; body: IBM Plex Mono; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for UI text; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Layout, Composition and Responsive in README.md and apply the --layout-* and --family-* tokens from colors_and_type.css before arranging content. Preserve the grid, reading measure, section rhythm, hero geometry and navigation placement; a palette/font swap on a generic layout is incomplete. Direction variants may change content emphasis, but must retain this structure unless the user explicitly overrides it. Check the rendered result at wide and narrow viewports and 200% zoom; fixed artboards retain their dimensions.
