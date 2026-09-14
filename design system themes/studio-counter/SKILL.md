---
name: builtin-studio-counter-design
description: Use this bundled Studio Counter Theme theme to create token-driven interfaces and visual artifacts.
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

Let photography be the page. Products fill nearly the full width in tight pairs with an 8px gutter, and the ground shows only as a hairline between them. Set the brand line oversized and let it cross the imagery rather than sit above it — overlap is the signature, not an accident. Keep every piece of chrome small: navigation, search, account and cart sit at the extreme corners in 11px type. Emphasis comes from scale contrast, never from a coloured button; the primary action is bone-on-black or black-on-bone. Radius stays at or below 2px.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-commerce-gallery-layout` | `paired` | `stacked`, `paired`, or `lead-and-pairs` — the repeating placement pattern of a product gallery. |
| `--family-commerce-purchase-position` | `sticky` | `flow` or `sticky` — whether the purchase panel scrolls with content or pins inside its section. |

Products run in equal pairs so the eye compares rather than scans. Images cover their frame; the crop is part of the merchandising. The purchase panel pins within its product section and returns to flow below `--layout-bp-md` — it never becomes a floating duplicate bar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single garment or object on a body or a form, shot in a studio. The product is the whole subject; no environment, no narrative scene.

**Treatment.** Studio product photography on a mid-grey or charcoal seamless, matching the page ground closely enough that the frame edge is the only boundary. Matte, true-to-material colour, fine fabric or surface detail preserved.

**Light.** Controlled studio light with soft modelling — enough shadow to describe form and material, never flat, never dramatic. Keep the background falling darker than the subject.

**Framing.** Vertical 4:5, subject centred and cropped decisively at the frame edge. Composition must survive a cover crop and pair cleanly with a second image beside it.

**Relationship to the palette.** Charcoal to near-black surroundings with the product's own material colour as the only chroma. Consecutive images in a pair should agree tonally so the row reads as one field.

**Never:**
- White or bright seamless backgrounds; they tear a hole in the dark page.
- Lifestyle scenes, locations, or props competing with the product.
- Visible logos, tags, or readable brand marks.
- Heavy retouching gloss or plastic-looking skin and fabric.

**Prompt skeleton.** `studio product photograph on charcoal seamless background, single garment on a form, soft controlled modelling light, matte true-to-material colour, fine fabric detail, vertical 4:5 crop, background darker than subject, no logos, no props`

## Reproducing this system

1. Imagery reaches nearly to the viewport edge; margins and gutters are visibly tiny.
2. Products appear in equal pairs, not in a three or four column grid.
3. The brand line overlaps imagery rather than sitting above it.
4. All navigation and purchase chrome is the smallest type on the page.
5. The primary action is achromatic — no coloured button exists.
6. Image backgrounds are dark enough to merge with the page ground.

## Local typography

- Display: Public Sans; body: Public Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Layout, Composition and Responsive in README.md and apply the --layout-* and --family-* tokens from colors_and_type.css before arranging content. Preserve the grid, reading measure, section rhythm, hero geometry and navigation placement; a palette/font swap on a generic layout is incomplete. Direction variants may change content emphasis, but must retain this structure unless the user explicitly overrides it. Check the rendered result at wide and narrow viewports and 200% zoom; fixed artboards retain their dimensions.
