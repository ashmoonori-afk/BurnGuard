# Wide Gutter Review Theme

A two-track review layout: a narrow text spine beside a wide image track, divided by a gutter treated as a design element.

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
| `--layout-measure` | `46ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `64px` | Space between columns |
| `--layout-margin` | `clamp(20px, 3vw, 48px)` | Page side margin |
| `--layout-section-y` | `clamp(56px, 7vw, 112px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `4 / 5` | Hero aspect ratio |

Four columns carry text at a deliberately narrow `--layout-measure`; the remaining eight carry image. The 64px gutter is wide on purpose — it is the white interval that makes the two tracks read as separate voices. Below `--layout-bp-md` the tracks stack and the gutter becomes vertical rhythm.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `2 / 1` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-editorial-paragraph-mode` | `spaced` | `spaced` (a `--sp-4` gap, no indent) or `indented` (1em first line, no gap, not after a heading). |

The image track is twice the text track, gutter excluded. Images cover their frame because in this system the image is a plate at a fixed proportion, and the crop is part of the edit. Paragraphs are spaced by `--sp-4` with no indent, matching the sans body.

## Composition

Run a narrow sans text spine down one side and a tall image plate down the other, and keep the wide gutter empty — resist filling it. Display is a high-contrast serif used at large size for titles only; body is sans at a narrow measure so the column reads quickly. The blue is used once per view, on the live link or the current item. Captions sit tight under their plate in mono at small size. Nothing is rounded and nothing is elevated; the page is flat and the structure is entirely positional.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single considered subject per plate — a garment, an interior, an artwork, a portrait. One idea per image, presented as a plate rather than a snapshot.

**Treatment.** Editorial photography with deliberate art direction. Clean, decisive, high resolution. The crop is part of the composition, so images are made to be cropped to a tall frame.

**Light.** Controlled and directional, with real shadow shape. Studio or strong window light. Shadows are allowed to be dark.

**Framing.** Portrait orientation at roughly 4:5, composed so the subject survives a cover crop. Leave no important detail at the frame edge.

**Relationship to the palette.** White, black and one material colour per plate. The page is white, so images should not also be white-dominant or they will dissolve into the ground.

**Never:**
- Landscape-orientation images — the plate is vertical by design.
- Busy multi-subject scenes that fight the narrow text track.
- Pale, low-contrast images that disappear against white paper.
- Adding a border or shadow to seat the image; it sits directly on the ground.

**Prompt skeleton.** `editorial photograph, single subject, portrait 4:5 orientation, controlled directional light with defined shadows, one strong material colour against neutral surroundings, decisive crop, high resolution, no border`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. Text and image occupy separate tracks with a visibly wide empty gutter between them.
2. The text measure is narrow — noticeably narrower than a normal article column.
3. Display is serif; body is sans. They never swap roles.
4. Images are vertical plates that cover their frame, sitting directly on white.
5. The accent colour appears once per view at most.
6. The layout is flat: no radius, no shadow, no container.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Instrument Serif; body: Public Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
