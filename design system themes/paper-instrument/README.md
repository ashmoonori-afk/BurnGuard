# Paper Instrument Theme

A bright measured ground built from hairlines and air, where a single ink-blue marks action and nothing else competes.

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
| `--layout-measure` | `66ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `24px` | Space between columns |
| `--layout-margin` | `clamp(24px, 5vw, 72px)` | Page side margin |
| `--layout-section-y` | `clamp(72px, 9vw, 144px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `3 / 2` | Hero aspect ratio |

Air is the primary material: section rhythm is deliberately larger than the content needs, and a section holds one idea. Keep body copy at `--layout-measure` even when the container is wider, and let the remaining columns stay empty rather than filling them.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `top` | `top` or `side` — whether primary navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `2` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |

Navigation is a quiet top row with a hairline beneath it. Labels sit beside their control in a second track, which suits specification-style forms where the label is read as a field name rather than a prompt.

## Composition

Start from bright paper and remove until only structure is left. Hierarchy comes from scale and position, not from weight or colour — one large statement, one measure of body, and generous emptiness between them. The ink-blue marks action and nothing else: links, the primary control, focus. Rules are hairline and full-bleed within their section. Avoid filled panels; where a region needs separation, use a rule or a change of measure. Radius stays at or below 4px, and elevation is not used at all.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single manufactured object or instrument on a plain seamless surface — a measuring tool, a component, a clean product form. One object, centred or on a clear axis.

**Treatment.** Bright, even, near-shadowless product photography. Pure white or bone seamless background that merges with the page ground. Crisp edges, true colour, no texture overlay.

**Light.** Broad soft daylight from the front-top, almost flat, with only the faintest contact shadow to seat the object. No dramatic modelling.

**Framing.** Generous empty margin around the subject — the object should occupy roughly a third of the frame. The emptiness is the composition.

**Relationship to the palette.** Achromatic: paper white, light greys, the object's own neutral material. If one accent appears it is the same ink-blue as `--primary-blue`, and only as a small detail.

**Never:**
- Dark or coloured backdrops — the image must merge into the paper ground.
- Hard directional shadows, dramatic contrast, or moody grading.
- Cluttered arrangements, props, hands, or lifestyle staging.
- Gradient meshes or abstract 3D blobs.

**Prompt skeleton.** `product photograph of a single precision instrument on a seamless white background, soft even frontal daylight, minimal contact shadow, generous empty space around the subject, achromatic palette, sharp edges, no props`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. The page ground and the imagery background are the same value, so images sit in the page rather than on it.
2. Exactly one hue appears as action colour; everything else is achromatic.
3. Body copy never exceeds `--layout-measure`, even in a wide container.
4. Section spacing is visibly larger than the content requires.
5. No filled panel, no shadow, and no radius above 4px anywhere.
6. Hierarchy survives if colour is removed entirely.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Instrument Sans; body: Instrument Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
