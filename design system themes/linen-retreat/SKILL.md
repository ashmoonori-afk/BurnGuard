---
name: builtin-linen-retreat-design
description: Use this bundled Linen Retreat Theme theme to create token-driven interfaces and visual artifacts.
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

Set a linen ground with a high-contrast serif for display and a neutral geometric sans for reading. Imagery covers its frame and bleeds partway, always leaving a visible margin at the viewport edge. Eyebrows are small, heavily letterspaced, and uppercase; statements are serif at a 58ch measure with generous leading. Practical information — rooms, rates, arrival, what is nearby — is set as labelled columns with hairline rows, plain and unsold. The tan accent carries links and the single booking action. Radius is small but present at 2-6px, which is the only softness in the set.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `1.3` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-spatial-image-bleed` | `60%` | How far designated images extend from the content edge toward the viewport edge; 0% contained, 100% full-bleed. |

Imagery extends 60% of the way from the content edge toward the viewport edge — neither contained nor full-bleed. That halfway state is the system's signature: the page feels held rather than open. Media leads text slightly at 1.3.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A detail of a stay rather than a whole room — a made bed corner, a linen curtain in light, a table set for one, a bath, a view through a window. Intimate scale.

**Treatment.** Natural hospitality photography with soft warm colour, visible textile texture, and shallow depth so one element is sharp and the rest falls away. Unstyled and calm.

**Light.** Soft warm window light, early or late, with gentle gradation across the frame. Never flat, never contrasty.

**Framing.** Standard 4:3, subject slightly off-centre with negative space on one side so type can sit beside it, and a crop that implies more room outside the frame.

**Relationship to the palette.** Linen, oat, tan, sage and warm shadow. Muted throughout; the strongest colour in frame should still be a neutral.

**Never:**
- Wide empty hotel-room shots that look like a booking listing.
- People posing, or staff in frame.
- Cool or clinical colour; the system depends on warmth.
- Hard flash, heavy contrast, or saturated accent objects.

**Prompt skeleton.** `intimate hospitality detail photograph, corner of a made bed with linen texture in soft warm window light, shallow depth of field, muted oat and tan palette, gentle gradation across the frame, subject off-centre with negative space, 4:3, no people, no staging`

## Reproducing this system

1. The ground is warm linen and the display voice is a high-contrast serif.
2. Imagery bleeds partway and always leaves a visible margin at the viewport edge.
3. Eyebrows are uppercase, small and heavily letterspaced.
4. Practical information is labelled columns with hairline rows and no sales language.
5. Tan carries links and one booking action; nothing else is coloured.
6. Radius is small but present at 2-6px, and nothing is elevated.

## Local typography

- Display: Playfair Display; body: DM Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Gowun Batang" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
