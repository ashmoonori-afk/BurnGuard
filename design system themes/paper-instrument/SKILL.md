---
name: builtin-paper-instrument-design
description: Use this bundled Paper Instrument Theme theme to create token-driven interfaces and visual artifacts.
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

Start from bright paper and remove until only structure is left. Hierarchy comes from scale and position, not from weight or colour — one large statement, one measure of body, and generous emptiness between them. The ink-blue marks action and nothing else: links, the primary control, focus. Rules are hairline and full-bleed within their section. Avoid filled panels; where a region needs separation, use a rule or a change of measure. Radius stays at or below 4px, and elevation is not used at all.

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

Navigation is a quiet top row with a hairline beneath it. Labels sit beside their control in a second track, which suits specification-style forms where the label is read as a field name rather than a prompt.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single manufactured object or instrument on a plain seamless surface — a measuring tool, a component, a clean product form. One object, centred or on a clear axis.

**Treatment.** Bright, even, near-shadowless product photography. Pure white or bone seamless background that merges with the page ground. Crisp edges, true colour, no texture overlay.

**Light.** Broad soft daylight from the front-top, almost flat, with only the faintest contact shadow to seat the object. No dramatic modelling.

**Framing.** Generous empty margin around the subject — the object should occupy roughly a third of the frame. The emptiness is the composition.

**Relationship to the palette.** Achromatic: paper white, light greys, the object's own neutral material. If one accent appears it is the same ink-blue as `--primary-blue`, and only as a small detail.

**Never:**
- Dark or coloured backdrops — the image must merge into the paper ground.
- Hard directional shadows, dramatic contrast, or moody grading.
- Cluttered arrangements, props, hands, or lifestyle staging.
- Gradient meshes or abstract 3D blobs.

**Prompt skeleton.** `product photograph of a single precision instrument on a seamless white background, soft even frontal daylight, minimal contact shadow, generous empty space around the subject, achromatic palette, sharp edges, no props`

## Reproducing this system

1. The page ground and the imagery background are the same value, so images sit in the page rather than on it.
2. Exactly one hue appears as action colour; everything else is achromatic.
3. Body copy never exceeds `--layout-measure`, even in a wide container.
4. Section spacing is visibly larger than the content requires.
5. No filled panel, no shadow, and no radius above 4px anywhere.
6. Hierarchy survives if colour is removed entirely.

## Local typography

- Display: Instrument Sans; body: Instrument Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
