---
name: builtin-daylight-press-design
description: Use this bundled Daylight Press Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference color, type, spacing, radius, elevation, and motion tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Copy fonts/ with licenses into outputs and link fonts/fonts.css; no CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Work on warm off-white paper with generous air. Headlines are lowercase in the rounded display face; body copy stays comfortable rather than dense. Exactly one buttercup accent carries the primary action as a full pill with dark text on it. Photography is soft and daylit and may run full-bleed behind lowercase type.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max` with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by `--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

Generous single-column flow with wide side margins; two-up image pairs at most. Vertical rhythm is deliberately large so the page breathes, and the primary action sits alone on its own line.

## Composition

Set everything on warm off-white paper with one buttercup accent reserved for the primary action and the active state. The display face is soft and lowercase — no uppercase display line exists in this system — and it sits at a friendly rather than a monumental scale. Body copy runs to a comfortable 62ch measure with generous leading. Actions are fully rounded pills, which is the only place roundness appears at that strength; cards and images take a smaller radius. Dividers are hairlines in a warm grey. The page should read as approachable and printed rather than engineered.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Everyday life at close range — hands at work, a table, a walk, an ordinary object in use. Warm and unremarkable by design.

**Treatment.** Natural photography with warm colour, gentle contrast, and film-like softness. Nothing clinical, nothing dramatic.

**Light.** Soft diffused daylight, slightly overexposed toward the highlights so the frame sits comfortably on the warm paper.

**Framing.** Landscape or square with the subject close and a relaxed composition. Small radius applied at display time, never baked into the file.

**Relationship to the palette.** Warm off-white, buttercup, straw and soft neutrals. Any strong colour in frame should be warm.

**Never:**
- Cool or blue-grey grading; it turns the paper grey.
- Hard shadows, heavy contrast, or dramatic light.
- Corporate or stock-looking staged scenes.
- Baked-in rounded corners or borders in the image file.

**Prompt skeleton.** `natural photograph of an everyday close-range moment, soft diffused daylight lifted toward the highlights, warm gentle contrast, film-like softness, relaxed composition, warm straw and off-white palette, no drama`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the
design. Check the result against all of these:

1. The ground is warm off-white and buttercup appears only on the primary action and active state.
2. The display face is lowercase throughout; no uppercase display line exists.
3. Body copy runs to a 62ch measure with generous leading.
4. Actions are fully rounded pills; cards and images take a smaller radius.
5. Dividers are hairlines in warm grey.
6. Imagery is warm, soft and lifted toward the highlights.

## Local typography

- Display: Outfit; body: DM Sans; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Pretendard" for display and body, "Gowun Batang" for serif; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
