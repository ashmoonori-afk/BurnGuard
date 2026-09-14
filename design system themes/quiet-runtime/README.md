# Quiet Runtime Theme

A soft warm-grey product ground with rounded surfaces and one violet action, tuned for interfaces that are looked at all day.

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
| `--layout-max` | `1180px` | Outer content width |
| `--layout-measure` | `60ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `20px` | Space between columns |
| `--layout-margin` | `clamp(20px, 4vw, 56px)` | Page side margin |
| `--layout-section-y` | `clamp(48px, 6vw, 96px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `16 / 9` | Hero aspect ratio |

Group related controls into soft surfaces at `--surface` with a hairline border, and let the warm ground show between them. Section rhythm is moderate — this system is for sustained use, not for a launch page, so nothing is dramatic.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `side` | `top` or `side` — whether primary navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `2` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `above` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |

Navigation occupies two of the twelve columns as a side track at expanded widths and collapses to a top row below `--layout-bp-md`. Labels stack above their control so the form stays scannable in a narrow content track.

## Composition

Work on warm grey rather than white — the ground should feel unlit rather than bright. Content sits on soft surfaces with a hairline edge and a moderate radius, separated by the ground itself instead of by rules. One violet carries every action and selected state; semantic colours appear only in their own chips. Type is a single humanist sans across display and body, distinguished by size and weight rather than by family. Motion is short and unshowy. Nothing should demand attention twice.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Interface fragments and soft abstract forms: a rounded panel, a stacked card edge, a gently curved surface. Objects are implied rather than photographed literally.

**Treatment.** Soft-focus 3D render or diffuse photography with matte materials. Rounded geometry, no sharp corners, no reflective surfaces. Gentle gradient across the form.

**Light.** Large diffuse source, wraparound, almost no visible shadow edge. Overcast-window quality.

**Framing.** Loose and centred with comfortable margin. The form should feel placed, not cropped.

**Relationship to the palette.** Warm greys matching the page ground, with a single muted violet passage echoing `--primary-blue`. Saturation stays low throughout.

**Never:**
- High-contrast or neon renders — this system's whole point is low arousal.
- Sharp geometric edges or hard specular highlights.
- Literal screenshots of other products.
- Busy compositions with many competing forms.

**Prompt skeleton.** `soft matte 3D render of rounded abstract interface surfaces, warm grey palette with one muted violet passage, large diffuse light, no hard shadows, low saturation, generous margin, calm composition`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. The ground is warm grey, not white, and surfaces are lighter than the ground.
2. Separation comes from the ground showing between surfaces, not from rules.
3. One violet carries every action and selected state.
4. Display and body are the same family, separated only by size and weight.
5. Radius is consistently soft (6-16px) and applied to every surface.
6. Nothing on the page is high-contrast enough to demand attention twice.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Manrope; body: Manrope; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below --layout-bp-md, collapse content to one column in reading order, place message before media and move any side navigation into a compact top row. Remove decorative offsets and keep tables in their own horizontal scroll region. Between medium and large breakpoints, reduce spans without changing the hierarchy. Above --layout-bp-lg, retain the full grid within --layout-max. At 200% zoom, allow labels and actions to wrap without clipping. Slides and graphics keep their fixed artboard dimensions; adapt content inside that canvas rather than applying website breakpoints to its size.
