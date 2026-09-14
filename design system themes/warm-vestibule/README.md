# Warm Vestibule Theme

A place system: a full-bleed interior supplies the palette, then a calm white band carries one grotesque statement and plain visiting columns.

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
| `--layout-max` | `1360px` | Outer content width |
| `--layout-measure` | `56ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `24px` | Space between columns |
| `--layout-margin` | `clamp(20px, 4vw, 56px)` | Page side margin |
| `--layout-section-y` | `clamp(56px, 8vw, 128px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `16 / 9` | Hero aspect ratio |

A wide 16:9 hero that bleeds fully, followed by a calm band at the content maximum. Sections are generously spaced so the page breathes the way a room does.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `1.6` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-spatial-image-bleed` | `100%` | How far designated images extend from the content edge toward the viewport edge; 0% contained, 100% full-bleed. |

Imagery covers its frame and bleeds the full 100% to the viewport edge, because a room has no margin. In side-by-side sections the media track is 1.6 times the text track: the place leads and the writing accompanies it.

## Composition

Let the photograph set the palette — putty, timber, clay, olive — and keep every token in the interface a neutral drawn from that range. Open with a full-bleed interior. Below it, a calm band at the content maximum carries one large grotesque statement at a 56ch measure, then practical columns: opening times, address, how to visit, set as plain labelled lists with hairlines between rows. Nothing is rounded, nothing is elevated, and no button is coloured except the single clay action. Small letterspaced eyebrows label sections. The system sells nothing: there is no price, no cart, no offer.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An interior or an architectural space with no people in it — a room, a corridor, a courtyard, a corner with furniture and light. The space is the subject.

**Treatment.** Natural architectural photography with true verticals, warm neutral colour, and visible material texture: timber grain, brick, plaster, textile, worn floor. Unstyled and lived-in rather than staged.

**Light.** Daylight from a window or an opening, warm and directional, with soft shadows describing depth. Time of day should read as late morning or afternoon.

**Framing.** Wide 16:9 with a clear depth cue — a doorway, a receding wall, a foreground object — so the room reads as space and not as a flat surface. Verticals must be straight.

**Relationship to the palette.** Putty, timber, clay, charcoal and olive drawn from the real materials in frame. The interface palette is taken from the photograph, so the photograph must be warm and neutral.

**Never:**
- People in frame; this system shows places, not occupants.
- Cool blue-white or fluorescent colour casts that fight the warm ground.
- Tilted verticals or wide-angle distortion.
- Over-styled staging — a magazine set with props arranged for the camera.

**Prompt skeleton.** `architectural interior photograph of an empty lived-in room, warm directional daylight from a window, true straight verticals, visible timber brick and plaster texture, warm neutral colour, clear depth cue through a doorway, wide 16:9, no people, no staging`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. The first element is a full-bleed interior photograph with no people in it.
2. Interface colours are neutrals drawn from that photograph's material range.
3. A calm band follows with one grotesque statement at a 56ch measure.
4. Practical information appears as plain labelled columns with hairline rows.
5. Only one clay action exists; nothing else is coloured, rounded or elevated.
6. No price, cart, or offer appears anywhere.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Public Sans; body: Public Sans; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below --layout-bp-md, collapse content to one column in reading order, place message before media and move any side navigation into a compact top row. Remove decorative offsets and keep tables in their own horizontal scroll region. Between medium and large breakpoints, reduce spans without changing the hierarchy. Above --layout-bp-lg, retain the full grid within --layout-max. At 200% zoom, allow labels and actions to wrap without clipping. Slides and graphics keep their fixed artboard dimensions; adapt content inside that canvas rather than applying website breakpoints to its size.
