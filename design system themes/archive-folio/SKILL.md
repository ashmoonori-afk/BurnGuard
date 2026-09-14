---
name: builtin-archive-folio-design
description: Use this bundled Archive Folio Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference color, type, spacing, radius, elevation, and motion tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Copy fonts/ with licenses into outputs and link fonts/fonts.css; no CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Lay the page out as a catalogue. A wide image column runs beside a narrow information column of definition pairs, divided by hairline rules that continue the full height. Type is serif and small everywhere, including headings - hierarchy comes from position and rule weight, not from size jumps. Captions sit immediately under their image in the same size as body copy. No radius, no shadow, no accent fills.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max` with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by `--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

An asymmetric catalogue: an 8-column image track beside a 4-column information column of definition pairs, divided by a hairline rule that runs the full height. Captions sit directly beneath their image at body size; density is high and spacing is tight.

## Composition

Set a dense archival index on white, with a small serif used for everything — headings, entries and notes alike — so hierarchy comes from position and weight rather than from a second typeface. Entries are separated by hairline dividers with tight vertical rhythm. A running information column holds dates, references and notes alongside the entries and stays with them down the page; it is the system's defining structure and must not collapse into the main column except at the smallest width. Running text holds to a 64ch measure. Radius and elevation are absent, and colour is reserved for links and the single action.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An archival item — a document, a photograph, a print, a page — reproduced as a record of the thing rather than as a picture.

**Treatment.** Flat reproduction photography on white, square to the item, with the item's own edges, age and surface visible. No cleanup, no enhancement.

**Light.** Even copy-stand lighting with no glare and no directional shadow. Colour accurate to the original.

**Framing.** The item complete with a small white margin, aspect following the item. Placed small in the layout, since the index matters more than any one entry.

**Relationship to the palette.** White ground with the item's own aged tones — paper yellowing, ink fade, emulsion shift. The interface adds nothing.

**Never:**
- Styled or angled photography of the item.
- Digital cleanup that removes age, creases or edge wear.
- Large hero placement; entries stay small in an index.
- Added borders, shadows, or textures in the file.

**Prompt skeleton.** `flat archival reproduction photograph of a document square to the camera on white, even copy-stand lighting with no glare, item complete with small white margin, accurate aged paper and ink tones, no retouching, no styling`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the
design. Check the result against all of these:

1. A small serif carries headings, entries and notes alike; no second typeface appears.
2. Entries are separated by hairline dividers at a tight vertical rhythm.
3. A running information column of dates and references stays beside the entries.
4. That column collapses into the main column only at the smallest width.
5. Running text holds to a 64ch measure.
6. Radius and elevation are absent; colour is reserved for links and one action.

## Local typography

- Display: Newsreader; body: Newsreader; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif text, "Pretendard" for UI labels; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
