# Facet Archive Theme

A faceted archive: dark chrome around an edge-to-edge grid of labelled specimens, with type filters and a sort toggle as the primary navigation.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Layout is part of this system, not a per-page decision. Build on these tokens rather than inventing a
grid:

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1920px` | Outer content width |
| `--layout-measure` | `64ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `1px` | Space between columns |
| `--layout-margin` | `0px` | Page side margin |
| `--layout-section-y` | `clamp(16px, 2vw, 32px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `4 / 3` | Hero aspect ratio |

Zero margin and a 1px gutter: the specimen grid runs to the viewport edge and the gutter reads as a rule between cells rather than as space. The maximum is the widest in the set because an archive should show as many specimens at once as the screen allows.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `side` | `top` or `side` — whether primary navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `3` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `above` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |
| `--family-data-table-layout` | `auto` | `auto` or `fixed` — the width-allocation algorithm for full-width data tables. |

A three-column facet rail, wider than a filter strip because facets here are typed categories with counts rather than simple switches. Labels sit above their controls so long category names are not truncated. Table layout is auto: the archive's occasional detail tables hold variable-length values and should size to their content.

## Composition

Frame a light specimen grid in dark chrome. The rail, header and footer are near-black; the grid cells carry the specimen on its own ground and are separated by a single 1px gutter so the whole grid reads as one ruled sheet. Each cell is labelled underneath with a name and a mono identifier — a specimen is worthless unlabelled. Facets are typed groups with counts, and a sort toggle sits at the rail's head. Emphasis is a pill in the neutral dark with light text; no colour fill exists. The one steel accent marks the active facet and focus only.

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

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. Dark chrome frames a light specimen grid that reaches the viewport edge.
2. Cells are separated by a 1px gutter that reads as a rule, not as space.
3. Every cell is labelled with a name and a mono identifier.
4. Facets are typed groups with counts, and a sort toggle sits at the rail head.
5. No colour fill exists; the steel accent marks only the active facet and focus.
6. Radius is zero on everything except pills.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Space Grotesk; body: Space Grotesk; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below --layout-bp-md, collapse content to one column in reading order, place message before media and move any side navigation into a compact top row. Remove decorative offsets and keep tables in their own horizontal scroll region. Between medium and large breakpoints, reduce spans without changing the hierarchy. Above --layout-bp-lg, retain the full grid within --layout-max. At 200% zoom, allow labels and actions to wrap without clipping. Slides and graphics keep their fixed artboard dimensions; adapt content inside that canvas rather than applying website breakpoints to its size.
