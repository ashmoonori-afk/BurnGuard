# Field Register Theme

A record-entry system: paper-like ground, two-track label-and-field rows, and validation states that read without colour alone.

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
| `--layout-max` | `1200px` | Outer content width |
| `--layout-measure` | `68ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `16px` | Space between columns |
| `--layout-margin` | `clamp(16px, 3vw, 32px)` | Page side margin |
| `--layout-section-y` | `clamp(24px, 3vw, 48px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `5 / 1` | Hero aspect ratio |

A narrower maximum than the other systems in this family, because a record is entered one field at a time and a 1680px form is unusable. Label and field form two tracks that collapse to stacked rows below `--layout-bp-md`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `side` | `top` or `side` — whether primary navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `3` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |
| `--family-data-table-layout` | `fixed` | `auto` or `fixed` — the width-allocation algorithm for full-width data tables. |

A three-column rail carries section progress through a long record, so the operator always knows what remains. Labels sit beside their fields in a fixed track, which keeps a long form scannable as a list of answered and unanswered questions. Fixed table layout applies to the review tables that summarise a completed record.

## Composition

Set records on a paper-like warm ground with fields on white so the input surface is visibly the lighter one. Each row is a label track and a field track separated by the gutter, with a hairline under the row. Required state is marked by a word, not a colour or a symbol alone; validation messages sit under the field in 12px with an icon and text together, so state survives without colour. Section progress lives in a three-column rail. The teal accent marks focus, the primary action, and nothing else. Radius stays small at 2-4px; this is stationery, not a consumer app.

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

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. The page ground is warm and the input surfaces are lighter than it.
2. Every row is a label track plus a field track with a hairline beneath.
3. Required and invalid states are stated in words, never by colour alone.
4. A three-column rail shows section progress through the record.
5. Teal marks focus and the primary action and nothing else.
6. Radius is 2-4px and no field is elevated.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: IBM Plex Sans KR; body: IBM Plex Sans KR; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "IBM Plex Sans KR" natively, then "Pretendard"; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
