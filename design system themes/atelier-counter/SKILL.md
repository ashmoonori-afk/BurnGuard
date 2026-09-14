---
name: builtin-atelier-counter-design
description: Use this bundled Atelier Counter Theme theme to create token-driven interfaces and visual artifacts.
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

Work on warm bone paper with a didone brand voice reserved for the name and section openings, and a humanist sans for everything read at length. Product plates are contained on the paper with generous surrounding space. The oxblood accent marks price emphasis, sale state and the primary action, and appears nowhere else. Small letterspaced eyebrows label categories. Rules are hairline; nothing is rounded, nothing is elevated. Restraint is the merchandising strategy: one strong image, one clear price, one action.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `contain` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-commerce-gallery-layout` | `lead-and-pairs` | `stacked`, `paired`, or `lead-and-pairs` — the repeating placement pattern of a product gallery. |
| `--family-commerce-purchase-position` | `flow` | `flow` or `sticky` — whether the purchase panel scrolls with content or pins inside its section. |

The gallery opens with one full-width lead plate and continues in pairs, which gives a product page an opening statement before its detail. Images are contained so the whole object stays visible — in this system the product's silhouette is the selling point. The purchase panel stays in flow so the page reads as a description rather than a conversion funnel.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single object presented whole — a garment laid flat, a bag upright, a shoe in profile, an accessory arranged. The complete silhouette must be visible.

**Treatment.** Bright even product photography on a bone or oat seamless that matches the page ground, so the object appears to rest on the paper. Accurate material colour, visible texture, no gloss.

**Light.** Broad soft frontal daylight with a faint contact shadow to seat the object. Almost no modelling; the silhouette matters more than the volume.

**Framing.** Vertical 4:5 with comfortable margin inside the frame — the object never touches the frame edge, because it is contained rather than cropped.

**Relationship to the palette.** Bone and oat surroundings with the product's own colour as the single chroma. Warm cast throughout so it sits on the warm page.

**Never:**
- Cropping the object at the frame edge; the whole silhouette must read.
- Cool grey or white-blue seamless that fights the warm paper.
- Models posing in a scene — this system presents goods, not lifestyle.
- Drop shadows or reflections added in post.

**Prompt skeleton.** `product photograph of a single object presented whole on a bone seamless background, broad soft frontal daylight, faint contact shadow, complete silhouette visible with margin inside the frame, warm accurate material colour, vertical 4:5, no crop, no gloss`

## Reproducing this system

1. Products are contained plates with generous space, never bleeding to the edge.
2. The gallery opens with one lead image and continues in pairs.
3. Didone is used only for the brand name and section openings; body is sans.
4. The oxblood accent appears only on price emphasis and the primary action.
5. The purchase panel sits in the flow of the column and never pins.
6. Nothing is rounded and nothing carries a shadow.

## Local typography

- Display: Bodoni Moda; body: Figtree; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
