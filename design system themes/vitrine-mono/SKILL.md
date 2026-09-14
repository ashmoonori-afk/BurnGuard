---
name: builtin-vitrine-mono-design
description: Use this bundled Vitrine Mono Theme theme to create token-driven interfaces and visual artifacts.
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

Present goods as exhibits. The page is a grid of ruled cells with no gutter and no gap; borders are shared, so the whole surface is one case. Inside each cell: the object contained on the achromatic ground, then its specifications in mono as label and value pairs — material, dimension, origin, price. No colour is used for emphasis at all; emphasis is position and rule weight. The primary action is a black block with bone type. Radius is zero everywhere.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `contain` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-commerce-gallery-layout` | `paired` | `stacked`, `paired`, or `lead-and-pairs` — the repeating placement pattern of a product gallery. |
| `--family-commerce-purchase-position` | `flow` | `flow` or `sticky` — whether the purchase panel scrolls with content or pins inside its section. |

Paired cells let two exhibits be compared directly, which is the point of a case. Images are contained so the object is documented rather than cropped for effect. The purchase control sits in flow at the end of the specification list, treated as one more field.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single object documented straight on or in strict profile, as a museum record shot. Tools, hardware, ceramics, instruments — objects with describable specifications.

**Treatment.** Flat, even record photography on a light achromatic ground matching the page. No styling, no atmosphere, no artful angle. The object is being catalogued.

**Light.** Completely even and shadowless, or with a single faint contact shadow. Nothing dramatic; legibility of form and material is the only goal.

**Framing.** Square 1:1, object centred with equal margin on all sides, orthographic where possible so proportions read true.

**Relationship to the palette.** Achromatic ground with the object's true material colour. Grey, bone, steel, unglazed clay. Any saturated colour must come from the object itself.

**Never:**
- Angled hero shots or perspective drama — these are record images.
- Coloured or gradient backdrops.
- Props, hands, styling surfaces, or context of any kind.
- Cropping the object; it must be fully contained with even margin.

**Prompt skeleton.** `flat museum record photograph of a single object, centred with equal margin on a light achromatic seamless background, completely even shadowless lighting, orthographic straight-on view, true material colour, square 1:1, no styling, no props`

## Reproducing this system

1. The page is one continuous case: zero gutter, shared 1px borders meeting exactly.
2. Every cell carries the object plus mono label-and-value specifications.
3. No colour is used for emphasis anywhere; emphasis is position and rule weight.
4. The primary action is a black block with bone type.
5. Objects are contained with even margin, never cropped.
6. Radius is zero and no element is elevated.

## Local typography

- Display: Geist; body: Geist; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Layout, Composition and Responsive in README.md and apply the --layout-* and --family-* tokens from colors_and_type.css before arranging content. Preserve the grid, reading measure, section rhythm, hero geometry and navigation placement; a palette/font swap on a generic layout is incomplete. Direction variants may change content emphasis, but must retain this structure unless the user explicitly overrides it. Check the rendered result at wide and narrow viewports and 200% zoom; fixed artboards retain their dimensions.
