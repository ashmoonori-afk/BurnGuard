# Signal Reel Theme

Near-black ground, one signal red, and an oversized grotesque that runs past the frame.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Layout

Layout is part of this system, not a per-page decision. Build every artifact on these tokens rather than inventing a grid:

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | none | Outer content width |
| `--layout-measure` | 52ch | Reading measure for body copy |
| `--layout-columns` | 6 | Base column count |
| `--layout-gutter` | 0px | Space between columns |
| `--layout-margin` | clamp(16px, 3vw, 40px) | Page side margin |
| `--layout-section-y` | clamp(28px, 4vw, 64px) | Vertical rhythm between sections |
| `--layout-rule` | 0px | Divider weight |
| `--layout-bp-md` / `--layout-bp-lg` | 720px / 1080px | Breakpoints |
| `--layout-hero` | 21 / 9 | Hero aspect ratio |

Media is full-bleed with no container and no gutter, and sections butt directly against each other. Text blocks keep a small margin and section rhythm so a tight-leading display line never crops against the viewport edge. Type is positioned over the media, and the display line is allowed to crop at the viewport edge.

## Composition

Work on a near-black ground with exactly one signal red, used for live state, the primary action and nothing else. The display face is oversized to the point of running past the frame: set it so lines are clipped by the viewport edge on purpose, which is the system's signature. Body copy holds to a short 52ch measure and sits well away from the display, so the two never compete. Sections are separated by wide dark space rather than by rules. Radius stays minimal and nothing is elevated — on this ground a shadow is invisible anyway, so depth is expressed by scale alone.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Motion held still — a performer, a vehicle, a crowd, a machine mid-cycle. Energy must be visible in the frame.

**Treatment.** High-contrast capture with deep blacks that fall away into the page ground, visible grain, and a single hot highlight. Near-monochrome with the red surviving where it appears naturally.

**Light.** Hard directional or stage light with most of the frame dark. Blown highlights are acceptable; flat even light is not.

**Framing.** Wide crop with the subject off-centre and a large dark region, so an oversized display line can cross the frame without hiding the subject.

**Relationship to the palette.** Near-black with grey midtones and at most one red element. No other colour.

**Never:**
- Bright, evenly lit, or high-key frames.
- Multiple saturated colours competing with the signal red.
- Static, posed subjects with no implied movement.
- Frames with no dark region for the display type to cross.

**Prompt skeleton.** `high-contrast photograph of motion held still, hard directional stage light, deep blacks falling to near-black, visible grain, near-monochrome with a single red element, subject off-centre with a large dark region, wide crop`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the
design. Check the result against all of these:

1. The ground is near-black and exactly one red appears, on live state and the primary action.
2. Display type is oversized enough to be clipped by the viewport edge on purpose.
3. Body copy holds to a short 52ch measure, set well away from the display.
4. Sections are separated by wide dark space, not by rules.
5. Radius is minimal and nothing is elevated.
6. Imagery is near-monochrome and falls to black at its edges.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, and shape rules were composed for this theme; no third-party theme, stylesheet, palette, or asset is included, and it carries no external license obligation.

## Local typography

- Display: Anton; body: Public Sans; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Black Han Sans" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
