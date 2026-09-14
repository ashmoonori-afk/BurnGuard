# Press Riso Theme

A print-shop system: cream stock, flat spot colours, a condensed poster voice, and blocks set slightly off-square as if run through a press.

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
| `--layout-max` | `1200px` | Outer content width |
| `--layout-measure` | `54ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `20px` | Space between columns |
| `--layout-margin` | `clamp(16px, 4vw, 40px)` | Page side margin |
| `--layout-section-y` | `clamp(48px, 6vw, 96px)` | Vertical rhythm between sections |
| `--layout-rule` | `2px` | Divider weight |
| `--layout-hero` | `3 / 4` | Hero aspect ratio |

A portrait 3:4 hero, because the reference object is a printed poster rather than a screen. The 2px rule matches the weight a press lays down. Sections sit close together so a page reads as a stack of bills rather than a gallery.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-creative-type-rotation` | `-3deg` | Rotation applied to a designated display composition about its own centre. |
| `--family-creative-line-step` | `0px` | Successive display lines shift by `n x step` along the inline axis, starting at line zero. |
| `--family-creative-type-image-overlap` | `40%` | How far a display block translates over preceding imagery, as a share of its own block-size. |

The designated display composition is rotated three degrees off square — the misregistration of a hand-fed press, applied deliberately and only once per page. It also translates over the preceding image by 40% of its own height, so the rotated block and the print visibly overlap the way two runs of ink would.

## Composition

Work on cream stock with three flat spot colours: vermilion for emphasis and the primary action, ultramarine for links and focus, sun yellow strictly as a block fill behind short text. Colours are flat — no gradient, no tint, no shadow ever. Set headlines in the condensed display face at very large sizes, leaded at 0.94 so lines almost touch. Rotate exactly one display block per page by three degrees and let it overlap the print above it. Rules are 2px. Radius is zero everywhere, including tags and buttons, because nothing on a press is rounded.

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

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. The ground is cream and every colour is flat — no gradient or tint exists.
2. Headlines are condensed, very large, and leaded at 0.94.
3. Exactly one display block per page is rotated three degrees.
4. That rotated block overlaps the image above it by roughly 40% of its height.
5. Rules are 2px and radius is zero, including on tags and buttons.
6. Yellow is used only as a block fill behind short text.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Anton; body: DM Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below --layout-bp-md, collapse content to one column in reading order, place message before media and move any side navigation into a compact top row. Remove decorative offsets and keep tables in their own horizontal scroll region. Between medium and large breakpoints, reduce spans without changing the hierarchy. Above --layout-bp-lg, retain the full grid within --layout-max. At 200% zoom, allow labels and actions to wrap without clipping. Slides and graphics keep their fixed artboard dimensions; adapt content inside that canvas rather than applying website breakpoints to its size.
