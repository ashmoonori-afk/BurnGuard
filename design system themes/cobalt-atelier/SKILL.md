---
name: builtin-cobalt-atelier-design
description: Use this bundled Cobalt Atelier Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference color, type, spacing, radius, elevation, and motion tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Copy fonts/ with licenses into outputs and link fonts/fonts.css; no CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Flood a full-bleed cobalt field and let one light-weight serif headline sit in it with real air around it. Label everything else with small uppercase mono eyebrows on `--bg-muted` chips. Interactive elements are hard rectangles or pills in near-black with warm gold text, never soft cards. Separate regions with single hairline rules at `--border`, not with panels or shadows.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max` with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by `--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

Hold a single wide column for the headline and let supporting blocks occupy 5 of the 12 columns, offset rather than centred. Hairline rules at --layout-rule mark section boundaries; never box a section in a card.

## Composition

Flood the page with the cobalt field and let it carry the whole composition — it is the ground, not an accent, and no second large colour is introduced. A light serif display sits directly on the field at generous size with tight leading, and body copy holds to a 58ch measure so the field stays visible around it. Every label, caption and figure mark is mono, small, and uppercase, which is the only texture the page gets. Interactive elements are near-square blocks — the small `--r-*` steps, never a pill — and carry no shadow, so they read as cut apertures in the field rather than as raised controls. Imagery is inset into the field with a visible border of cobalt on all sides.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single subject isolated against a plain ground — an object, a figure, a material study. One idea per frame, no scene.

**Treatment.** High-contrast photography with the subject cleanly separated from its background, so it can be inset into a saturated field without the two fighting. Cool colour bias throughout.

**Light.** Directional light with a firm shadow edge. Contrast is high, midtones are few, and the result reads graphic rather than atmospheric.

**Framing.** Portrait or square, subject centred with even margin, so the surrounding cobalt border stays equal on all sides.

**Relationship to the palette.** Cool neutrals and steel tones so the image sits inside the cobalt field rather than clashing with it. Warm subjects must be graded cool.

**Never:**
- Warm golden or amber grading; it fights the field.
- Busy backgrounds that break the inset border's rhythm.
- Soft, low-contrast, or hazy treatments.
- Bleeding the image to the viewport edge; the field must surround it.

**Prompt skeleton.** `high-contrast photograph of a single isolated subject on a plain cool ground, directional light with a firm shadow edge, cool steel colour bias, subject centred with even margin, graphic rather than atmospheric, portrait crop`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the
design. Check the result against all of these:

1. The cobalt field is the page ground, not an accent, and no second large colour appears.
2. A light serif display sits directly on the field at generous size with tight leading.
3. All labels and captions are small uppercase mono.
4. Interactive elements are near-square blocks at the small `--r-*` steps, never pills, and none is elevated.
5. Images are inset with an equal cobalt border on all sides and never bleed.
6. Body copy holds to a 58ch measure so the field stays visible around it.

## Local typography

- Display: Instrument Serif; body: Instrument Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Gowun Batang", "Pretendard" for serif headings, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Layout, Composition and Responsive in README.md and apply the --layout-* and --family-* tokens from colors_and_type.css before arranging content. Preserve the grid, reading measure, section rhythm, hero geometry and navigation placement; a palette/font swap on a generic layout is incomplete. Direction variants may change content emphasis, but must retain this structure unless the user explicitly overrides it. Check the rendered result at wide and narrow viewports and 200% zoom; fixed artboards retain their dimensions.
