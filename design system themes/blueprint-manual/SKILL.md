---
name: builtin-blueprint-manual-design
description: Use this bundled Blueprint Manual Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference color, type, spacing, radius, elevation, and motion tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Copy fonts/ with licenses into outputs and link fonts/fonts.css; no CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Treat the page as a printed reference manual. Body copy is serif and may be justified in a narrow measure; diagrams sit in bordered figure panels with rotated mono labels beside them. One blueprint blue draws every line, axis and annotation, and nothing else is coloured. Keep radius near zero and use hairline rules and faint grid fields instead of elevation.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max` with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by `--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

A two-track manual: a narrow text track of 4 columns holding justified body at --layout-measure, beside a wide figure track of 8 columns. Figures are bordered panels with a rotated mono label in the outer margin; the rhythm is dense and continuous, not spaced out.

## Composition

Build the page as a technical manual. The ground is paper; the structure is blueprint line work — hairline rules, bounding boxes, leader lines and dimension marks drawn in the blue, never as decoration but always as annotation of something. Body copy is serif, justified, and runs to a long 66ch measure, because a manual is read in columns rather than scanned. Every figure carries a mono label in the form of a figure number and a short caption, placed outside the figure's frame. Headings are mono and letterspaced. Corners stay near-square at the 2-4px `--r-*` steps, nothing is elevated, and no colour is used except the blue line work.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A described object — a component, an assembly, a tool, a mechanism — shown as a figure that the surrounding text refers to.

**Treatment.** Either a clean orthographic line drawing or a flat record photograph on paper-white, in both cases free of styling. The image exists to be annotated.

**Light.** Even and shadowless. A manual figure has no atmosphere; any shadow that is not describing form is noise.

**Framing.** Contained on paper-white with clear margin for leader lines and dimension marks to reach into. Aspect follows the object, not a grid.

**Relationship to the palette.** Paper-white with graphite line weight and the blueprint blue for annotation. No other colour appears.

**Never:**
- Atmospheric or styled photography; this is a figure, not a picture.
- Coloured or gradient backgrounds.
- Annotation baked into the image; labels are typeset, not drawn in.
- Crops that leave no margin for leader lines.

**Prompt skeleton.** `clean orthographic technical figure of a mechanical component on paper-white, even shadowless lighting, graphite line weight, contained with clear margin around the object, no styling, no colour, no annotation in the image`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the
design. Check the result against all of these:

1. The ground is paper and all structure is drawn as blueprint line work in the blue.
2. Line work always annotates something; it is never decorative.
3. Body copy is justified serif at a 66ch measure.
4. Every figure carries a mono figure number and caption placed outside its frame.
5. Headings are mono and letterspaced.
6. Radius stays at the 2-4px `--r-*` steps, nothing is elevated, and no colour except the blue appears.

## Local typography

- Display: JetBrains Mono; body: Newsreader; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif body, "Pretendard" for UI; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Layout, Composition and Responsive in README.md and apply the --layout-* and --family-* tokens from colors_and_type.css before arranging content. Preserve the grid, reading measure, section rhythm, hero geometry and navigation placement; a palette/font swap on a generic layout is incomplete. Direction variants may change content emphasis, but must retain this structure unless the user explicitly overrides it. Check the rendered result at wide and narrow viewports and 200% zoom; fixed artboards retain their dimensions.
