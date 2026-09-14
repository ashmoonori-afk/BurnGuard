# Stone Court Theme

A cool masonry system: limestone ground, a didone statement, and images held contained so the architecture is read whole.

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
| `--layout-max` | `1240px` | Outer content width |
| `--layout-measure` | `60ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `28px` | Space between columns |
| `--layout-margin` | `clamp(24px, 5vw, 80px)` | Page side margin |
| `--layout-section-y` | `clamp(64px, 9vw, 144px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `3 / 2` | Hero aspect ratio |

Large margins up to 80px hold the content away from the viewport edge, which is what makes the imagery read as contained plates rather than as a view. Wide 28px gutters keep the two-track sections airy.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `contain` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `1.0` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-spatial-image-bleed` | `0%` | How far designated images extend from the content edge toward the viewport edge; 0% contained, 100% full-bleed. |

Images are contained and do not bleed at all, because this system documents architecture and a cropped building is an unreadable building. The media and text tracks are equal at 1.0, giving the writing the same standing as the photograph.

## Composition

Work on cool limestone with a didone statement voice and a neutral sans for everything read at length. Images are contained plates with real margin on all sides and never bleed; the ground must be visible around every one. Two-track sections split evenly between photograph and description. Captions sit under plates in 12px mono: location, year, material. The slate accent marks links and the primary action only. Rules are hairline, radius is zero, and the page is quiet enough that the only contrast is between stone and shadow.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An architectural exterior or a masonry detail — a courtyard, a facade, an arcade, a stair, a wall junction. Structure and material, not interiors.

**Treatment.** Formal architectural photography, square to the subject, with true verticals and no lens distortion. Cool neutral colour with stone, concrete, lime plaster and weathered metal reading accurately.

**Light.** Overcast or open-shade daylight with soft even shadows, or raking low sun where texture is the subject. Avoid harsh midday contrast.

**Framing.** Landscape 3:2 with the structure fully inside the frame and clear space around it. The subject must be complete: no cropped corners, no cut-off roofline.

**Relationship to the palette.** Limestone, concrete grey, slate and weathered bronze. Cool neutral overall — the warm end of the spectrum belongs to a different system.

**Never:**
- Cropping into the structure or bleeding it off the frame edge.
- Warm golden-hour grading; this system is deliberately cool.
- Tilted verticals, fisheye, or extreme wide-angle drama.
- People, vehicles, or signage dominating the frame.

**Prompt skeleton.** `formal architectural photograph of a stone courtyard facade, square to the subject with true verticals, overcast soft even daylight, cool neutral limestone and concrete palette, structure complete inside the frame with clear space around it, landscape 3:2, no people, no distortion`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. The ground is cool limestone and no warm cast appears anywhere.
2. Every image is a contained plate with visible ground on all sides; nothing bleeds.
3. Sections split evenly between photograph and description.
4. Captions are 12px mono giving location, year and material.
5. The slate accent marks only links and the primary action.
6. Radius is zero, rules are hairline, and nothing is elevated.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: DM Serif Display; body: Manrope; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
