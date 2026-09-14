---
name: builtin-long-form-press-design
description: Use this bundled Long Form Press Theme theme to create token-driven interfaces and visual artifacts.
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

Set the whole system for reading. Body is serif at a generous measure with leading well above interface norms, and the eye should be able to run down the column without a single decorative interruption. Headings are the same serif at larger size, never a contrasting sans. The rust accent appears in links, drop caps and pull quotes only. Sans is reserved for captions, bylines and small navigation; mono for dates and figures. Rules are hairline and horizontal, used the way a printed page uses them. There is no card, no shadow, no radius anywhere.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `contain` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `3 / 2` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-editorial-paragraph-mode` | `indented` | `spaced` (a `--sp-4` gap, no indent) or `indented` (1em first line, no gap, not after a heading). |

Images are contained, never cropped, because in this system a photograph is a document rather than a texture. Paragraphs use a 1em first-line indent with no gap between them, except immediately after a heading or a block interruption, which is how continuous prose is set on paper.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Reportage and documentary subjects: a person at work, a place with weather in it, an object in its real context. The photograph should carry information, not mood alone.

**Treatment.** Natural-light documentary photography, film-like tonality, visible grain acceptable. True colour rather than heavy grading. Composition should survive being printed in a single column.

**Light.** Available light, whatever the scene actually has. Overcast, window light, late afternoon. Never studio-lit, never artificially separated from the background.

**Framing.** Wide enough to include context — the environment is part of the subject. A tight beauty crop is wrong for this system.

**Relationship to the palette.** Muted naturals that sit comfortably on warm paper: earth, stone, foliage, denim. Saturation restrained so the rust accent stays the strongest colour on the page.

**Never:**
- Studio seamless backgrounds or cut-out objects.
- Heavy colour grading, teal-and-orange, or filter looks.
- Stock-photo staging with models performing an emotion.
- Images cropped to a square grid cell — they are sized against the measure.

**Prompt skeleton.** `documentary photograph in available overcast light, a person working in a real environment, film-like natural colour, subtle grain, wide contextual framing, muted earth palette, no studio lighting, no staging`

## Reproducing this system

1. Body is serif and the leading is visibly looser than an interface would use.
2. Headings are the same serif family as body, differing only in size.
3. Paragraphs are indented with no gap, except after a heading.
4. Every image is either exactly the text measure or full width — never in between.
5. The accent appears only in links, drop caps and pull quotes.
6. No radius, no shadow and no card exists anywhere in the system.

## Local typography

- Display: Newsreader; body: Newsreader; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif text, "Pretendard" for captions and UI; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
