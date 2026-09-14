---
name: builtin-wide-gutter-review-design
description: Use this bundled Wide Gutter Review Theme theme to create token-driven interfaces and visual artifacts.
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

Run a narrow sans text spine down one side and a tall image plate down the other, and keep the wide gutter empty — resist filling it. Display is a high-contrast serif used at large size for titles only; body is sans at a narrow measure so the column reads quickly. The blue is used once per view, on the live link or the current item. Captions sit tight under their plate in mono at small size. Nothing is rounded and nothing is elevated; the page is flat and the structure is entirely positional.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `2 / 1` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-editorial-paragraph-mode` | `spaced` | `spaced` (a `--sp-4` gap, no indent) or `indented` (1em first line, no gap, not after a heading). |

The image track is twice the text track, gutter excluded. Images cover their frame because in this system the image is a plate at a fixed proportion, and the crop is part of the edit. Paragraphs are spaced by `--sp-4` with no indent, matching the sans body.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single considered subject per plate — a garment, an interior, an artwork, a portrait. One idea per image, presented as a plate rather than a snapshot.

**Treatment.** Editorial photography with deliberate art direction. Clean, decisive, high resolution. The crop is part of the composition, so images are made to be cropped to a tall frame.

**Light.** Controlled and directional, with real shadow shape. Studio or strong window light. Shadows are allowed to be dark.

**Framing.** Portrait orientation at roughly 4:5, composed so the subject survives a cover crop. Leave no important detail at the frame edge.

**Relationship to the palette.** White, black and one material colour per plate. The page is white, so images should not also be white-dominant or they will dissolve into the ground.

**Never:**
- Landscape-orientation images — the plate is vertical by design.
- Busy multi-subject scenes that fight the narrow text track.
- Pale, low-contrast images that disappear against white paper.
- Adding a border or shadow to seat the image; it sits directly on the ground.

**Prompt skeleton.** `editorial photograph, single subject, portrait 4:5 orientation, controlled directional light with defined shadows, one strong material colour against neutral surroundings, decisive crop, high resolution, no border`

## Reproducing this system

1. Text and image occupy separate tracks with a visibly wide empty gutter between them.
2. The text measure is narrow — noticeably narrower than a normal article column.
3. Display is serif; body is sans. They never swap roles.
4. Images are vertical plates that cover their frame, sitting directly on white.
5. The accent colour appears once per view at most.
6. The layout is flat: no radius, no shadow, no container.

## Local typography

- Display: Instrument Serif; body: Public Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
