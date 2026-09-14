# Archive Folio Theme

A dense archival index on white: small serif throughout, hairline dividers, and a running information column.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Layout

Layout is part of this system, not a per-page decision. Build every artifact on these tokens rather than inventing a grid:

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | 1440px | Outer content width |
| `--layout-measure` | 64ch | Reading measure for body copy |
| `--layout-columns` | 12 | Base column count |
| `--layout-gutter` | 20px | Space between columns |
| `--layout-margin` | 16px | Page side margin |
| `--layout-section-y` | clamp(28px, 3vw, 48px) | Vertical rhythm between sections |
| `--layout-rule` | 1px | Divider weight |
| `--layout-bp-md` / `--layout-bp-lg` | 840px / 1200px | Breakpoints |
| `--layout-hero` | 4 / 5 | Hero aspect ratio |

An asymmetric catalogue: an 8-column image track beside a 4-column information column of definition pairs, divided by a hairline rule that runs the full height. Captions sit directly beneath their image at body size; density is high and spacing is tight.

## Composition

Set a dense archival index on white, with a small serif used for everything — headings, entries and notes alike — so hierarchy comes from position and weight rather than from a second typeface. Entries are separated by hairline dividers with tight vertical rhythm. A running information column holds dates, references and notes alongside the entries and stays with them down the page; it is the system's defining structure and must not collapse into the main column except at the smallest width. Running text holds to a 64ch measure. Radius is zero on every surface and elevation is absent; colour is reserved for links and the single action.

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
6. Radius is zero on every surface and elevation is absent; colour is reserved for links and one action.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, and shape rules were composed for this theme; no third-party theme, stylesheet, palette, or asset is included, and it carries no external license obligation.

## Local typography

- Display: Newsreader; body: Newsreader; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif text, "Pretendard" for UI labels; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below --layout-bp-md, collapse content to one column in reading order, place message before media and move any side navigation into a compact top row. Remove decorative offsets and keep tables in their own horizontal scroll region. Between medium and large breakpoints, reduce spans without changing the hierarchy. Above --layout-bp-lg, retain the full grid within --layout-max. At 200% zoom, allow labels and actions to wrap without clipping. Slides and graphics keep their fixed artboard dimensions; adapt content inside that canvas rather than applying website breakpoints to its size.
