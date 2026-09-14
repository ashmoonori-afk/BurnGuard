---
name: builtin-stencil-field-design
description: Use this bundled Stencil Field Theme theme to create token-driven interfaces and visual artifacts.
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

Open with a tall empty field. Set one statement across two lines at the largest size the viewport allows, in the wide display face, tightly leaded at 0.92 so the lines lock together as a block. Below it, run a saturated full-bleed media band edge to edge, and let the statement's last line dip into it. Chrome is a 13px wordmark at top-left and a single mark at top-right; nothing else competes. The green is used for links, focus and live state only — never as a fill behind large text. Rules are hairline, radius is zero, and the page's rhythm is statement, band, statement, band.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-creative-type-rotation` | `0deg` | Rotation applied to a designated display composition about its own centre. |
| `--family-creative-line-step` | `0px` | Successive display lines shift by `n x step` along the inline axis, starting at line zero. |
| `--family-creative-type-image-overlap` | `24%` | How far a display block translates over preceding imagery, as a share of its own block-size. |

The display block translates down by roughly a quarter of its own height so its final line crosses into the media band below. That single overlap is the whole trick of the system: type and image are one object at exactly one seam, and everywhere else they stay apart.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An abstract material close-up — poured pigment, blown glass, folded metal, dyed textile. No identifiable object, no person, no place. The image is a colour event.

**Treatment.** Macro or near-macro photography with the material filling the entire frame, saturated to the edge of plausible but still physical. Surfaces glossy or wet so light travels through them.

**Light.** Bright, wrapping, high-key light with specular highlights. The material should look self-luminous rather than lit from one side.

**Framing.** Ultra-wide 21:9 crop taken from the middle of a larger surface, with no focal subject — the frame can be cut anywhere and still work as a band.

**Relationship to the palette.** One dominant saturated hue occupying most of the frame, with its own highlights and shadows as the only variation. Different sections may use different hues, but never two competing hues in one frame.

**Never:**
- Recognisable objects, people, logos, or places.
- Muted, dusty, or pastel treatments — the band must be loud against the pale field.
- Multiple competing hues in a single frame.
- Narrow crops with a clear subject; this is a band, not a picture.

**Prompt skeleton.** `ultra-wide macro photograph of an abstract glossy material surface filling the frame, single dominant saturated hue, bright wrapping high-key light with specular highlights, wet luminous texture, no recognisable object, 21:9 band crop`

## Reproducing this system

1. A tall empty field opens the page before any statement appears.
2. The statement is two lines, at maximum scale, leaded tightly at 0.92.
3. A full-bleed saturated media band follows, and the last display line dips into it.
4. Chrome is a 13px wordmark and one mark, in opposite top corners.
5. Green appears only on links, focus and live state — never as a large fill.
6. Section spacing is visibly extreme, and radius is zero throughout.

## Local typography

- Display: Syne; body: Space Grotesk; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Layout, Composition and Responsive in README.md and apply the --layout-* and --family-* tokens from colors_and_type.css before arranging content. Preserve the grid, reading measure, section rhythm, hero geometry and navigation placement; a palette/font swap on a generic layout is incomplete. Direction variants may change content emphasis, but must retain this structure unless the user explicitly overrides it. Check the rendered result at wide and narrow viewports and 200% zoom; fixed artboards retain their dimensions.
