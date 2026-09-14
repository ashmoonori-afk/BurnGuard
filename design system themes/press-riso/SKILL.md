---
name: builtin-press-riso-design
description: Use this bundled Press Riso Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Copy fonts/
  with licenses into outputs and link fonts/fonts.css; no CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Work on cream stock with three flat spot colours: vermilion for emphasis and the primary action, ultramarine for links and focus, sun yellow strictly as a block fill behind short text. Colours are flat — no gradient, no tint, no shadow ever. Set headlines in the condensed display face at very large sizes, leaded at 0.94 so lines almost touch. Rotate exactly one display block per page by three degrees and let it overlap the print above it. Rules are 2px. Radius is zero everywhere, including tags and buttons, because nothing on a press is rounded.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-creative-type-rotation` | `-3deg` | Rotation applied to a designated display composition about its own centre. |
| `--family-creative-line-step` | `0px` | Successive display lines shift by `n x step` along the inline axis, starting at line zero. |
| `--family-creative-type-image-overlap` | `40%` | How far a display block translates over preceding imagery, as a share of its own block-size. |

The designated display composition is rotated three degrees off square — the misregistration of a hand-fed press, applied deliberately and only once per page. It also translates over the preceding image by 40% of its own height, so the rotated block and the print visibly overlap the way two runs of ink would.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A graphic print rather than a photograph: a bold illustrated figure, a symbol, a hand-drawn object, or a heavily abstracted photographic subject reduced to shapes.

**Treatment.** Two- or three-colour risograph print on cream uncoated stock. Visible halftone dot, slight ink misregistration between layers, uneven ink density, paper texture showing through the lighter areas.

**Light.** Not applicable as photographic light — the image is printed. Value comes from halftone density alone, so tonal range is short and stepped rather than smooth.

**Framing.** Portrait 3:4 like a bill or a small poster, subject large and centred, with a visible unprinted margin of cream at one or two edges.

**Relationship to the palette.** Cream paper plus at most three flat inks — a vermilion, an ultramarine, and a sun yellow — overprinting to make secondary tones. No fourth colour, no black-and-white photography.

**Never:**
- Smooth photographic gradients or realistic lighting.
- Perfect registration; a small offset between ink layers is required.
- More than three inks, or muted desaturated inks.
- Glossy, digital, or 3D-rendered finishes.

**Prompt skeleton.** `three-colour risograph print on cream uncoated paper, bold graphic illustrated subject, visible halftone dot texture, slight ink misregistration between layers, uneven ink density, paper grain showing through, vermilion and ultramarine and yellow inks overprinting, portrait 3:4, unprinted cream margin`

## Reproducing this system

1. The ground is cream and every colour is flat — no gradient or tint exists.
2. Headlines are condensed, very large, and leaded at 0.94.
3. Exactly one display block per page is rotated three degrees.
4. That rotated block overlaps the image above it by roughly 40% of its height.
5. Rules are 2px and radius is zero, including on tags and buttons.
6. Yellow is used only as a block fill behind short text.

## Local typography

- Display: Anton; body: DM Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Layout, Composition and Responsive in README.md and apply the --layout-* and --family-* tokens from colors_and_type.css before arranging content. Preserve the grid, reading measure, section rhythm, hero geometry and navigation placement; a palette/font swap on a generic layout is incomplete. Direction variants may change content emphasis, but must retain this structure unless the user explicitly overrides it. Check the rendered result at wide and narrow viewports and 200% zoom; fixed artboards retain their dimensions.
