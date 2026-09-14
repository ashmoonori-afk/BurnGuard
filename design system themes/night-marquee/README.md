# Night Marquee Theme

A title-card system: one cinematic still fills the viewport, a centred stack of small type floats over it, and credits read as label-and-value rows.

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
| `--layout-gutter` | `16px` | Space between columns |
| `--layout-margin` | `clamp(16px, 3vw, 40px)` | Page side margin |
| `--layout-section-y` | `clamp(72px, 10vw, 160px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `16 / 9` | Hero aspect ratio |

The hero is a cinematic 16:9 that occupies the whole first viewport. Section spacing is the largest in the set because darkness needs room to be felt. The measure is short at 46ch: text over imagery must stay a caption, never a column.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-creative-type-rotation` | `0deg` | Rotation applied to a designated display composition about its own centre. |
| `--family-creative-line-step` | `0px` | Successive display lines shift by `n x step` along the inline axis, starting at line zero. |
| `--family-creative-type-image-overlap` | `100%` | How far a display block translates over preceding imagery, as a share of its own block-size. |

The display block sits fully over its still — the overlap is total, which is what makes the page a title card rather than a page with a picture on it. Nothing rotates and no line steps: the composition is strictly centred, and the stillness is the effect.

## Composition

Give the first viewport entirely to one still, and float the title stack over its centre. Type over imagery stays small and centred: an eyebrow, the title, then a thin rule, then credits. Credits are label-and-value rows — festival and award, role and name — centred with a wide gap between the two halves, set at 11px with heavy letterspacing on the label. Chrome is almost absent: a wordmark and a menu mark in the extreme corners, nothing else in the fold. Colour comes only from the still itself; every token in the interface is achromatic. Radius is zero and nothing is elevated, because a title card has no surfaces.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single human moment held still — a face in half-light, a figure in a doorway, hands at rest. It should read as a frame lifted out of a longer sequence, not as a posed portrait.

**Treatment.** Cinematic capture with visible grain, shallow depth of field, and deep crushed shadows that fall to near-black so the frame merges with the page ground. Colour muted to near-monochrome with one cool cast surviving in the shadows.

**Light.** Low-key and directional — a single practical source, most of the frame in shadow, a narrow highlight describing the subject. No fill. The darkest quarter of the frame should be effectively black.

**Framing.** Wide 16:9 with the subject off-centre and considerable empty darkness, so a centred type stack can sit in the frame without covering the subject.

**Relationship to the palette.** Near-black with a cool teal or indigo cast in the shadows and a single warm practical light. No saturated colour anywhere.

**Never:**
- Bright, evenly lit, or high-key frames — they break the merge with the page.
- Busy compositions with no empty region for the title stack.
- Posed studio portraits or stock-looking smiles.
- Heavy colour grading toward orange and teal clichés.

**Prompt skeleton.** `cinematic film still, single human moment in low-key directional light, most of frame in deep shadow falling to near-black, shallow depth of field, visible grain, near-monochrome with a cool cast in the shadows, subject off-centre leaving empty dark space, 16:9`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. The first viewport is one still and nothing else.
2. The title stack is centred over the image and stays small.
3. Credits are centred label-and-value rows at 11px with letterspaced labels.
4. Chrome exists only as corner marks; no navigation bar is visible in the fold.
5. Every interface token is achromatic — colour appears only inside imagery.
6. Radius is zero and no element carries a shadow.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Instrument Serif; body: Instrument Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below --layout-bp-md, collapse content to one column in reading order, place message before media and move any side navigation into a compact top row. Remove decorative offsets and keep tables in their own horizontal scroll region. Between medium and large breakpoints, reduce spans without changing the hierarchy. Above --layout-bp-lg, retain the full grid within --layout-max. At 200% zoom, allow labels and actions to wrap without clipping. Slides and graphics keep their fixed artboard dimensions; adapt content inside that canvas rather than applying website breakpoints to its size.
