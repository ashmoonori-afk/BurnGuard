# Stencil Field Theme

A studio system built on emptiness: a vast pale field, one enormous display statement, and a saturated full-bleed media band the statement dips into.

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
| `--layout-max` | `1600px` | Outer content width |
| `--layout-measure` | `60ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `24px` | Space between columns |
| `--layout-margin` | `clamp(16px, 3vw, 48px)` | Page side margin |
| `--layout-section-y` | `clamp(96px, 14vw, 224px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `21 / 9` | Hero aspect ratio |

Section spacing is enormous — up to 224px — because the empty field above the statement is the composition, not leftover space. The hero is a wide 21:9 band that runs the full viewport width regardless of the content maximum.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-creative-type-rotation` | `0deg` | Rotation applied to a designated display composition about its own centre. |
| `--family-creative-line-step` | `0px` | Successive display lines shift by `n x step` along the inline axis, starting at line zero. |
| `--family-creative-type-image-overlap` | `24%` | How far a display block translates over preceding imagery, as a share of its own block-size. |

The display block translates up by roughly a quarter of its own height, so its first line crosses back over the media band it follows. That single overlap is the whole trick of the system: type and image are one object at exactly one seam, and everywhere else they stay apart.

## Composition

Open with a tall empty field. Run a saturated full-bleed media band edge to edge, then set one statement across two lines at the largest size the viewport allows, in the wide display face, tightly leaded at 0.92 so the lines lock together as a block, and pull that block up until its first line crosses the band. Chrome is a 13px wordmark at top-left and a single mark at top-right; nothing else competes. The green is used for links, focus and live state only — never as a fill behind large text. Rules are hairline, radius is zero, and the page's rhythm is field, band, statement, field.

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

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. A tall empty field opens the page before any statement appears.
2. The statement is two lines, at maximum scale, leaded tightly at 0.92.
3. A full-bleed saturated media band precedes the statement, and the first display line crosses back over it.
4. Chrome is a 13px wordmark and one mark, in opposite top corners.
5. Green appears only on links, focus and live state — never as a large fill.
6. Section spacing is visibly extreme, and radius is zero throughout.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Syne; body: Space Grotesk; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
