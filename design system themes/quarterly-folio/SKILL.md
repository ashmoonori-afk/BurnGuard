---
name: builtin-quarterly-folio-design
description: Use this bundled Quarterly Folio Theme theme to create token-driven interfaces and visual artifacts.
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

Open every section with a small letterspaced sans eyebrow, then a high-contrast didone display line, then a hairline rule. Body is a warm serif at a comfortable measure with indented paragraphs. The deep green accent is used sparingly — a rule under a live link, a pull quote mark, a section number. Keep margins wide enough that the content looks bound. Never use a card, a shadow or a radius; the only structural devices are the rule, the margin and the indent.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `contain` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `1 / 1` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-editorial-paragraph-mode` | `indented` | `spaced` (a `--sp-4` gap, no indent) or `indented` (1em first line, no gap, not after a heading). |

Media and text take equal tracks when paired, so neither dominates and the spread reads as a balanced opening. Images are contained. Paragraphs are indented with no gap, which is what lets long prose read as a single continuous body.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Still life and considered arrangement: objects on a surface, a detail of a material, a composed grouping. Quiet subjects that reward a long look.

**Treatment.** Large-format-feeling photography with fine tonal gradation and a slightly warm cast that sits on bone paper. Matte finish, no digital sharpening halo.

**Light.** Soft directional daylight with a long gentle falloff, as from a tall window. Shadows are present but soft-edged and warm rather than neutral.

**Framing.** Centred and calm, with air above and below so the image can be contained within the measure without crowding its caption.

**Relationship to the palette.** Warm neutrals — bone, clay, oat, faded olive — with at most one deeper note. The image should look at home on the bone page rather than pasted onto it.

**Never:**
- Cool or blue-cast images; they will fight the warm paper.
- Full-bleed treatment — images are contained within the measure.
- High-energy or motion-blurred subjects.
- Any drop shadow or frame added to the image.

**Prompt skeleton.** `large format still life photograph, objects arranged on a warm neutral surface, soft directional window light with long gentle falloff, bone and clay palette, fine tonal gradation, matte finish, centred calm composition`

## Reproducing this system

1. Outer margins are wide enough that the page reads as bound rather than filled.
2. Each section opens eyebrow, then didone display, then a hairline rule.
3. Body is a warm serif with indented, ungapped paragraphs.
4. Images are contained within the measure and captioned directly beneath.
5. The green accent appears only as a small mark, never as a filled area.
6. The only structural devices used are rule, margin and indent.

## Local typography

- Display: Bodoni Moda; body: Lora; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif text, "Pretendard" for eyebrows; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
