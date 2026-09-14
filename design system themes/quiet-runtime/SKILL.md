---
name: builtin-quiet-runtime-design
description: Use this bundled Quiet Runtime Theme theme to create token-driven interfaces and visual artifacts.
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

Work on warm grey rather than white — the ground should feel unlit rather than bright. Content sits on soft surfaces with a hairline edge and a moderate radius, separated by the ground itself instead of by rules. One violet carries every action and selected state; semantic colours appear only in their own chips. Type is a single humanist sans across display and body, distinguished by size and weight rather than by family. Motion is short and unshowy. Nothing should demand attention twice.

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
| `--family-ui-label-placement` | `above` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |

Navigation occupies two of the twelve columns as a side track at expanded widths and collapses to a top row below `--layout-bp-md`. Labels stack above their control so the form stays scannable in a narrow content track.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Interface fragments and soft abstract forms: a rounded panel, a stacked card edge, a gently curved surface. Objects are implied rather than photographed literally.

**Treatment.** Soft-focus 3D render or diffuse photography with matte materials. Rounded geometry, no sharp corners, no reflective surfaces. Gentle gradient across the form.

**Light.** Large diffuse source, wraparound, almost no visible shadow edge. Overcast-window quality.

**Framing.** Loose and centred with comfortable margin. The form should feel placed, not cropped.

**Relationship to the palette.** Warm greys matching the page ground, with a single muted violet passage echoing `--primary-blue`. Saturation stays low throughout.

**Never:**
- High-contrast or neon renders — this system's whole point is low arousal.
- Sharp geometric edges or hard specular highlights.
- Literal screenshots of other products.
- Busy compositions with many competing forms.

**Prompt skeleton.** `soft matte 3D render of rounded abstract interface surfaces, warm grey palette with one muted violet passage, large diffuse light, no hard shadows, low saturation, generous margin, calm composition`

## Reproducing this system

1. The ground is warm grey, not white, and surfaces are lighter than the ground.
2. Separation comes from the ground showing between surfaces, not from rules.
3. One violet carries every action and selected state.
4. Display and body are the same family, separated only by size and weight.
5. Radius is consistently soft (6-16px) and applied to every surface.
6. Nothing on the page is high-contrast enough to demand attention twice.

## Local typography

- Display: Manrope; body: Manrope; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
