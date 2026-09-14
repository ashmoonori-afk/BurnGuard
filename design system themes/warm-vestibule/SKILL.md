---
name: builtin-warm-vestibule-design
description: Use this bundled Warm Vestibule Theme theme to create token-driven interfaces and visual artifacts.
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

Let the photograph set the palette — putty, timber, clay, olive — and keep every token in the interface a neutral drawn from that range. Open with a full-bleed interior. Below it, a calm band at the content maximum carries one large grotesque statement at a 56ch measure, then practical columns: opening times, address, how to visit, set as plain labelled lists with hairlines between rows. Nothing is rounded, nothing is elevated, and no button is coloured except the single clay action. Small letterspaced eyebrows label sections. The system sells nothing: there is no price, no cart, no offer.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `1.6` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-spatial-image-bleed` | `100%` | How far designated images extend from the content edge toward the viewport edge; 0% contained, 100% full-bleed. |

Imagery covers its frame and bleeds the full 100% to the viewport edge, because a room has no margin. In side-by-side sections the media track is 1.6 times the text track: the place leads and the writing accompanies it.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An interior or an architectural space with no people in it — a room, a corridor, a courtyard, a corner with furniture and light. The space is the subject.

**Treatment.** Natural architectural photography with true verticals, warm neutral colour, and visible material texture: timber grain, brick, plaster, textile, worn floor. Unstyled and lived-in rather than staged.

**Light.** Daylight from a window or an opening, warm and directional, with soft shadows describing depth. Time of day should read as late morning or afternoon.

**Framing.** Wide 16:9 with a clear depth cue — a doorway, a receding wall, a foreground object — so the room reads as space and not as a flat surface. Verticals must be straight.

**Relationship to the palette.** Putty, timber, clay, charcoal and olive drawn from the real materials in frame. The interface palette is taken from the photograph, so the photograph must be warm and neutral.

**Never:**
- People in frame; this system shows places, not occupants.
- Cool blue-white or fluorescent colour casts that fight the warm ground.
- Tilted verticals or wide-angle distortion.
- Over-styled staging — a magazine set with props arranged for the camera.

**Prompt skeleton.** `architectural interior photograph of an empty lived-in room, warm directional daylight from a window, true straight verticals, visible timber brick and plaster texture, warm neutral colour, clear depth cue through a doorway, wide 16:9, no people, no staging`

## Reproducing this system

1. The first element is a full-bleed interior photograph with no people in it.
2. Interface colours are neutrals drawn from that photograph's material range.
3. A calm band follows with one grotesque statement at a 56ch measure.
4. Practical information appears as plain labelled columns with hairline rows.
5. Only one clay action exists; nothing else is coloured, rounded or elevated.
6. No price, cart, or offer appears anywhere.

## Local typography

- Display: Public Sans; body: Public Sans; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Layout, Composition and Responsive in README.md and apply the --layout-* and --family-* tokens from colors_and_type.css before arranging content. Preserve the grid, reading measure, section rhythm, hero geometry and navigation placement; a palette/font swap on a generic layout is incomplete. Direction variants may change content emphasis, but must retain this structure unless the user explicitly overrides it. Check the rendered result at wide and narrow viewports and 200% zoom; fixed artboards retain their dimensions.
