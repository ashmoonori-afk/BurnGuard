---
name: builtin-console-ledger-design
description: Use this bundled Console Ledger Theme theme to create token-driven interfaces and visual artifacts.
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

Every number is mono with tabular figures, right-aligned, and never reflows. Rows are hairline-separated at a tight rhythm, grouped under 12px letterspaced section headers. State lives on the value, not the row: green for healthy, amber for degraded, red for failed, applied as text colour with an optional 2px left marker — never as a filled row, which destroys scanning. The summary strip at the top carries large figures with small mono captions beneath. Radius stays at 2-3px so controls read as mechanical. Nothing is elevated; depth would imply a surface that is not there.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `top` | `top` or `side` — whether primary navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `0` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |
| `--family-data-table-layout` | `fixed` | `auto` or `fixed` — the width-allocation algorithm for full-width data tables. |

Navigation sits on top so the full width belongs to the ledger; the side span is zero because no rail exists. Labels sit beside their values in the classic ledger arrangement. Fixed table layout keeps numeric columns from resizing as values update, which matters when a number changes every second.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A plotted figure rather than a photograph: a sparkline, a time series, a distribution, a status matrix. The image carries data or it does not appear.

**Treatment.** Rendered as flat vector on the page ground with hairline axes and no chart junk — no gridlines beyond the minimum, no gradients, no shadow, no 3D.

**Light.** Not applicable; this is a rendered figure, not a captured scene. Value comes from line weight and the state colours alone.

**Framing.** Wide 4:1 strips for sparklines and 16:9 at most for a full chart. Figures sit inline with the rows they describe.

**Relationship to the palette.** Page ground with the state colours only — green, amber, red — plus the steel blue for a neutral series. No decorative palette, no more than four series.

**Never:**
- Photographs of any kind; this system has no photographic surface.
- Gradients, glows, drop shadows, or 3D chart effects.
- More than four series in one figure.
- Decorative colour that does not map to a defined state.

**Prompt skeleton.** `flat vector data figure on a dark ground, hairline axes, single-weight lines, state colours green amber red plus one steel blue series, no gridlines beyond the minimum, no gradient, no shadow, wide strip aspect, maximum four series`

## Reproducing this system

1. Every number is mono, tabular, and right-aligned.
2. Rows are hairline-separated at a tight rhythm under letterspaced section headers.
3. State is applied to the value as text colour, never as a filled row.
4. A summary strip of large figures with mono captions opens the page.
5. Radius is 2-3px and nothing is elevated.
6. No photographic imagery appears anywhere.

## Local typography

- Display: Geist; body: Geist; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
