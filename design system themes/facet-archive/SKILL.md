---
name: builtin-facet-archive-design
description: Use this bundled Facet Archive Theme theme to create token-driven interfaces and visual artifacts.
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

Frame a light specimen grid in dark chrome. The rail, header and footer are near-black; the grid cells carry the specimen on its own ground and are separated by a single 1px gutter so the whole grid reads as one ruled sheet. Each cell is labelled underneath with a name and a mono identifier — a specimen is worthless unlabelled. Facets are typed groups with counts, and a sort toggle sits at the rail's head. Emphasis is a pill in the neutral dark with light text; no colour fill exists. The one steel accent marks the active facet and focus only.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `side` | `top` or `side` — whether primary navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `3` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `above` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |
| `--family-data-table-layout` | `auto` | `auto` or `fixed` — the width-allocation algorithm for full-width data tables. |

A three-column facet rail, wider than a filter strip because facets here are typed categories with counts rather than simple switches. Labels sit above their controls so long category names are not truncated. Table layout is auto: the archive's occasional detail tables hold variable-length values and should size to their content.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A specimen: a material sample, a surface, a swatch, a component, a single plant or mineral. One specimen per frame, identifiable and classifiable.

**Treatment.** Straight-on catalogue capture with the specimen filling most of the frame on a plain ground. Texture and surface must read clearly because the specimen is being classified by its material.

**Light.** Even, slightly raking light — flat enough to be comparable across specimens, angled just enough to reveal surface relief.

**Framing.** Standard 4:3 with the specimen centred, small even margin, and a consistent camera distance so specimens can be compared cell to cell.

**Relationship to the palette.** Neutral ground with the specimen's true colour. The ground should be light so the cells read as lit plates inside the dark chrome.

**Never:**
- Dark backgrounds inside cells; the contrast between light grid and dark chrome is the system.
- Styled or posed compositions with more than one specimen.
- Inconsistent camera distance or crop between specimens.
- Colour grading that changes the specimen's real material colour.

**Prompt skeleton.** `straight-on catalogue photograph of a single material specimen on a plain light neutral ground, even slightly raking light revealing surface relief, specimen centred with small even margin, true material colour, 4:3, consistent camera distance, no styling`

## Reproducing this system

1. Dark chrome frames a light specimen grid that reaches the viewport edge.
2. Cells are separated by a 1px gutter that reads as a rule, not as space.
3. Every cell is labelled with a name and a mono identifier.
4. Facets are typed groups with counts, and a sort toggle sits at the rail head.
5. No colour fill exists; the steel accent marks only the active facet and focus.
6. Radius is zero on everything except pills.

## Local typography

- Display: Space Grotesk; body: Space Grotesk; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Layout, Composition and Responsive in README.md and apply the --layout-* and --family-* tokens from colors_and_type.css before arranging content. Preserve the grid, reading measure, section rhythm, hero geometry and navigation placement; a palette/font swap on a generic layout is incomplete. Direction variants may change content emphasis, but must retain this structure unless the user explicitly overrides it. Check the rendered result at wide and narrow viewports and 200% zoom; fixed artboards retain their dimensions.
