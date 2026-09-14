---
name: builtin-index-table-design
description: Use this bundled Index Table Theme theme to create token-driven interfaces and visual artifacts.
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

Build the page as a table and treat everything else as chrome around it. A two-column filter rail holds facets, sort and search; the remaining width is rows. Column headers are 12px, letterspaced, and sticky. Rows are separated by hairlines, not by gaps or cards, and row height stays tight — dense is the intent, not a compromise. All emphasis is carried by pill tags in the neutral grey with coloured text, never by coloured row backgrounds. Numbers are mono with tabular figures so columns align. The blue is links, focus and the active filter state, and appears nowhere else.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `side` | `top` or `side` — whether primary navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `2` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |
| `--family-data-table-layout` | `fixed` | `auto` or `fixed` — the width-allocation algorithm for full-width data tables. |

Navigation sits beside the content in a two-column track, because filters are navigation here and must stay visible while rows scroll. Labels sit beside their controls so a filter panel stays short. The table layout is fixed: column widths must not jump as rows load, since a moving column is worse than a narrow one.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A small square thumbnail representing a row entry — a specimen, a sample, a cover, a screenshot. It identifies a row; it is never decorative.

**Treatment.** Flat, uniform, high-key capture on a light neutral ground, processed identically across every row so a column of thumbnails reads as one consistent strip.

**Light.** Completely even, no directional shadow, no depth. Anything that suggests a scene will break the column.

**Framing.** Square 1:1 at small display size — assume 48 to 96px. The subject must survive being read at thumbnail scale, so it needs one clear shape and no fine detail.

**Relationship to the palette.** Light neutral ground with one dominant subject colour. Every thumbnail in a table must share the same ground so the column looks uniform.

**Never:**
- Full-width or hero-scale imagery; this system has no hero picture.
- Varied backgrounds between rows — the column must look machine-produced.
- Fine detail or small text inside the thumbnail.
- Drop shadows, rounded photo corners baked into the file, or borders in the image.

**Prompt skeleton.** `flat uniform thumbnail image of a single subject on a light neutral ground, completely even shadowless lighting, one clear dominant shape readable at 64px, square 1:1, no fine detail, no scene, consistent background`

## Reproducing this system

1. The dominant element on the page is a table, not a card grid.
2. A two-column filter rail sits beside the rows and stays visible while they scroll.
3. Rows are separated by hairlines with no gaps, and row height is visibly tight.
4. Emphasis is pill tags in neutral grey with coloured text; no row is colour-filled.
5. Numbers are mono with tabular figures and columns do not shift on load.
6. Blue appears only on links, focus and the active filter.

## Local typography

- Display: Urbanist; body: Urbanist; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Layout, Composition and Responsive in README.md and apply the --layout-* and --family-* tokens from colors_and_type.css before arranging content. Preserve the grid, reading measure, section rhythm, hero geometry and navigation placement; a palette/font swap on a generic layout is incomplete. Direction variants may change content emphasis, but must retain this structure unless the user explicitly overrides it. Check the rendered result at wide and narrow viewports and 200% zoom; fixed artboards retain their dimensions.
