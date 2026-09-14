---
name: builtin-field-register-design
description: Use this bundled Field Register Theme theme to create token-driven interfaces and visual artifacts.
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

Set records on a paper-like warm ground with fields on white so the input surface is visibly the lighter one. Each row is a label track and a field track separated by the gutter, with a hairline under the row. Required state is marked by a word, not a colour or a symbol alone; validation messages sit under the field in 12px with an icon and text together, so state survives without colour. Section progress lives in a three-column rail. The teal accent marks focus, the primary action, and nothing else. Radius stays small at 2-4px; this is stationery, not a consumer app.

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
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |
| `--family-data-table-layout` | `fixed` | `auto` or `fixed` — the width-allocation algorithm for full-width data tables. |

A three-column rail carries section progress through a long record, so the operator always knows what remains. Labels sit beside their fields in a fixed track, which keeps a long form scannable as a list of answered and unanswered questions. Fixed table layout applies to the review tables that summarise a completed record.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Documentary reference attached to a record — a site photograph, a scanned form, a condition shot. Evidence, not illustration.

**Treatment.** Plain documentary capture with no styling or grading. It should look like it was taken to prove something, because that is its role in the record.

**Light.** Available light, even and honest. Correct exposure matters; atmosphere does not.

**Framing.** Wide 5:1 strips for banner context and 4:3 for attached evidence, always contained with a hairline border rather than bled.

**Relationship to the palette.** Muted and natural, with the warm paper ground surrounding it. Nothing saturated enough to compete with the validation colours.

**Never:**
- Stylised, graded, or staged photography — it undermines the evidentiary role.
- Full-bleed placement; evidence is always contained inside a bordered frame.
- Saturated colour that could be mistaken for a validation state.
- Decorative stock imagery with no relationship to the record.

**Prompt skeleton.** `plain documentary photograph as record evidence, available even light, correct honest exposure, muted natural colour, contained framing with clear subject, no styling, no grading, no staging`

## Reproducing this system

1. The page ground is warm and the input surfaces are lighter than it.
2. Every row is a label track plus a field track with a hairline beneath.
3. Required and invalid states are stated in words, never by colour alone.
4. A three-column rail shows section progress through the record.
5. Teal marks focus and the primary action and nothing else.
6. Radius is 2-4px and no field is elevated.

## Local typography

- Display: IBM Plex Sans KR; body: IBM Plex Sans KR; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "IBM Plex Sans KR" natively, then "Pretendard"; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Layout, Composition and Responsive in README.md and apply the --layout-* and --family-* tokens from colors_and_type.css before arranging content. Preserve the grid, reading measure, section rhythm, hero geometry and navigation placement; a palette/font swap on a generic layout is incomplete. Direction variants may change content emphasis, but must retain this structure unless the user explicitly overrides it. Check the rendered result at wide and narrow viewports and 200% zoom; fixed artboards retain their dimensions.
