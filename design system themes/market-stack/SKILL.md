---
name: builtin-market-stack-design
description: Use this bundled Market Stack Theme theme to create token-driven interfaces and visual artifacts.
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

Keep the page bright and the shapes soft and large. Product plates are square with a generous radius, and the ground is warm white. Price is set in the display face at a size close to the product title — in this system the number is a headline, not a footnote. The orange carries the primary action and sale state; the blue carries links and focus; the yellow is a badge fill only. Type is heavy where it matters and plain everywhere else. Motion is short and slightly springy.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-commerce-gallery-layout` | `stacked` | `stacked`, `paired`, or `lead-and-pairs` — the repeating placement pattern of a product gallery. |
| `--family-commerce-purchase-position` | `sticky` | `flow` or `sticky` — whether the purchase panel scrolls with content or pins inside its section. |

A stacked gallery keeps one product in view at a time at full attention. The purchase panel sticks within its section so price and action stay reachable through a long scroll, dropping back to flow below `--layout-bp-md`.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** One product, straight on, filling its square frame. Everyday desirable goods rather than luxury objects — food, tools, homeware, apparel shot cheerfully.

**Treatment.** Bright saturated product photography with clean edges and a coloured or warm-white backdrop. Punchy but true colour; the image should feel energetic rather than precious.

**Light.** Even and bright with a soft shadow under the object. High key overall; no deep shadows anywhere in frame.

**Framing.** Square 1:1, subject large and centred, filling most of the frame with a small consistent margin so a grid of them reads evenly.

**Relationship to the palette.** Warm white or a single flat saturated backdrop drawn from the accent set. One product colour plus the backdrop; avoid multi-colour clutter.

**Never:**
- Dark, moody, or low-key treatments — they kill the system's energy.
- Non-square crops; the stack depends on a consistent square rhythm.
- Busy scenes with multiple products fighting for attention.
- Muted or desaturated grading.

**Prompt skeleton.** `bright product photograph, single everyday object centred and filling a square 1:1 frame, flat warm-white or saturated backdrop, even high-key lighting with a soft contact shadow, punchy true colour, small consistent margin, no clutter`

## Reproducing this system

1. The ground is warm white and every plate is square with a generous radius.
2. Price is set at a scale close to the product title, in the display face.
3. Orange is action and sale; blue is link and focus; yellow is badge fill only.
4. Products stack one per row rather than sitting in a dense grid.
5. The purchase panel sticks within its section on wide screens.
6. Rules are 2px — visibly heavier than a hairline system.

## Local typography

- Display: Outfit; body: Plus Jakarta Sans; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
