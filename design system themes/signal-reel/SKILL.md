---
name: builtin-signal-reel-design
description: Use this bundled Signal Reel Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference color, type, spacing, radius, elevation, and motion tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Copy fonts/ with licenses into outputs and link fonts/fonts.css; no CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Give the page a near-black ground and exactly one saturated red. Set the wordmark or headline enormous in the condensed display face and let it bleed off the edge rather than fitting inside a container. Navigation is small serif at the same red. Use no radius, no shadow, and no card - imagery goes edge to edge and the type sits directly on it.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max` with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by `--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

Media is full-bleed with no container and no gutter, and sections butt directly against each other. Text blocks keep a small margin and section rhythm so a tight-leading display line never crops against the viewport edge. Type is positioned over the media, and the display line is allowed to crop at the viewport edge.

## Composition

Work on a near-black ground with exactly one signal red, used for live state, the primary action and nothing else. The display face is oversized to the point of running past the frame: set it so lines are clipped by the viewport edge on purpose, which is the system's signature. Body copy holds to a short 52ch measure and sits well away from the display, so the two never compete. Sections are separated by wide dark space rather than by rules. Radius is zero and nothing is elevated — on this ground a shadow is invisible anyway, so depth is expressed by scale alone.

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
5. Radius is zero and nothing is elevated.
6. Imagery is near-monochrome and falls to black at its edges.

## Local typography

- Display: Anton; body: Public Sans; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Black Han Sans" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Layout, Composition and Responsive in README.md and apply the --layout-* and --family-* tokens from colors_and_type.css before arranging content. Preserve the grid, reading measure, section rhythm, hero geometry and navigation placement; a palette/font swap on a generic layout is incomplete. Direction variants may change content emphasis, but must retain this structure unless the user explicitly overrides it. Check the rendered result at wide and narrow viewports and 200% zoom; fixed artboards retain their dimensions.
