# Timber Hall Theme

An evening-interior system: dark timber ground, warm lamplight as the only colour, and full-bleed rooms with practical information set quietly beneath.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Layout is part of this system, not a per-page decision. Build on these tokens rather than inventing a
grid:

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1440px` | Outer content width |
| `--layout-measure` | `54ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `20px` | Space between columns |
| `--layout-margin` | `clamp(16px, 3vw, 48px)` | Page side margin |
| `--layout-section-y` | `clamp(64px, 9vw, 144px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `21 / 9` | Hero aspect ratio |

A panoramic 21:9 hero, because an evening room is read along its length. Sections are widely spaced so the dark ground has room to sit between them rather than reading as one continuous void.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `1.6` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-spatial-image-bleed` | `100%` | How far designated images extend from the content edge toward the viewport edge; 0% contained, 100% full-bleed. |

Full bleed at 100% with covered frames, so a lit room reaches the viewport edge and the dark page continues out of the photograph. The media track leads text at 1.6, as in the warm daylight system, because the place is still the argument.

## Composition

Build an evening interior. The ground is dark timber; the only colour in the system is lamplight amber, and it appears on links, focus and the single action. Rooms run full-bleed and panoramic, and the dark page continues out of the photograph so the seam is invisible. Statements are serif at a 54ch measure, set over the ground rather than over the image. Practical information — hours, address, the menu of the evening — sits beneath in quiet labelled columns with hairline rows. Radius is at most 2px and nothing is elevated, because lamplight already supplies all the depth the page needs.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An interior after dark — a dining room, a bar, a library, a hall lit by lamps. Empty of people, lit from within.

**Treatment.** Low-light interior photography with warm tungsten colour, deep timber and leather tones, and shadows falling to near-black at the frame edges so the image merges with the page ground.

**Light.** Practical lamps inside the frame as the only sources — table lamps, sconces, candles. Pools of warm light with real darkness between them. No fill light, no flash.

**Framing.** Panoramic 21:9 read along the length of the room, with the brightest pool of light off-centre and the frame edges falling dark.

**Relationship to the palette.** Near-black, dark timber, leather brown and a single warm amber from the lamps. No cool colour anywhere; no saturated accent objects.

**Never:**
- Bright or evenly lit interiors; the merge with the dark ground depends on falloff.
- Daylight, cool white bulbs, or mixed colour temperature.
- People, staff, or diners in frame.
- Edges that stay bright — the frame must fall dark at its borders.

**Prompt skeleton.** `low-light interior photograph of an empty dining room after dark, warm tungsten table lamps as the only light sources, pools of amber light with deep darkness between them, dark timber and leather tones, frame edges falling to near-black, panoramic 21:9, no people, no flash, no daylight`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. The ground is dark timber and lamplight amber is the only colour used.
2. Rooms run full-bleed and panoramic with edges falling dark into the page.
3. Statements are serif at a 54ch measure, set over the ground and not over the image.
4. Practical information sits beneath in quiet labelled columns with hairline rows.
5. Radius is at most 2px and nothing is elevated.
6. No image contains people or daylight.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Newsreader; body: Figtree; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below --layout-bp-md, collapse content to one column in reading order, place message before media and move any side navigation into a compact top row. Remove decorative offsets and keep tables in their own horizontal scroll region. Between medium and large breakpoints, reduce spans without changing the hierarchy. Above --layout-bp-lg, retain the full grid within --layout-max. At 200% zoom, allow labels and actions to wrap without clipping. Slides and graphics keep their fixed artboard dimensions; adapt content inside that canvas rather than applying website breakpoints to its size.
