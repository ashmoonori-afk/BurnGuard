# Console Ledger Theme

An operations ledger: dark ground, mono numerals everywhere, and state carried by a narrow colour set that only ever appears on values.

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
| `--layout-max` | `1560px` | Outer content width |
| `--layout-measure` | `66ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `12px` | Space between columns |
| `--layout-margin` | `clamp(12px, 2vw, 24px)` | Page side margin |
| `--layout-section-y` | `clamp(16px, 2vw, 32px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `4 / 1` | Hero aspect ratio |

Tight gutters and tight sections, because an operator reads many rows at once and scrolling costs attention. The hero is a 4:1 strip reserved for a summary band of figures, not for imagery.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `top` | `top` or `side` — whether primary navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `0` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |
| `--family-data-table-layout` | `fixed` | `auto` or `fixed` — the width-allocation algorithm for full-width data tables. |

Navigation sits on top so the full width belongs to the ledger; the side span is zero because no rail exists. Labels sit beside their values in the classic ledger arrangement. Fixed table layout keeps numeric columns from resizing as values update, which matters when a number changes every second.

## Composition

Every number is mono with tabular figures, right-aligned, and never reflows. Rows are hairline-separated at a tight rhythm, grouped under 12px letterspaced section headers. State lives on the value, not the row: green for healthy, amber for degraded, red for failed, applied as text colour with an optional 2px left marker — never as a filled row, which destroys scanning. The summary strip at the top carries large figures with small mono captions beneath. Radius stays at 2-3px so controls read as mechanical. Nothing is elevated; depth would imply a surface that is not there.

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

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. Every number is mono, tabular, and right-aligned.
2. Rows are hairline-separated at a tight rhythm under letterspaced section headers.
3. State is applied to the value as text colour, never as a filled row.
4. A summary strip of large figures with mono captions opens the page.
5. Radius is 2-3px and nothing is elevated.
6. No photographic imagery appears anywhere.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Geist; body: Geist; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
