# Linen Retreat Theme

A hospitality system: linen ground, a high-contrast serif voice, and imagery that bleeds partway so the page feels held rather than open.

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
| `--layout-max` | `1320px` | Outer content width |
| `--layout-measure` | `58ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `24px` | Space between columns |
| `--layout-margin` | `clamp(20px, 4vw, 64px)` | Page side margin |
| `--layout-section-y` | `clamp(56px, 8vw, 120px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `4 / 3` | Hero aspect ratio |

A softer 4:3 hero than the panoramic systems, because hospitality imagery is about a corner of a room rather than a vista. The partial bleed means the margin still exists at the frame edge, which is what keeps the page feeling enclosed.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `1.3` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-spatial-image-bleed` | `60%` | How far designated images extend from the content edge toward the viewport edge; 0% contained, 100% full-bleed. |

Imagery extends 60% of the way from the content edge toward the viewport edge — neither contained nor full-bleed. That halfway state is the system's signature: the page feels held rather than open. Media leads text slightly at 1.3.

## Composition

Set a linen ground with a high-contrast serif for display and a neutral geometric sans for reading. Imagery covers its frame and bleeds partway, always leaving a visible margin at the viewport edge. Eyebrows are small, heavily letterspaced, and uppercase; statements are serif at a 58ch measure with generous leading. Practical information — rooms, rates, arrival, what is nearby — is set as labelled columns with hairline rows, plain and unsold. The tan accent carries links and the single booking action. Radius is small but present at 2-6px, which is the only softness in the set.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A detail of a stay rather than a whole room — a made bed corner, a linen curtain in light, a table set for one, a bath, a view through a window. Intimate scale.

**Treatment.** Natural hospitality photography with soft warm colour, visible textile texture, and shallow depth so one element is sharp and the rest falls away. Unstyled and calm.

**Light.** Soft warm window light, early or late, with gentle gradation across the frame. Never flat, never contrasty.

**Framing.** Standard 4:3, subject slightly off-centre with negative space on one side so type can sit beside it, and a crop that implies more room outside the frame.

**Relationship to the palette.** Linen, oat, tan, sage and warm shadow. Muted throughout; the strongest colour in frame should still be a neutral.

**Never:**
- Wide empty hotel-room shots that look like a booking listing.
- People posing, or staff in frame.
- Cool or clinical colour; the system depends on warmth.
- Hard flash, heavy contrast, or saturated accent objects.

**Prompt skeleton.** `intimate hospitality detail photograph, corner of a made bed with linen texture in soft warm window light, shallow depth of field, muted oat and tan palette, gentle gradation across the frame, subject off-centre with negative space, 4:3, no people, no staging`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. The ground is warm linen and the display voice is a high-contrast serif.
2. Imagery bleeds partway and always leaves a visible margin at the viewport edge.
3. Eyebrows are uppercase, small and heavily letterspaced.
4. Practical information is labelled columns with hairline rows and no sales language.
5. Tan carries links and one booking action; nothing else is coloured.
6. Radius is small but present at 2-6px, and nothing is elevated.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Playfair Display; body: DM Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Gowun Batang" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
