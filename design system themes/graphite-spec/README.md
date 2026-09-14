# Graphite Spec Theme

A graphite engineering ground where mono sets the body, figures are numbered, and one amber marks the value that matters.

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
| `--layout-max` | `1400px` | Outer content width |
| `--layout-measure` | `72ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `16px` | Space between columns |
| `--layout-margin` | `clamp(16px, 2.5vw, 40px)` | Page side margin |
| `--layout-section-y` | `clamp(36px, 4vw, 64px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `2 / 1` | Hero aspect ratio |

Run a narrow annotation track in the outer margin carrying figure numbers and units, beside a wide content track. Rhythm is tight and continuous — this reads as a specification document, so sections follow one another closely rather than being spaced apart.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `top` | `top` or `side` — whether primary navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `2` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |

Navigation is a compact top row at 44px with a rule beneath. Labels sit beside their control, matching the document's two-track annotation structure so a form reads like a spec table.

## Composition

Set body in mono and accept the density that follows — this system is for material that is measured, not persuaded. Number every figure and put the number in the margin track. Amber marks the value under discussion: a highlighted row, a callout figure, a threshold. Everything else is graphite and bone. Radius is zero everywhere and elevation is never used; structure comes entirely from rules and alignment. Tables are first-class, not an afterthought.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Technical drawing and measured artifacts: an exploded view, a section drawing, a dimensioned component, a calibration surface. Line work rather than photography wherever possible.

**Treatment.** Flat vector line drawing on the graphite ground, hairline weight, no fills except where a part must be distinguished. Where photography is required, make it a flat frontal record shot with no styling.

**Light.** Not applicable to line work. For record photography, flat even illumination with no modelling — the goal is legibility of form, not atmosphere.

**Framing.** Orthographic and squared to the frame. Include dimension lines, leader lines and figure labels as part of the image.

**Relationship to the palette.** Bone line work on graphite, with amber reserved for the single dimension or part being called out.

**Never:**
- Perspective renders, dramatic angles, or atmospheric lighting.
- Colour fills beyond the single amber callout.
- Decorative iconography standing in for a real diagram.
- Soft shadows or any suggestion of depth.

**Prompt skeleton.** `flat orthographic technical line drawing of a mechanical component, hairline bone-white strokes on dark graphite background, dimension lines and leader labels, one amber highlighted dimension, no shading, no perspective`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. Body copy is set in mono and the density is noticeably higher than a marketing page.
2. Every figure carries a number, and the number sits in the margin track.
3. Amber appears only on the value being called out — never as general decoration.
4. Radius is zero on every element and no element has a shadow.
5. Structure is legible from rules and alignment alone.
6. A data table looks native to the system rather than bolted on.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: IBM Plex Mono; body: IBM Plex Mono; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for UI text; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
